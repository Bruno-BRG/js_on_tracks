import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { fileURLToPath } from "node:url"

/** Busy timeout em ms: espera uma conexão concorrente liberar o lock antes de falhar. */
const BUSY_TIMEOUT_MS = 5000

/**
 * Driver de banco do JOT. Os três primeiros métodos são o contrato público (§4.1).
 *
 * `exec` e `queryArrays` são capacidades **opcionais** usadas pelo `createDatabase`:
 * - `exec`: `DatabaseSync.exec()` roda vários statements de uma vez (o `prepare()` aceita um
 *   statement por vez e ignora o restante em silêncio).
 * - `queryArrays`: leitura **posicional**; `node:sqlite` devolve objetos indexados pelo nome da
 *   coluna e nomes repetidos (joins) colapsam chaves, corrompendo a leitura.
 */
export interface Driver {
  /** Executa um SELECT e devolve as linhas (chaves = nomes das colunas). */
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Executa um statement sem resultado (INSERT/UPDATE/DELETE/DDL). */
  run(sql: string, params?: unknown[]): Promise<void>
  /** Executa SQL cru, possivelmente com múltiplos statements. Opcional. */
  exec?(sql: string): Promise<void>
  /** Executa um SELECT devolvendo linhas posicionais (preserva colunas de mesmo nome). Opcional. */
  queryArrays?(sql: string, params?: unknown[]): Promise<unknown[][]>
  /** Fecha o banco. Idempotente. */
  close(): Promise<void>
}

export interface SqliteDriverOptions {
  /** Caminho do arquivo (`./db/dev.sqlite`), `file:...` ou `:memory:`. */
  file: string
}

/** Erro didático do `@js_on_tracks/db`: toda mensagem diz o que fazer. */
export function databaseError(message: string): Error {
  return new Error(`[jot/db] ${message}`)
}

/**
 * Quebra um SQL em statements respeitando strings, identificadores e comentários.
 * `;` só separa fora de strings e identificadores (`'...'`, `"..."`, crases, `[...]`) e de
 * comentários de linha (`--`) e de bloco.
 *
 * Necessário porque `DatabaseSync.prepare()` compila **apenas o primeiro** statement do texto
 * e ignora o restante silenciosamente; por isso `query()`/`run()` recusam SQL multi-statement
 * e as migrations usam `exec()`.
 *
 * Limitação conhecida (documentada): `;` dentro de `CREATE TRIGGER ... BEGIN ... END`
 * separa os statements. Migrations do drizzle-kit não geram triggers; se precisar,
 * aplique o trigger fora do runner.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ""
  let index = 0

  while (index < sql.length) {
    const char = sql.charAt(index)
    const next = sql[index + 1]

    if (char === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") index++
      current += " "
      continue
    }

    if (char === "/" && next === "*") {
      index += 2
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index++
      index += 2
      current += " "
      continue
    }

    if (char === "'" || char === '"' || char === "`") {
      current += char
      index++
      while (index < sql.length) {
        const inner = sql.charAt(index)
        current += inner
        index++
        if (inner !== char) continue
        if (sql[index] === char) {
          // Escape do SQLite: '' / "" / `` dentro da string/identificador.
          current += char
          index++
          continue
        }
        break
      }
      continue
    }

    if (char === "[") {
      current += char
      index++
      while (index < sql.length) {
        const inner = sql.charAt(index)
        current += inner
        index++
        if (inner === "]") break
      }
      continue
    }

    if (char === ";") {
      const statement = current.trim()
      if (statement !== "") statements.push(statement)
      current = ""
      index++
      continue
    }

    current += char
    index++
  }

  const statement = current.trim()
  if (statement !== "") statements.push(statement)
  return statements
}

function assertSingleStatement(sql: string, method: "query" | "queryArrays" | "run"): void {
  if (!sql.includes(";")) return
  if (splitSqlStatements(sql).length > 1) {
    throw databaseError(
      `${method}() accepts one statement at a time; use exec() for multi-statement SQL.`,
    )
  }
}

/** `:memory:` e variantes aceitas (`file::memory:`, com ou sem query string). */
function isMemoryUrl(value: string): boolean {
  return (
    value === ":memory:" ||
    value === "file::memory:" ||
    value.startsWith(":memory:?") ||
    value.startsWith("file::memory:?")
  )
}

function decodeUrlPath(path: string, url: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    throw databaseError(`invalid percent-encoding in database url "${url}".`)
  }
}

