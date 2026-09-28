import { assertKnownFlags, type ParsedArgv } from "../args"
import { assertAppRoot, assertDatabase, collect } from "../collect"
import { CliError } from "../output"
import { NODE_FLAGS, resolveTsx, runChild } from "../spawn"

/**
 * Implementa `jot console`: abre o REPL (db, models e paths) em processo filho.
 *
 * O CLI nunca importa o app no próprio processo — o REPL roda em
 * `.jot/console-script.ts`, então exige um terminal interativo.
 */
export async function runConsole(parsed: ParsedArgv): Promise<number> {
  assertKnownFlags(parsed, [], "jot console")
  const root = process.cwd()
  assertAppRoot(root)
  assertDatabase(root)
  if (!process.stdin.isTTY) {
    throw new CliError(
      "`jot console` requires an interactive terminal (TTY).",
      "Run it directly in your terminal (not through a pipe or CI).",
    )
  }
  collect(root)
  resolveTsx(root)
  return runChild(process.execPath, [...NODE_FLAGS, ".jot/console-script.ts"], { cwd: root })
}
