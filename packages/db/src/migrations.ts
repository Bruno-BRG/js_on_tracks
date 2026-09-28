import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { type Driver, databaseError, splitSqlStatements } from "./driver"

/** Tabela de controle das migrations (formato do contrato §4.1). */
export const MIGRATIONS_TABLE = "jot_migrations"

/** Marcador que separa o SQL de ida do SQL de rollback. */
export const DOWN_MARKER = "-- jot:down"

export interface MigrationFile {
  name: string
  /** SQL de aplicação (tudo antes de `-- jot:down`). */
  sql: string
  /** SQL de rollback (tudo depois de `-- jot:down`) ou `null` quando não há seção. */
  down: string | null
}

const CREATE_MIGRATIONS_TABLE =
  `create table if not exists ${MIGRATIONS_TABLE} ` +
  "(id integer primary key, name text not null unique, applied_at integer)"

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Índice da linha que contém apenas `-- jot:down`, considerando só o nível de topo:
 * o texto `-- jot:down` dentro de string multilinha ou comentário de bloco não conta.
 */
function findDownMarkerLine(contents: string): number | null {
  const lines = contents.split(/\r?\n/)
  let quote: string | null = null
  let inBlockComment = false

  for (const [lineIndex, line] of lines.entries()) {
    if (quote === null && !inBlockComment && line.trim() === DOWN_MARKER) return lineIndex

    let index = 0
    while (index < line.length) {
      const char = line.charAt(index)
      const next = line[index + 1]

      if (inBlockComment) {
        if (char === "*" && next === "/") {
          inBlockComment = false
          index += 2
          continue
        }
        index++
        continue
      }

      if (quote !== null) {
        if (char === quote) {
          if (line[index + 1] === quote) {
            // Escape do SQLite: '' / "" / `` dentro da string/identificador.
            index += 2
            continue
          }
          quote = null
        }
        index++
        continue
      }

      if (char === "-" && next === "-") break
      if (char === "/" && next === "*") {
        inBlockComment = true
        index += 2
        continue
      }
      if (char === "'" || char === '"' || char === "`") {
        quote = char
        index++
        continue
      }
      index++
    }
  }
  return null
}

function parseMigration(name: string, contents: string): MigrationFile {
  const markerLine = findDownMarkerLine(contents)
  if (markerLine === null) return { name, sql: contents, down: null }
  const lines = contents.split(/\r?\n/)
  return {
    name,
    sql: lines.slice(0, markerLine).join("\n"),
    down: lines.slice(markerLine + 1).join("\n"),
  }
}

/**
 * Valida nomes duplicados (inclusive quando diferem só por maiúsculas/minúsculas, o que
 * quebra o runner em sistemas de arquivos case-sensitive). Exportada para os testes.
 */
export function assertNoDuplicateMigrations(files: string[], dir: string): void {
  const seen = new Map<string, string>()
  for (const file of files) {
    const key = file.toLowerCase()
    const previous = seen.get(key)
    if (previous !== undefined) {
      throw databaseError(
        `duplicate migration: "${previous}" and "${file}" in ${dir}. ` +
          "Rename one of the files (the names differ only by letter case).",
      )
    }
    seen.set(key, file)
  }
}

/**
 * Lê `*.sql` da pasta, em ordem lexicográfica determinística (não depende de locale; o
 * drizzle-kit usa prefixos de largura fixa, ex.: `0001_`). Falha com erro didático para
 * pasta ausente, entrada que não é arquivo e migrations duplicadas.
 */
export function loadMigrations(migrationsDir: string): MigrationFile[] {
  const dir = resolve(migrationsDir)
  if (!existsSync(dir)) {
    throw databaseError(
      `migrations directory not found: ${dir}. ` +
        "Create it (e.g. db/migrate) or run `jot db:generate` to generate the first migration.",
    )
  }

  const entries = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".sql"))
  const files: string[] = []
  for (const entry of entries) {
    if (!statSync(join(dir, entry)).isFile()) {
      throw databaseError(
        `"${entry}" in ${dir} is a directory, not a migration file. Remove it or rename it.`,
      )
    }
    files.push(entry)
  }
  assertNoDuplicateMigrations(files, dir)

  return files
    .sort(compareNames)
    .map((name) => parseMigration(name, readFileSync(join(dir, name), "utf8")))
}

async function ensureMigrationsTable(driver: Driver): Promise<void> {
  await driver.run(CREATE_MIGRATIONS_TABLE)
}

async function getAppliedNames(driver: Driver): Promise<string[]> {
  const rows = await driver.query(`select name from ${MIGRATIONS_TABLE} order by id asc`)
  return rows.map((row) => String(row.name))
}

/**
 * Executa `work` em uma transação quando o driver aceitar `begin`.
 * Sem suporte a transação, aplica mesmo assim (statement a statement) e propaga o erro —
 * nesse caso uma falha no meio pode deixar a migration parcialmente aplicada.
 */
