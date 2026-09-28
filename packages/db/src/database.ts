import { resolve } from "node:path"
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy"
import { type Driver, databaseError, splitSqlStatements, sqliteDriver } from "./driver"
import { migrate, rollback } from "./migrations"

export interface DatabaseOptions<
  TSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Caminho (`./db/dev.sqlite`), `file:...` ou `:memory:`. */
  url: string
  /** O namespace exportado por `db/schema.ts` (o mesmo objeto passado ao Drizzle). */
  schema: TSchema
  /** Raiz do app usada para resolver `migrationsDir` relativo. Default: `process.cwd()`. */
  root?: string
  /** Pasta com `*.sql`; default: `db/migrate` relativo a `root`. */
  migrationsDir?: string
  /** Loga SQL, params e duração via `console.debug` (dev only). */
  logQueries?: boolean
  /** Inclui os valores dos params no log (default true). Use false para não vazar segredos. */
  logParams?: boolean
}

export interface Database {
  readonly url: string
  readonly root: string
  readonly migrationsDir: string
  /** Instância Drizzle (sqlite-proxy) usada pelo `@jot/orm`. */
  readonly drizzle: SqliteRemoteDatabase<Record<string, unknown>>
  /** Aplica as migrations pendentes; devolve os nomes aplicados nesta chamada. */
  migrate(): Promise<string[]>
  /** Desfaz as últimas N migrations (default 1); devolve os nomes desfeitos. */
  rollback(steps?: number): Promise<string[]>
  /**
   * SQL cru no driver. Sem params aceita múltiplos statements (não atômico: cada statement é
   * aplicado direto, sem transação — use `migrate()` para DDL atômico). Devolve `[]` para DDL.
   */
  exec(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Fecha o banco (remove o default database, se for ele). */
  close(): Promise<void>
}

const DEFAULT_MIGRATIONS_DIR = "db/migrate"

let defaultDatabase: Database | undefined

type ProxyMethod = "run" | "all" | "values" | "get"

/**
 * Linhas **posicionais** para o Drizzle. Usa `Driver.queryArrays` (preserva colunas de mesmo
 * nome, ex.: joins) e cai para `Object.values(query())` em drivers sem a capacidade.
 */
async function positionalRows(
  driver: Driver,
  sql: string,
  params: unknown[],
): Promise<unknown[][]> {
  if (driver.queryArrays) return driver.queryArrays(sql, params)
  const rows = await driver.query(sql, params)
  return rows.map((row) => Object.values(row))
}

/**
 * Ponte entre Drizzle (sqlite-proxy) e o `Driver`.
 *
 * Contrato confirmado empiricamente (drizzle-orm 0.45):
 * - `all`/`values`: `rows` é um array de linhas **posicionais** (valores na ordem das colunas).
 * - `get`: `rows` é **uma** linha posicional (não um array de linhas) — ou ausente quando não há
 *   resultado; drizzle trata `rows` ausente como "não encontrado".
 * - `run`: o retorno é ignorado; devolvemos `{ rows: [] }`.
 *
 * A leitura usa `queryArrays` (`setReturnArrays` do node:sqlite): mapear `Object.values` de
 * `query()` desalinharia silenciosamente joins com nomes de coluna repetidos.
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
    const row = (await positionalRows(driver, sql, params))[0]
    if (row === undefined) {
      // O tipo do drizzle marca `rows` como opcional; ausente = sem resultado.
      return { rows: undefined as unknown as unknown[] }
    }
    return { rows: row }
  }

  return { rows: await positionalRows(driver, sql, params) }
}

function formatParams(params: unknown[]): string {
  try {
    return JSON.stringify(params, (_key, value: unknown) => {
      if (typeof value === "bigint") return `${value}n`
      if (ArrayBuffer.isView(value)) return `<${value.byteLength} bytes>`
      return value
    })
  } catch {
    return String(params)
  }
}

function logQuery(sql: string, params: unknown[], durationMs: number, logParams: boolean): void {
  const rendered = logParams ? formatParams(params) : "[omitted]"
  console.debug(`[jot/db] ${sql} -- params: ${rendered} (${durationMs.toFixed(1)}ms)`)
}

/** Decora o driver logando SQL, params e duração (inclui migrations e `db.exec`). */
function withLogging(driver: Driver, logParams: boolean): Driver {
  const timed = async <T>(sql: string, params: unknown[], run: () => Promise<T>): Promise<T> => {
    const started = performance.now()
    try {
      return await run()
    } finally {
      logQuery(sql, params, performance.now() - started, logParams)
    }
  }

  const logged: Driver = {
    query: (sql, params = []) => timed(sql, params, () => driver.query(sql, params)),
    run: (sql, params = []) => timed(sql, params, () => driver.run(sql, params)),
    close: () => driver.close(),
  }

  const queryArrays = driver.queryArrays?.bind(driver)
  if (queryArrays) {
    logged.queryArrays = (sql, params = []) => timed(sql, params, () => queryArrays(sql, params))
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
  if (params.length > 0) {
    if (splitSqlStatements(sql).length > 1) {
      throw databaseError(
        "exec() with params accepts one statement at a time; remove the params or split the SQL.",
      )
    }
    return driver.query(sql, params)
  }
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
    throw databaseError("Postgres support arrives in M3; use SQLite for now.")
  }

  const root = resolve(options.root ?? process.cwd())
  const migrationsDir = resolve(root, options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR)
  const logParams = options.logParams !== false
  const driver = options.logQueries
    ? withLogging(sqliteDriver({ file: url }), logParams)
    : sqliteDriver({ file: url })

  // A instância é tipada com o schema do usuário; a API pública expõe o tipo base porque
  // setDefaultDatabase/getDefaultDatabase são globais — o `@jot/orm` consulta com as próprias
  // tabelas (builders), não com o API relacional `db.query`.
  const drizzleInstance = drizzle(
    (sql, params, method) => runProxyQuery(driver, sql, params, method),
    { schema: options.schema },
  ) as unknown as SqliteRemoteDatabase<Record<string, unknown>>

  const database: Database = {
    url,
    root,
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
      "no database configured; define config/database.ts (the `@jot/core` calls " +
        "setDefaultDatabase on boot) or call setDefaultDatabase(db).",
    )
  }
  return defaultDatabase
}
