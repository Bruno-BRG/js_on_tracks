import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { fileURLToPath } from "node:url"

/**
 * Driver de banco do JOT. Os três métodos abaixo são o contrato público (§4.1).
 *
 * `exec` é uma capacidade **opcional** usada pelo runner de migrations e por `db.exec()`
 * quando o SQL tem múltiplos statements: `node:sqlite` só executa vários statements de uma
 * vez via `DatabaseSync.exec()` (o `prepare()` aceita um statement por vez).
 */
export interface Driver {
  /** Executa um SELECT e devolve as linhas (chaves = nomes das colunas). */
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Executa um statement sem resultado (INSERT/UPDATE/DELETE/DDL). */
  run(sql: string, params?: unknown[]): Promise<void>
  /** Executa SQL cru, possivelmente com múltiplos statements. Opcional. */
  exec?(sql: string): Promise<void>
  /** Fecha o banco. Idempotente. */
  close(): Promise<void>
}

export interface SqliteDriverOptions {
  /** Caminho do arquivo (`./db/dev.sqlite`), `file:...` ou `:memory:`. */
  file: string
}

/** Erro didático do `@jot/db`: toda mensagem diz o que fazer. */
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

function assertSingleStatement(sql: string, method: "query" | "run"): void {
  if (!sql.includes(";")) return
  if (splitSqlStatements(sql).length > 1) {
    throw databaseError(
      `${method}() aceita um statement por vez; use exec() para SQL com múltiplos statements.`,
    )
  }
}

function isMemoryFile(file: string): boolean {
  return file === ":memory:" || file === "file::memory:"
}

/**
 * Normaliza a URL aceita em `createDatabase` para o caminho usado pelo `node:sqlite`:
 * `:memory:` (memória), `file:./x.sqlite`, `file:///C:/abs/x.sqlite` ou caminho puro.
 */
export function resolveSqliteFile(url: string): string {
  const trimmed = url.trim()
  if (trimmed === "") {
    throw databaseError(
      'url de banco vazia. Use um caminho de arquivo (ex.: "./db/dev.sqlite"), "file:./db/dev.sqlite" ou ":memory:".',
    )
  }
  if (isMemoryFile(trimmed)) return ":memory:"
  if (trimmed.startsWith("file://")) return fileURLToPath(new URL(trimmed))
  if (trimmed.startsWith("file:")) {
    const withoutScheme = trimmed.slice("file:".length)
    if (isMemoryFile(withoutScheme)) return ":memory:"
    return resolve(withoutScheme)
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
    value instanceof Uint8Array
  ) {
    return value
  }
  throw databaseError(
    `não é possível gravar um valor do tipo ${describeValue(value)} no SQLite. ` +
      "Converta para string, number, bigint, boolean, Date, Uint8Array ou null.",
  )
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  if (typeof value === "object") return value.constructor?.name ?? "object"
  return typeof value
}

/**
 * Driver SQLite sobre o builtin `node:sqlite` (`DatabaseSync`).
 *
 * - `foreign_keys = on` sempre (o contrato não deixa a integridade referencial opcional).
 * - `journal_mode = wal` em bancos de arquivo (nunca em `:memory:`, onde WAL não se aplica).
 * - Diretórios do arquivo são criados se necessário.
 */
export function sqliteDriver(options: SqliteDriverOptions): Driver {
  const file = resolveSqliteFile(options.file)
  if (!isMemoryFile(file)) {
    mkdirSync(dirname(file), { recursive: true })
  }

  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true })
  db.exec("pragma foreign_keys = on")
  if (!isMemoryFile(file)) {
    db.exec("pragma journal_mode = wal")
  }

  const convert = (params: unknown[] | undefined): SQLInputValue[] =>
    (params ?? []).map((value) => toDriverValue(value))

  return {
    async query(sql, params) {
      assertSingleStatement(sql, "query")
      return db.prepare(sql).all(...convert(params))
    },
    async run(sql, params) {
      assertSingleStatement(sql, "run")
      db.prepare(sql).run(...convert(params))
    },
    async exec(sql) {
      db.exec(sql)
    },
    async close() {
      if (db.isOpen) db.close()
    },
  }
}