/**
 * Normaliza a URL aceita em `createDatabase` para o caminho usado pelo `node:sqlite`:
 * `:memory:` (memória), `file:./x.sqlite`, `file:///C:/abs/x.sqlite` ou caminho puro.
 * `file:` relativo é percent-decodificado; `file://` com host não-local é rejeitado.
 */
export function resolveSqliteFile(url: string): string {
  const trimmed = url.trim()
  if (trimmed === "") {
    throw databaseError(
      'database url is empty. Use a file path (e.g. "./db/dev.sqlite"), "file:./db/dev.sqlite" or ":memory:".',
    )
  }
  if (isMemoryUrl(trimmed)) return ":memory:"

  if (trimmed.startsWith("file://")) {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      throw databaseError(
        `invalid database url: "${url}". Use a file path, "file:./db/dev.sqlite" or ":memory:".`,
      )
    }
    if (parsed.hostname !== "" && parsed.hostname !== "localhost") {
      throw databaseError(
        `unsupported host "${parsed.hostname}" in database url "${url}"; ` +
          "use a local file path or :memory:.",
      )
    }
    return fileURLToPath(parsed)
  }

  if (trimmed.startsWith("file:")) {
    const withoutScheme = trimmed.slice("file:".length)
    if (isMemoryUrl(withoutScheme)) return ":memory:"
    return resolve(decodeUrlPath(withoutScheme, url))
  }

  return resolve(trimmed)
}

/**
 * Converte valores JS para o que o SQLite aceita, na fronteira do driver:
 * `boolean` → 0/1, `Date` → epoch ms, `undefined` → `null`.
 */
export function toDriverValue(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null
  if (typeof value === "boolean") return value ? 1 : 0
  if (value instanceof Date) return value.getTime()
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string" ||
    ArrayBuffer.isView(value)
  ) {
    // O alias `SQLInputValue` do @types/node é mais estreito que o runtime do node:sqlite,
    // que aceita qualquer ArrayBufferView (TypedArray/DataView, inclusive Buffer).
    return value as SQLInputValue
  }
  throw databaseError(
    `cannot store a value of type ${describeValue(value)} in SQLite. ` +
      "Convert it to string, number, bigint, boolean, Date, Uint8Array or null.",
  )
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  if (typeof value === "object") return value.constructor?.name ?? "object"
  return typeof value
}

function translateLockError(error: unknown): unknown {
  if (error instanceof Error && /database is locked|SQLITE_BUSY/i.test(error.message)) {
    return databaseError(
      "database is locked: another connection is writing. Wait a moment and try again.",
    )
  }
  return error
}

/**
 * Driver SQLite sobre o builtin `node:sqlite` (`DatabaseSync`).
 *
 * - `foreign_keys = on` sempre (o contrato não deixa a integridade referencial opcional).
 * - `journal_mode = wal` em bancos de arquivo (nunca em `:memory:`, onde WAL não se aplica).
 * - Diretórios do arquivo são criados se necessário.
 * - Busy timeout de 5s e erro didático para `database is locked` (concorrência entre conexões).
 */
export function sqliteDriver(options: SqliteDriverOptions): Driver {
  const file = resolveSqliteFile(options.file)
  if (file !== ":memory:") {
    mkdirSync(dirname(file), { recursive: true })
  }

  const db = new DatabaseSync(file, {
    enableForeignKeyConstraints: true,
    timeout: BUSY_TIMEOUT_MS,
  })
  db.exec("pragma foreign_keys = on")
  if (file !== ":memory:") {
    db.exec("pragma journal_mode = wal")
  }

  const convert = (params: unknown[] | undefined): SQLInputValue[] =>
    (params ?? []).map((value) => toDriverValue(value))

  const translate = async <T>(work: () => T | Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      throw translateLockError(error)
    }
  }

  return {
    async query(sql, params) {
      assertSingleStatement(sql, "query")
      return translate(() => db.prepare(sql).all(...convert(params)))
    },
    async run(sql, params) {
      assertSingleStatement(sql, "run")
      await translate(() => {
        db.prepare(sql).run(...convert(params))
      })
    },
    async exec(sql) {
      await translate(() => {
        db.exec(sql)
      })
    },
    async queryArrays(sql, params) {
      assertSingleStatement(sql, "queryArrays")
      return translate(() => {
        const statement = db.prepare(sql)
        if (typeof statement.setReturnArrays === "function") {
          statement.setReturnArrays(true)
          return statement.all(...convert(params)) as unknown as unknown[][]
        }
        // Node sem setReturnArrays: posicional via Object.values (nomes repetidos colapsam).
        return statement.all(...convert(params)).map((row) => Object.values(row))
      })
    },
    async close() {
      if (db.isOpen) db.close()
    },
  }
}
