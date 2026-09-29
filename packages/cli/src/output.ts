import { createRequire } from "node:module"
import pc from "picocolors"

/** Erro previsto da CLI: mensagem didática + dica opcional do próximo passo. */
export class CliError extends Error {
  readonly hint: string | undefined

  constructor(message: string, hint?: string) {
    super(message)
    this.name = "CliError"
    this.hint = hint
  }
}

/** Loga uma linha no stdout. */
export function log(message = ""): void {
  console.log(message)
}

/** Loga um título destacado no stdout. */
export function heading(message: string): void {
  console.log(pc.bold(message))
}

/** Imprime um erro didático (`error: ...` vermelho + hint dim) no stderr. */
export function printError(error: CliError): void {
  console.error(pc.red(`error: ${error.message}`))
  if (error.hint !== undefined) console.error(pc.dim(`hint: ${error.hint}`))
}

let cachedVersion: string | undefined

/** Versão do próprio `@js_on_tracks/cli` (`package.json`), usada em `--version` e no banner do server. */
export function cliVersion(): string {
  if (cachedVersion === undefined) {
    const require = createRequire(import.meta.url)
    const pkg = require("../package.json") as { version?: string }
    cachedVersion = pkg.version ?? "0.0.0"
  }
  return cachedVersion
}
