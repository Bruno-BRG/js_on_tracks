import { resolve } from "node:path"
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy"
import {
  type Driver,
  databaseError,
  resolveSqliteFile,
  splitSqlStatements,
  sqliteDriver,
} from "./driver"
import { migrate, rollback } from "./migrations"

export interface DatabaseOptions<
  TSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Caminho (`./db/dev.sqlite`), `file:...` ou `:memory:`. */
  url: string
  /**
   * O namespace exportado por `db/schema.ts` (opcional; default `{}`).
   * Só é necessário para o API relacional `db.drizzle.query.*`, que o JOT não usa no M1.
   */
  schema?: TSchema
  /** Pasta com `*.sql`; default: `db/migrate` relativo ao diretório de execução. */
  migrationsDir?: string
  /** Loga SQL, params e duração via `console.debug` (dev only). */
  logQueries?: boolean
}

export interface Database {
  readonly url: string
  readonly migrationsDir: string
  /** Instância Drizzle (sqlite-proxy) usada pelo `@jot/orm`. */
  readonly drizzle: SqliteRemoteDatabase<Record<string, unknown>>
  /** Aplica as migrations pendentes; devolve os nomes aplicados nesta chamada. */
  migrate(): Promise<string[]>
  /** Desfaz as últimas N migrations (default 1); devolve os nomes desfeitos. */
  rollback(steps?: number): Promise<string[]>
  /** SQL cru no driver. Sem params, aceita SQL com múltiplos statements. */
  exec(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Fecha o banco (remove o default database, se for ele). */
  close(): Promise<void>
}

const DEFAULT_MIGRATIONS_DIR = "db/migrate"

let defaultDatabase: Database | undefined

type ProxyMethod = "run" | "all" | "values" | "get"

/**
 * Ponte entre Drizzle (sqlite-proxy) e o `Driver`.
 *
 * Contrato confirmado empiricamente (drizzle-orm 0.45):
 * - `all`/`values`: `rows` é um array de linhas **posicionais** (valores na ordem das colunas).
 * - `get`: `rows` é **uma** linha posicional (não um array de linhas) — ou `undefined` quando
 *   não há resultado; drizzle trata `rows` ausente como "não encontrado".
 * - `run`: o retorno é ignorado; devolvemos `{ rows: [] }`.
 */
async function runProxyQuery(
  driver: Driver,
  sql: string,
  params: unknown[],
  method: ProxyMethod,
): Promise<{ rows: unknown[] }> {
  if (method === "run") {
    await driver.run(sql, params)
    return { rows: [] }
  }

  if (method === "get") {
    const row = (await driver.query(sql, params))[0]
    if (row === undefined) {
      // O tipo do drizzle marca `rows` como opcional; ausente = sem resultado.
      return { rows: undefined as unknown as unknown[] }
    }
    return { rows: Object.values(row) }
  }

  const rows = await driver.query(sql, params)
  return { rows: rows.map((row) => Object.values(row)) }
}

function formatParams(params: unknown[]): string {
  try {
    return JSON.stringify(params, (_key, value: unknown) => {
      if (typeof value === "bigint") return `${value}n`
      if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`
      return value
    })
  } catch {
    return String(params)
  }
}

function logQuery(sql: string, params: unknown[], durationMs: number): void {
  console.debug(`[jot/db] ${sql} -- params: ${formatParams(params)} (${durationMs.toFixed(1)}ms)`)
}

/** Decora o driver logando SQL, params e duração (inclui migrations e `db.exec`). */
function withLogging(driver: Driver): Driver {
  const timed = async <T>(sql: string, params: unknown[], run: () => Promise<T>): Promise<T> => {
    const started = performance.now()
    try {
      return await run()
    } finally {
      logQuery(sql, params, performance.now() - started)
    }
  }

  const logged: Driver = {
    query: (sql, params = []) => timed(sql, params, () => driver.query(sql, params)),
    run: (sql, params = []) => timed(sql, params, () => driver.run(sql, params)),
    close: () => driver.close(),
  }

  const exec = driver.exec?.bind(driver)
  if (exec) {
    logged.exec = (sql) => timed(sql, [], () => exec(sql))
  }
  return logged
}

async function execSql(
  driver: Driver,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  if (params.length > 0) return driver.query(sql, params)
  if (driver.exec && splitSqlStatements(sql).length > 1) {
    await driver.exec(sql)
    return []
  }
  return driver.query(sql)
}

function isPostgresUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase()
  return normalized.startsWith("postgres://") || normalized.startsWith("postgresql://")
}

/**
 * Cria o banco da aplicação: driver SQLite (`node:sqlite`), instância Drizzle
 * (`drizzle-orm/sqlite-proxy`) e runner de migrations.
 */
export function createDatabase<TSchema extends Record<string, unknown>>(
  options: DatabaseOptions<TSchema>,
): Database {
  const url = options.url
  if (isPostgresUrl(url)) {
    throw databaseError("Postgres chega no M3; use SQLite por enquanto.")
  }

  const file = resolveSqliteFile(url)
  const migrationsDir = resolve(options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR)
  const driver = options.logQueries ? withLogging(sqliteDriver({ file })) : sqliteDriver({ file })

  // A instância é tipada com o schema do usuário; a API pública expõe o tipo base porque
  // setDefaultDatabase/getDefaultDatabase são globais — o `@jot/orm` consulta com as próprias
  // tabelas (builders), não com o API relacional `db.query`.
  const drizzleInstance = drizzle(
    (sql, params, method) => runProxyQuery(driver, sql, params, method),
    { schema: options.schema ?? {} },
  ) as unknown as SqliteRemoteDatabase<Record<string, unknown>>

  const database: Database = {
    url,
    migrationsDir,
    drizzle: drizzleInstance,
    migrate: () => migrate(driver, migrationsDir),
    rollback: (steps) => rollback(driver, migrationsDir, steps),
    exec: (sql, params) => execSql(driver, sql, params),
    async close() {
      await driver.close()
      if (defaultDatabase === database) defaultDatabase = undefined
    },
  }

  return database
}

/** Define o banco global usado pelo `@jot/orm` (chamado pelo `@jot/core` no boot). */
export function setDefaultDatabase(database: Database): void {
  defaultDatabase = database
}

/** Banco global; sem banco configurado, erro didático. */
export function getDefaultDatabase(): Database {
  if (defaultDatabase === undefined) {
    throw databaseError(
      "nenhum banco configurado; defina config/database.ts (o `@jot/core` chama " +
        "setDefaultDatabase no boot) ou chame setDefaultDatabase(db).",
    )
  }
  return defaultDatabase
}
