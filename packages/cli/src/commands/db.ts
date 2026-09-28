import { existsSync, readdirSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { assertKnownFlags, type ParsedArgv } from "../args"
import { assertDatabase, collect } from "../collect"
import { CliError, log } from "../output"
import { NODE_FLAGS, resolvePackageBin, resolveTsx, runChild } from "../spawn"

/** Implementa `jot db:generate`: roda `drizzle-kit generate` e explica quando nada foi gerado. */
export async function runDbGenerate(parsed: ParsedArgv): Promise<number> {
  assertKnownFlags(parsed, [], "jot db:generate")
  const root = resolve(process.cwd())

  if (!existsSync(join(root, "drizzle.config.ts"))) {
    throw new CliError(
      `drizzle.config.ts not found in ${root}. Run this from your app root ` +
        "(or create one with `jot new myapp`).",
    )
  }
  if (!existsSync(join(root, "db", "schema.ts"))) {
    throw new CliError(
      'db/schema.ts not found. Create it (e.g. `export const posts = table("posts", { id: id() })`) ' +
        "and run `jot db:generate` again.",
    )
  }

  const before = countMigrations(root)
  const bin = resolvePackageBin("drizzle-kit", "drizzle-kit")
  const packageRoot = dirname(bin)
  const nodeModules = dirname(packageRoot)

  const code = await runChild(process.execPath, [bin, "generate"], {
    cwd: root,
    // O `drizzle.config.ts` do app importa "drizzle-kit"; se ele não estiver visível
    // a partir do app, o require interno falha. NODE_PATH aponta para o dir que o contém.
    env: {
      NODE_PATH: [nodeModules, process.env.NODE_PATH].filter(Boolean).join(delimiter),
    },
  })
  if (code !== 0) return code

  if (countMigrations(root) === before) {
    log(
      "No migration generated: db/schema.ts has no tables yet. Define at least one table " +
        "(see the comments in db/schema.ts) and run `jot db:generate` again.",
    )
  }
  return 0
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

function countMigrations(root: string): number {
  const dir = join(root, "db", "migrate")
  if (!existsSync(dir)) return 0
  return readdirSync(dir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".sql"),
  ).length
}
