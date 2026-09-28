import { existsSync, readdirSync, readFileSync } from "node:fs"
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

function parseMigration(name: string, contents: string): MigrationFile {
  const lines = contents.split(/\r?\n/)
  const markerIndex = lines.findIndex((line) => line.trim() === DOWN_MARKER)
  if (markerIndex === -1) return { name, sql: contents, down: null }
  return {
    name,
    sql: lines.slice(0, markerIndex).join("\n"),
    down: lines.slice(markerIndex + 1).join("\n"),
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
        `migration duplicada: "${previous}" e "${file}" em ${dir}. ` +
          "Renomeie um dos arquivos (os nomes diferem apenas por maiúsculas/minúsculas).",
      )
    }
    seen.set(key, file)
  }
}

/**
 * Lê `*.sql` da pasta, em ordem lexicográfica determinística (não depende de locale).
 * Falha com erro didático para pasta ausente e migrations duplicadas.
 */
export function loadMigrations(migrationsDir: string): MigrationFile[] {
  const dir = resolve(migrationsDir)
  if (!existsSync(dir)) {
    throw databaseError(
      `pasta de migrations não encontrada: ${dir}. ` +
        "Crie a pasta (ex.: db/migrate) ou rode `jot db:generate` para gerar a primeira migration.",
    )
  }

  const files = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".sql"))
  assertNoDuplicateMigrations(files, dir)

  return [...files]
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
        "migrate()/rollback() não podem rodar dentro de outra transação; " +
          "finalize a transação atual antes de aplicar migrations.",
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
        `migration duplicada: "${name}" já está registrada em ${MIGRATIONS_TABLE}. ` +
          "Outro processo pode tê-la aplicado; rode o migrate novamente.",
      )
    }
    throw error
  }
}

async function applyMigration(driver: Driver, migration: MigrationFile): Promise<void> {
  const upSql = migration.sql
  if (splitSqlStatements(upSql).length === 0) {
    throw databaseError(
      `migration "${migration.name}" está vazia: nenhum SQL encontrado antes de "${DOWN_MARKER}". ` +
        "Escreva o SQL ou remova o arquivo.",
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
      throw databaseError(
        `falha ao aplicar a migration "${migration.name}": ${errorMessage(error)}`,
      )
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
      `rollback espera um número inteiro de migrations (>= 1); recebeu ${String(steps)}.`,
    )
  }

  const dir = resolve(migrationsDir)
  const migrations = loadMigrations(dir)
  await ensureMigrationsTable(driver)
  const applied = await getAppliedNames(driver)

  if (applied.length === 0) {
    throw databaseError("não há migrations aplicadas para desfazer.")
  }
  if (steps > applied.length) {
    throw databaseError(
      `rollback pediu ${steps} migration(s), mas apenas ${applied.length} estão aplicadas: ` +
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
        `migration "${name}" registrada em ${MIGRATIONS_TABLE} não existe em ${dir}. ` +
          "Restaure o arquivo ou remova o registro manualmente.",
      )
    }

    const downSql = migration.down
    if (downSql === null) {
      throw databaseError(
        `migration "${name}" não define -- jot:down; crie a seção ou edite o banco manualmente.`,
      )
    }
    if (splitSqlStatements(downSql).length === 0) {
      throw databaseError(
        `a seção -- jot:down da migration "${name}" está vazia; ` +
          "escreva o SQL de rollback ou edite o banco manualmente.",
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