async function runAtomically(driver: Driver, work: () => Promise<void>): Promise<void> {
  let transactional = true
  try {
    await driver.run("begin")
  } catch (error) {
    if (/within a transaction|cannot start a transaction/i.test(errorMessage(error))) {
      throw databaseError(
        "migrate()/rollback() cannot run inside another transaction; " +
          "finish the current transaction before applying migrations.",
      )
    }
    transactional = false
  }

  try {
    await work()
    if (transactional) await driver.run("commit")
  } catch (error) {
    if (transactional) {
      try {
        await driver.run("rollback")
      } catch {
        // O banco pode já ter desfeito a transação (ex.: erro que aborta o statement).
      }
    }
    throw error
  }
}

/** Aplica o SQL: `exec` (multi-statement) quando disponível, senão statement a statement. */
async function applySql(driver: Driver, sql: string): Promise<void> {
  if (driver.exec) {
    await driver.exec(sql)
    return
  }
  for (const statement of splitSqlStatements(sql)) {
    await driver.run(statement)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /unique constraint failed/i.test(error.message)
}

async function registerMigration(driver: Driver, name: string): Promise<void> {
  try {
    await driver.run(`insert into ${MIGRATIONS_TABLE} (name, applied_at) values (?, ?)`, [
      name,
      Date.now(),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw databaseError(
        `duplicate migration: "${name}" is already registered in ${MIGRATIONS_TABLE}. ` +
          "Another process may have applied it; run migrate again.",
      )
    }
    throw error
  }
}

async function applyMigration(driver: Driver, migration: MigrationFile): Promise<void> {
  const upSql = migration.sql
  if (splitSqlStatements(upSql).length === 0) {
    throw databaseError(
      `migration "${migration.name}" is empty: no SQL found before "${DOWN_MARKER}". ` +
        "Write the SQL or delete the file.",
    )
  }

  await runAtomically(driver, async () => {
    await applySql(driver, upSql)
    await registerMigration(driver, migration.name)
  })
}

/**
 * Aplica as migrations pendentes em ordem de nome e registra em `jot_migrations`.
 * Idempotente: rodar duas vezes não reaplica o que já foi registrado.
 * Devolve os nomes aplicados nesta chamada (vazio quando não havia nada pendente).
 */
export async function migrate(driver: Driver, migrationsDir: string): Promise<string[]> {
  const migrations = loadMigrations(migrationsDir)
  await ensureMigrationsTable(driver)
  const applied = new Set(await getAppliedNames(driver))

  const ran: string[] = []
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue
    try {
      await applyMigration(driver, migration)
    } catch (error) {
      throw databaseError(`failed to apply migration "${migration.name}": ${errorMessage(error)}`)
    }
    applied.add(migration.name)
    ran.push(migration.name)
  }
  return ran
}

/**
 * Desfaz as `steps` últimas migrations (default 1), da mais recente para a mais antiga,
 * usando a seção `-- jot:down`. Devolve os nomes desfeitos, na ordem em que foram desfeitos.
 */
export async function rollback(
  driver: Driver,
  migrationsDir: string,
  steps = 1,
): Promise<string[]> {
  if (!Number.isInteger(steps) || steps < 1) {
    throw databaseError(
      `rollback expects an integer number of migrations (>= 1); received ${String(steps)}.`,
    )
  }

  const dir = resolve(migrationsDir)
  const migrations = loadMigrations(dir)
  await ensureMigrationsTable(driver)
  const applied = await getAppliedNames(driver)

  if (applied.length === 0) {
    throw databaseError("there are no applied migrations to roll back.")
  }
  if (steps > applied.length) {
    throw databaseError(
      `rollback asked for ${steps} migration(s), but only ${applied.length} are applied: ` +
        `${applied.join(", ")}.`,
    )
  }

  const byName = new Map(migrations.map((migration) => [migration.name, migration]))

  // Valida todas as etapas antes de alterar qualquer coisa: erro de configuração
  // (seção ausente/vazia, arquivo removido) não desfaz migrations parciais.
  const targets: Array<{ name: string; downSql: string }> = []
  for (const name of applied.slice(-steps).reverse()) {
    const migration = byName.get(name)
    if (!migration) {
      throw databaseError(
        `migration "${name}" registered in ${MIGRATIONS_TABLE} does not exist in ${dir}. ` +
          "Restore the file or remove the record manually.",
      )
    }

    const downSql = migration.down
    if (downSql === null) {
      throw databaseError(
        `migration "${name}" does not define -- jot:down; add the section or edit the database manually.`,
      )
    }
    if (splitSqlStatements(downSql).length === 0) {
      throw databaseError(
        `the -- jot:down section of migration "${name}" is empty; ` +
          "write the rollback SQL or edit the database manually.",
      )
    }
    targets.push({ name, downSql })
  }

  // Um único rollback() é atômico no driver transacional: ou desfaz todas as etapas, ou nenhuma.
  await runAtomically(driver, async () => {
    for (const target of targets) {
      await applySql(driver, target.downSql)
      await driver.run(`delete from ${MIGRATIONS_TABLE} where name = ?`, [target.name])
    }
  })

  return targets.map((target) => target.name)
}
