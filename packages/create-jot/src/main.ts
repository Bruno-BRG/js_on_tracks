import { createRequire } from "node:module"
import { createInterface } from "node:readline/promises"
import { CliError, newProject, printError } from "@jot/cli"

/** Saída de mensagens do create-jot (injetável em testes). */
export interface CreateJotOutput {
  write(text: string): unknown
}

export interface CreateJotOptions {
  /** Diretório onde o app será criado (default: `process.cwd()`). */
  cwd?: string
  /** Destino do help/versão (default: `process.stdout`). */
  stdout?: CreateJotOutput
}

interface CreateJotArgs {
  readonly name: string | undefined
  readonly noInstall: boolean
  readonly help: boolean
  readonly version: boolean
}

/**
 * Ponto de entrada do `create-jot` (`npm create jot@latest`): pergunta o nome
 * quando ele não vem no argv e delega para a mesma `newProject` do `jot new`.
 */
export async function runCreateJot(
  argv: readonly string[],
  options: CreateJotOptions = {},
): Promise<number> {
  const out = options.stdout ?? process.stdout
  try {
    const parsed = parseArgs(argv)
    if (parsed.version) {
      out.write(`${packageVersion()}\n`)
      return 0
    }
    if (parsed.help) {
      printHelp(out)
      return 0
    }
    const name = parsed.name ?? (await promptName(out))
    await newProject(name, { cwd: options.cwd, install: !parsed.noInstall })
    return 0
  } catch (error) {
    if (error instanceof CliError) {
      printError(error)
      return 1
    }
    throw error
  }
}

function parseArgs(argv: readonly string[]): CreateJotArgs {
  const names: string[] = []
  let noInstall = false
  let help = false
  let version = false
  let flagsDone = false

  for (const token of argv) {
    if (!flagsDone && token === "--") {
      flagsDone = true
      continue
    }
    if (!flagsDone && (token === "-h" || token === "--help")) {
      help = true
      continue
    }
    if (!flagsDone && (token === "-v" || token === "--version")) {
      version = true
      continue
    }
    if (!flagsDone && token === "--no-install") {
      noInstall = true
      continue
    }
    if (!flagsDone && token.startsWith("-") && token.length > 1) {
      throw new CliError(`Unknown option "${token}". Run \`create-jot --help\`.`)
    }
    names.push(token)
  }

  return { name: names[0], noInstall, help, version }
}

async function promptName(out: CreateJotOutput): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new CliError(
      "Missing project name. Usage: `npm create jot@latest <name>`.",
      "Or run `create-jot <name>` passing the name directly.",
    )
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    for (;;) {
      const answer = (await rl.question("Project name: ")).trim()
      if (answer.length > 0) return answer
      out.write("Please enter a project name.\n")
    }
  } finally {
    rl.close()
  }
}

function printHelp(out: CreateJotOutput): void {
  out.write(
    [
      "create-jot — scaffold a new JOT app",
      "",
      "Usage:",
      "  npm create jot@latest <name> [--no-install]",
      "  create-jot <name> [--no-install]",
      "",
      "Options:",
      "  --no-install    Skip `npm install` (install the dependencies yourself)",
      "  -h, --help      Show this help",
      "  -v, --version   Show the create-jot version",
      "",
      "Without <name>, create-jot asks for the project name.",
      "",
    ].join("\n"),
  )
}

function packageVersion(): string {
  const require = createRequire(import.meta.url)
  const pkg = require("../package.json") as { version?: string }
  return pkg.version ?? "0.0.0"
}
