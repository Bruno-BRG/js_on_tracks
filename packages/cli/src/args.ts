import { CliError } from "./output"

/** Flags parseadas de `process.argv.slice(2)` (parser próprio, sem dependências). */
export interface ParsedArgv {
  /** Primeiro token não-flag (o comando), ou `undefined`. */
  readonly command: string | undefined
  /** Tokens não-flag após o comando (inclui tudo depois de `--`). */
  readonly positionals: readonly string[]
  /** Flags: `--x=y` → `"y"`; `--x`/`-x` → `true`. */
  readonly flags: Readonly<Record<string, string | true>>
  /** Flags como digitadas (preserva `--x=y` nas mensagens de erro). */
  readonly rawFlags: readonly string[]
  /** `-h`/`--help` em qualquer posição. */
  readonly help: boolean
  /** `-v`/`--version` em qualquer posição. */
  readonly version: boolean
}

/**
 * Interpreta os argumentos da CLI: o primeiro token não-flag é o comando; flags
 * valem em qualquer posição; `--` encerra as flags; `--x=y` vira string e
 * `--x` vira `true`.
 */
export function parseArgv(argv: readonly string[]): ParsedArgv {
  const positionals: string[] = []
  const flags: Record<string, string | true> = {}
  const rawFlags: string[] = []
  let command: string | undefined
  let help = false
  let version = false
  let flagsDone = false

  for (const token of argv) {
    if (!flagsDone && token === "--") {
      flagsDone = true
      continue
    }
    if (!flagsDone && token.startsWith("--")) {
      if (token === "--help") {
        help = true
        continue
      }
      if (token === "--version") {
        version = true
        continue
      }
      const equals = token.indexOf("=")
      const name = token.slice(2, equals === -1 ? undefined : equals)
      if (name.length === 0) {
        throw new CliError(`Invalid option "${token}". Run \`jot --help\`.`)
      }
      flags[name] = equals === -1 ? true : token.slice(equals + 1)
      rawFlags.push(token)
      continue
    }
    if (!flagsDone && token.startsWith("-") && token.length > 1) {
      if (token === "-h") {
        help = true
        continue
      }
      if (token === "-v") {
        version = true
        continue
      }
      flags[token.slice(1)] = true
      rawFlags.push(token)
      continue
    }
    if (command === undefined) command = token
    else positionals.push(token)
  }

  return { command, positionals, flags, rawFlags, help, version }
}

/** Rejeita qualquer flag que o comando não aceita, citando o uso correto. */
export function assertKnownFlags(
  parsed: ParsedArgv,
  allowed: readonly string[],
  usage: string,
): void {
  for (const raw of parsed.rawFlags) {
    if (!allowed.includes(flagName(raw))) {
      throw new CliError(`Unknown option "${raw}" for \`${usage}\`. Run \`jot --help\`.`)
    }
  }
}

function flagName(raw: string): string {
  const stripped = raw.startsWith("--") ? raw.slice(2) : raw.slice(1)
  const equals = stripped.indexOf("=")
  return equals === -1 ? stripped : stripped.slice(0, equals)
}
