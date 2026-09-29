import type { Server } from "node:http"
import path from "node:path"
import { type ServerType, serve } from "@hono/node-server"
import { createDatabase, setDefaultDatabase } from "@jot/db"
import { Hono } from "hono"
import { type AppConfig, validateCsrfConfig } from "./app"
import { csrfProtection } from "./csrf"
import type { DatabaseConfig } from "./database"
import { createHandler, validateRoutes } from "./dispatch"
import { env, isProduction, loadDotEnv } from "./env"
import { errorHandler, notFoundHandler } from "./errors"
import { requestLogger } from "./logging"
import { methodOverride } from "./method_override"
import { setPathHelpers } from "./paths"
import type { RouteTable } from "./routes"
import { resolveSecret, sessionMiddleware } from "./session"
import { staticMiddleware } from "./static"

export interface CreateAppOptions {
  /** Aceito para simetria com `start()`; a montagem não usa o nome. */
  app?: AppConfig
  routes: RouteTable
  /** Root do app (default: cwd); resolve `public/`. O `.env` é carregado no `start()`. */
  root?: string
  /** Segredo da sessão; default: `JOT_SECRET` (dev sem segredo gera aleatório). */
  secret?: string
}

/**
 * Monta o app Hono (hook de teste documentado e usado por `start()`).
 *
 * Ordem dos middlewares (importa): `_method` → log → static → sessão → rotas.
 */
export function createApp(options: CreateAppOptions): Hono {
  const root = options.root ?? process.cwd()
  const production = isProduction()
  validateCsrfConfig(options.app?.csrf)
  const { secret } = resolveSecret(options.secret)

  validateRoutes(options.routes.definitions)
  const csrfConfig = options.app?.csrf
  const csrfEnabled = csrfConfig?.enabled !== false
  if (!csrfEnabled) {
    const reason = csrfConfig.reason.trim()
    console.warn(
      `CSRF protection is disabled for this app (reason: ${JSON.stringify(reason)}). ` +
        "Use this only when every unsafe route has independent authentication.",
    )
  }
  for (const definition of options.routes.definitions) {
    if (definition.csrf === undefined) continue
    if (definition.csrf.exempt !== true) {
      throw new Error(
        `Invalid CSRF exemption for ${definition.method} ${definition.path}. Use { csrf: { exempt: true, reason: "..." } } only for independently authenticated routes.`,
      )
    }
    assertCsrfReason(definition.csrf.reason)
    if (!isUnsafeMethod(definition.method)) continue
    const reason = definition.csrf.reason.trim()
    console.warn(
      `CSRF protection is exempt for ${definition.method} ${definition.path} (reason: ${JSON.stringify(reason)}). ` +
        "Verify independent authentication before processing this route.",
    )
  }
  setPathHelpers(options.routes.definitions)

  const app = new Hono()
  app.use("*", methodOverride(app))
  app.use("*", requestLogger())
  app.use("*", staticMiddleware({ root }))
  app.use("*", sessionMiddleware({ secret, production }))
  for (const definition of options.routes.definitions) {
    const handler = createHandler(definition)
    if (csrfEnabled && isUnsafeMethod(definition.method) && definition.csrf?.exempt !== true) {
      app.on(definition.method, definition.path, csrfProtection(), handler)
    } else {
      app.on(definition.method, definition.path, handler)
    }
  }
  app.notFound(notFoundHandler(!production))
  app.onError(errorHandler(!production))
  return app
}

function isUnsafeMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE"
}

function assertCsrfReason(reason: unknown): asserts reason is string {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error(
      'A CSRF route exemption requires a non-empty reason. Use { csrf: { exempt: true, reason: "..." } } only for independently authenticated routes.',
    )
  }
}

export interface StartOptions {
  app: AppConfig
  routes: RouteTable
  database?: DatabaseConfig
  root?: string
  /** Porta; default: `env("PORT", "3000")`. `0` escolhe uma porta livre. */
  port?: number
  hostname?: string
  /** Segredo da sessão; default: `process.env.JOT_SECRET`. */
  secret?: string
}

export interface ServerHandle {
  /** Porta real (resolve `port: 0`). */
  readonly port: number
  readonly url: string
  readonly server: ServerType
  readonly app: Hono
  close(): Promise<void>
}

/**
 * Boot completo do app: `.env` → database (+ `setDefaultDatabase`) → Hono →
 * `serve()`. Não roda migrations (isso é `jot db:migrate`).
 */
export async function start(options: StartOptions): Promise<ServerHandle> {
  const root = options.root ?? process.cwd()
  loadDotEnv(root)

  if (options.database !== undefined) {
    // `schema` é opcional no `defineDatabase`; o M1 não usa o API relacional do
    // Drizzle, então `{}` basta (o `@jot/orm` consulta com os próprios builders).
    const database = createDatabase({
      url: options.database.url,
      schema: options.database.schema ?? {},
      migrationsDir: resolveMigrationsDir(root, options.database.migrationsDir),
      logQueries: options.database.logQueries ?? !isProduction(),
    })
    setDefaultDatabase(database)
  }

  const app = createApp({ app: options.app, routes: options.routes, root, secret: options.secret })
  const port =
    options.port === undefined ? parsePort(env("PORT", "3000")) : validatePort(options.port)
  const listening = await listen(app, port, options.hostname)

  console.log(
    `JOT ${options.app?.name ?? "app"} (${isProduction() ? "production" : "development"})`,
  )
  console.log(`JOT listening on http://localhost:${listening.port}`)

  return {
    port: listening.port,
    url: `http://localhost:${listening.port}`,
    server: listening.server,
    app,
    close: () => closeServer(listening.server),
  }
}

interface Listening {
  server: ServerType
  port: number
}

function listen(app: Hono, port: number, hostname?: string): Promise<Listening> {
  return new Promise<Listening>((resolve, reject) => {
    const server = serve({ fetch: (request) => app.fetch(request), port, hostname }, (info) =>
      resolve({ server, port: info.port }),
    )
    server.once("error", (error: unknown) => reject(startupError(port, error)))
  })
}

/** Resolve `migrationsDir` relativo ao root do app (default `db/migrate`). */
function resolveMigrationsDir(root: string, dir: string | undefined): string {
  if (dir === undefined) return path.join(root, "db", "migrate")
  return path.isAbsolute(dir) ? dir : path.resolve(root, dir)
}

function parsePort(value: string): number {
  const text = value.trim()
  const port = Number(text)
  if (text.length === 0 || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw invalidPortError(value)
  }
  return port
}

function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw invalidPortError(port)
  return port
}

function invalidPortError(value: unknown): Error {
  return new Error(
    `Invalid port ${JSON.stringify(value)}; expected an integer between 0 and 65535. ` +
      "Set PORT in .env (e.g. PORT=3000) or pass `port` to start().",
  )
}

function startupError(port: number, error: unknown): Error {
  const code = (error as { code?: unknown } | undefined)?.code
  const detail = error instanceof Error ? error.message : String(error)
  if (code === "EADDRINUSE") {
    return new Error(
      `Port ${port} is already in use. Stop the process using it or set a different PORT ` +
        `(e.g. PORT=${port + 1} in .env).`,
      { cause: error },
    )
  }
  return new Error(
    `Failed to start the server on port ${port}: ${detail}. Check the PORT value and try again.`,
    { cause: error },
  )
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const nodeServer = server as Server
    nodeServer.close((error) => {
      if (error) {
        reject(new Error(`Failed to close the server: ${error.message}`, { cause: error }))
      } else {
        resolve()
      }
    })
    nodeServer.closeAllConnections()
  })
}
