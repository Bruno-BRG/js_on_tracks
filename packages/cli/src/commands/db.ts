import { existsSync, readdirSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { assertKnownFlags, type ParsedArgv } from "../args"
import { assertDatabase, collect } from "../collect"
import { CliError, log } from "../output"
import { NODE_FLAGS, resolvePackageBin, resolveTsx, runChild } from "../spawn"

/** Mensagem única para quando o drizzle-kit não vê mudanças no schema. */
export const NO_SCHEMA_CHANGES_MESSAGE =
  "No migration generated: no schema changes detected. Edit db/schema.ts and run `jot db:generate` again."

export interface GenerateMigrationsOptions {
  /** Valor de `--name` (ex.: `create_posts`) — sem ele o sufixo do arquivo é aleatório. */
  readonly name?: string
}

export interface GenerateMigrationsResult {
  readonly before: readonly string[]
  readonly after: readonly string[]
  /** Arquivos `db/migrate/*.sql` criados nesta chamada (relativos, posix). */
  readonly created: readonly string[]
  readonly exitCode: number
}

/**
 * Roda `drizzle-kit generate` sem depender de `node_modules/.bin` (NODE_PATH
 * resolve o import interno do `drizzle.config.ts`) e devolve o que mudou.
 */
export async function generateMigrations(
  root: string,
  options: GenerateMigrationsOptions = {},
): Promise<GenerateMigrationsResult> {
  const appRoot = resolve(root)

  if (!existsSync(join(appRoot, "drizzle.config.ts"))) {
    throw new CliError(
      `drizzle.config.ts not found in ${appRoot}. Run this from your app root ` +
        "(or create one with `jot new myapp`).",
    )
  }
  if (!existsSync(join(appRoot, "db", "schema.ts"))) {
    throw new CliError(
      'db/schema.ts not found. Create it (e.g. `export const posts = table("posts", { id: id() })`) ' +
        "and run `jot db:generate` again.",
    )
  }

  const before = listMigrations(appRoot)
  const bin = resolvePackageBin("drizzle-kit", "drizzle-kit")
  const packageRoot = dirname(bin)
  const nodeModules = dirname(packageRoot)
  const args = [bin, "generate"]
  if (options.name !== undefined) args.push("--name", options.name)

  const exitCode = await runChild(process.execPath, args, {
    cwd: appRoot,
    // O `drizzle.config.ts` do app importa "drizzle-kit"; se ele não estiver visível
    // a partir do app, o require interno falha. NODE_PATH aponta para o dir que o contém.
    env: {
      NODE_PATH: [nodeModules, process.env.NODE_PATH].filter(Boolean).join(delimiter),
    },
  })

  const after = listMigrations(appRoot)
  const created = after.filter((file) => !before.includes(file))
  return { before, after, created, exitCode }
}

/** Implementa `jot db:generate`. */
export async function runDbGenerate(parsed: ParsedArgv): Promise<number> {
  assertKnownFlags(parsed, [], "jot db:generate")
  const result = await generateMigrations(resolve(process.cwd()))
  if (result.exitCode !== 0) return result.exitCode
  if (result.created.length === 0) log(NO_SCHEMA_CHANGES_MESSAGE)
  return 0
}

/** Arquivos `*.sql` top-level de `db/migrate`, ordenados (o runner ignora `meta/`). */
export function listMigrations(root: string): string[] {
  const dir = join(root, "db", "migrate")
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => `db/migrate/${entry.name}`)
    .sort()
}

/** Implementa `jot db:migrate`: aplica as migrations pendentes via `.jot/db-script.ts`. */
export async function runDbMigrate(parsed: ParsedArgv): Promise<number> {
  assertKnownFlags(parsed, [], "jot db:migrate")
  return runDbScript("migrate", [])
}

/** Implementa `jot db:rollback [n]`: desfaz as últimas n migrations (default 1). */
export async function runDbRollback(parsed: ParsedArgv): Promise<number> {
  assertKnownFlags(parsed, [], "jot db:rollback [n]")
  const raw = parsed.positionals[0]
  const count = raw === undefined ? 1 : parseRollbackCount(raw)
  const extra = parsed.positionals[1]
  if (extra !== undefined) {
    throw new CliError(
      `Unexpected argument "${extra}". Usage: \`jot db:rollback [n]\` with a positive integer (default 1).`,
    )
  }
  return runDbScript("rollback", [String(count)])
}

async function runDbScript(
  command: "migrate" | "rollback",
  args: readonly string[],
): Promise<number> {
  const root = resolve(process.cwd())
  assertDatabase(root)
  collect(root)
  resolveTsx(root)
  return runChild(process.execPath, [...NODE_FLAGS, ".jot/db-script.ts", command, ...args], {
    cwd: root,
  })
}

function parseRollbackCount(raw: string): number {
  const count = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isInteger(count) || count < 1) {
    throw new CliError(
      `Invalid rollback count "${raw}". Usage: \`jot db:rollback [n]\` with a positive integer (default 1).`,
    )
  }
  return count
}
