import type { Context, Handler } from "hono"
import type { Controller, ControllerContext } from "./controller"
import { snake } from "./naming"
import { getControllerClass, getViewComponent } from "./registry"
import type { RouteDefinition } from "./routes"
import { Session } from "./session"
import { getRequestState, setRequestState } from "./state"

/** View convencional de uma action (`Posts#index` → `posts/index`). */
export function defaultViewName(definition: RouteDefinition): string {
  return `${snake(definition.controllerKey)}/${definition.action}`
}

/** Caminho do controller do app, usado nas mensagens didáticas. */
export function controllerFilePath(definition: RouteDefinition): string {
  return `app/controllers/${snake(definition.controllerKey)}_controller.ts`
}

/**
 * Valida a tabela de rotas no boot (`createApp`): o controller precisa existir e,
 * quando a action existe mas não cita `render`/`redirectTo`/`json`/`renderNotFound`
 * (render automático), a view convencional também precisa existir.
 *
 * Action ausente **não** derruba o boot: rotas declaradas para actions ainda não
 * implementadas (ex.: `r.resource("posts")` com um controller parcial) só falham
 * na request, com erro didático no dispatch.
 */
export function validateRoutes(definitions: readonly RouteDefinition[]): void {
  for (const definition of definitions) {
    const ControllerClass = getControllerClass(definition.controllerKey)
    if (ControllerClass === undefined) {
      throw new Error(
        `Controller '${definition.controllerKey}' not found for route ` +
          `${definition.method} ${definition.path} (${definition.controller}#${definition.action}). ` +
          `Expected file: ${controllerFilePath(definition)}. ` +
          "Restart `jot server` to regenerate the manifest.",
      )
    }

    const action = (ControllerClass.prototype as unknown as Record<string, unknown>)[
      definition.action
    ]
    if (typeof action !== "function") continue
    if (mentionsResponseHelper(action)) continue
    const viewName = defaultViewName(definition)
    if (getViewComponent(viewName) === undefined) {
      throw new Error(
        `View '${viewName}' not found for route ${definition.method} ${definition.path}. ` +
          `Expected file: app/views/${viewName}.tsx. ` +
          "Restart `jot server` to regenerate the manifest.",
      )
    }
  }
}

/** Heurística do boot: a action claramente devolve uma resposta pronta. */
function mentionsResponseHelper(action: unknown): boolean {
  if (typeof action !== "function") return false
  const source = Function.prototype.toString.call(action)
  return /\b(render|redirectTo|json|renderNotFound)\b/.test(source)
}

/** Handler Hono de uma rota: monta o controller, executa a action e normaliza o retorno. */
export function createHandler(definition: RouteDefinition): Handler {
  return async (c) => {
    const ControllerClass = getControllerClass(definition.controllerKey)
    if (ControllerClass === undefined) {
      throw new Error(
        `Controller '${definition.controllerKey}' not found for route ` +
          `${definition.method} ${definition.path}. Expected file: ${controllerFilePath(definition)}. ` +
          "Restart `jot server` to regenerate the manifest.",
      )
    }

    const query = c.req.query()
    const body = await parseRequestBody(c)
    const params: Record<string, string> = { ...query, ...stringValues(body), ...c.req.param() }

    const state = getRequestState(c)
    const session = state?.session ?? new Session()
    const flash = { ...recordValues(session.get("flash")) }
    if (state === undefined) setRequestState(c, { session, flash })
    else state.flash = flash

    const context: ControllerContext = { params, query, body, session, flash, request: c }
    const instance = new ControllerClass(context)
    const action = (instance as unknown as Record<string, unknown>)[definition.action]
    if (typeof action !== "function") {
      throw new Error(
        `Action '${definition.action}' is not defined in controller '${definition.controllerKey}' ` +
          `(route ${definition.method} ${definition.path}). Add \`async ${definition.action}() { ... }\` ` +
          `to ${controllerFilePath(definition)} or remove the route from config/routes.ts.`,
      )
    }

    const result: unknown = await (action as (this: Controller) => unknown).call(instance)
    if (result instanceof Response) return result
    if (result === undefined || result === null) return instance.render(defaultViewName(definition))
    throw new Error(
      `Controller '${definition.controllerKey}#${definition.action}' for ` +
        `${definition.method} ${definition.path} returned an unsupported value ` +
        `(${describeValue(result)}). Return \`this.render(...)\`, \`this.redirectTo(...)\`, ` +
        `\`this.json(...)\`, \`this.renderNotFound()\`, a Response, or nothing to auto-render ` +
        `the '${defaultViewName(definition)}' view.`,
    )
  }
}

/** Body da request: GET/HEAD → `{}`; urlencoded/multipart → `parseBody`; json → `json`. */
export async function parseRequestBody(c: Context): Promise<Record<string, unknown>> {
  const method = c.req.method.toUpperCase()
  if (method === "GET" || method === "HEAD") return {}

  const contentType = (c.req.header("content-type") ?? "").toLowerCase()
  if (contentType.includes("application/json")) {
    try {
      const data: unknown = await c.req.json()
      return isRecord(data) ? { ...data } : {}
    } catch {
      return {}
    }
  }
  if (
    contentType.startsWith("application/x-www-form-urlencoded") ||
    contentType.startsWith("multipart/form-data")
  ) {
    try {
      const data = await c.req.parseBody()
      return { ...data }
    } catch {
      return {}
    }
  }
  return {}
}

/** Apenas campos string entram em `params` (Files e valores de JSON ficam no `body`). */
function stringValues(body: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") values[key] = value
  }
  return values
}

function recordValues(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function describeValue(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string") {
    const text = value.length > 60 ? `${value.slice(0, 60)}…` : value
    return `string ${JSON.stringify(text)}`
  }
  if (Array.isArray(value)) return `array of ${value.length}`
  return typeof value
}
