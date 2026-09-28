import { type ParsedArgv, parseArgv } from "./args"
import { runConsole } from "./commands/console"
import { runDbGenerate, runDbMigrate, runDbRollback } from "./commands/db"
import { runNew } from "./commands/new"
import { runRoutes } from "./commands/routes"
import { runServer } from "./commands/server"
import { runGenerate } from "./generate/index"
import { CliError, cliVersion, log, printError } from "./output"

type CommandRunner = (parsed: ParsedArgv) => Promise<number>

/** Ordem fixa do help e das sugestões de comando desconhecido. */
const COMMANDS: Record<string, CommandRunner> = {
  new: runNew,
  generate: runGenerate,
  g: runGenerate,
  server: runServer,
  "db:generate": runDbGenerate,
  "db:migrate": runDbMigrate,
  "db:rollback": runDbRollback,
  routes: runRoutes,
  console: runConsole,
}

/**
 * Ponto de entrada da CLI: devolve o exit code (o bin assume `process.exitCode`,
 * nunca `process.exit`). Erros previstos saem como `error: ...` + hint em inglês.
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  try {
    const parsed = parseArgv(argv)
    if (parsed.version) {
      log(cliVersion())
      return 0
    }
    if (parsed.help) {
      printHelp()
      return 0
    }
    if (parsed.command === undefined) {
      printHelp()
      return 1
    }
    const runner = Object.hasOwn(COMMANDS, parsed.command) ? COMMANDS[parsed.command] : undefined
    if (runner === undefined) {
      printError(new CliError(unknownCommandMessage(parsed.command)))
      return 1
    }
    return await runner(parsed)
  } catch (error) {
    printError(toCliError(error))
    return 1
  }
}

function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new CliError(`Unexpected failure: ${message}`)
}

function unknownCommandMessage(command: string): string {
  const suggestion = closestCommand(command)
  const hinted = suggestion === undefined ? "" : `Did you mean \`jot ${suggestion}\`? `
  return `Unknown command "${command}". ${hinted}Run \`jot --help\` for the list of commands.`
}

function closestCommand(command: string): string | undefined {
  let best: { name: string; distance: number } | undefined
  const normalized = command.toLowerCase()
  for (const name of Object.keys(COMMANDS)) {
    const distance = levenshtein(normalized, name.toLowerCase())
    if (distance <= 2 && (best === undefined || distance < best.distance)) {
      best = { name, distance }
    }
  }
  return best?.name
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_value, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const saved = previous[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost)
      diagonal = saved
    }
  }
  return previous[b.length]
}

function printHelp(): void {
  const lines = [
    `JOT v${cliVersion()}`,
    "",
    "Usage:",
    "  jot new <name> [--no-install]   Create a new app in <name>/",
    "  jot generate model <Name> [field:type[!] ...] [--no-db-generate]      Add a model and its table",
    "  jot generate scaffold <Name> [field:type[!] ...] [--no-db-generate]   Add model, controller, views and routes",
    "  jot g model|scaffold <Name> [field:type[!] ...] [--no-db-generate]   Alias for jot generate",
    "  jot server                      Start the dev server (watch mode)",
    "  jot db:generate                 Generate a migration from db/schema.ts",
    "  jot db:migrate                  Apply pending migrations",
    "  jot db:rollback [n]             Roll back the last n migrations (default 1)",
    "  jot routes                      Print the resolved route table",
    "  jot console                     Open a REPL with db, models and paths",
    "  jot --help                      Show this help",
    "  jot --version                   Show the CLI version",
    "",
    "Run from your app root (the folder with config/routes.ts).",
  ]
  log(lines.join("\n"))
}
