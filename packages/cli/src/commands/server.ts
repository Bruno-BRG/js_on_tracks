import { spawn } from "node:child_process"
import { assertKnownFlags, type ParsedArgv } from "../args"
import { assertAppRoot, collect } from "../collect"
import { CliError, cliVersion, heading } from "../output"
import { killTree, NODE_FLAGS, resolvePortHint, resolveTsx } from "../spawn"

/** Implementa `jot server`: gera `.jot/` e roda o app em watch mode. */
export async function runServer(parsed: ParsedArgv): Promise<number> {
  assertKnownFlags(parsed, [], "jot server")
  const root = process.cwd()
  assertAppRoot(root)
  collect(root)
  resolveTsx(root)
  printBanner(root)
  return runWatched(root)
}

function printBanner(root: string): void {
  const port = resolvePortHint(root)
  const suffix = port === undefined ? "" : ` → http://localhost:${port}`
  heading(`JOT v${cliVersion()}${suffix}`)
}

function runWatched(root: string): Promise<number> {
  return new Promise<number>((resolveChild, reject) => {
    const child = spawn(process.execPath, [...NODE_FLAGS, "--watch", ".jot/entry.ts"], {
      cwd: root,
      env: { ...process.env },
      stdio: "inherit",
      windowsHide: true,
    })

    const onSignal = (signal: NodeJS.Signals): void => killTree(child, signal)
    const onExit = (): void => killTree(child)
    const cleanup = (): void => {
      process.removeListener("SIGINT", onSignal)
      process.removeListener("SIGTERM", onSignal)
      process.removeListener("exit", onExit)
    }
    process.once("SIGINT", onSignal)
    process.once("SIGTERM", onSignal)
    // Rede de segurança: se o CLI sair por qualquer outro motivo, não deixe o app órfão.
    process.once("exit", onExit)

    child.once("error", (error) => {
      cleanup()
      reject(
        new CliError(
          `Failed to start the dev server: ${error.message}`,
          "Check that Node.js >= 24 is on PATH.",
        ),
      )
    })
    child.once("close", (code) => {
      cleanup()
      resolveChild(code ?? 1)
    })
  })
}
