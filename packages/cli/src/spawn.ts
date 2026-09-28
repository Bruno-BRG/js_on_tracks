import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { CliError } from "./output"

/**
 * Flags fixas dos processos de app.
 *
 * `--watch` fica de fora: só o `jot server` liga o modo watch (que no Windows
 * roda o app em um processo filho do watcher — por isso `killTree` usa
 * `taskkill /T`).
 */
export const NODE_FLAGS = [
  "--disable-warning=ExperimentalWarning",
  "--import",
  "tsx",
  "--enable-source-maps",
] as const

/** Garante que o app tem `tsx` instalado antes de spawnar `node --import tsx`. */
export function resolveTsx(cwd: string): void {
  const require = createRequire(pathToFileURL(join(cwd, "package.json")))
  try {
    require.resolve("tsx/package.json")
  } catch {
    throw new CliError(
      `tsx is not installed in ${resolve(cwd)}.`,
      "Run `npm install` inside the app (it is in the template devDependencies) and try again.",
    )
  }
}

export interface RunChildOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
}

/** Roda um processo filho com `stdio: inherit` e resolve com o exit code. */
export function runChild(
  command: string,
  args: readonly string[],
  options: RunChildOptions,
): Promise<number> {
  return new Promise<number>((resolveChild, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
      windowsHide: true,
    })
    child.once("error", (error) => {
      reject(
        new CliError(
          `Failed to start ${command}: ${error.message}`,
          "Check that Node.js >= 24 is on PATH.",
        ),
      )
    })
    child.once("close", (code) => resolveChild(code ?? 1))
  })
}

/**
 * Mata a árvore do processo. No Windows `child.kill()` não derruba netos (o
 * `node --watch` roda o app em um filho), então usa `taskkill /T /F`.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
  } else {
    child.kill(signal)
  }
}

/**
 * Resolve o caminho do binário de um pacote sem depender de `node_modules/.bin`.
 *
 * `resolve("<pkg>/package.json")` não é confiável (o `exports` pode não expor o
 * `package.json`, como no drizzle-kit): resolve o main e sobe até o
 * `package.json` do pacote.
 */
export function resolvePackageBin(specifier: string, binName: string): string {
  const entry = createRequire(import.meta.url).resolve(specifier)
  let dir = dirname(entry)
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir)
    if (parent === dir) {
      throw new CliError(`Could not find package.json for "${specifier}" (resolved to ${entry}).`)
    }
    dir = parent
  }
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    bin?: string | Record<string, string>
  }
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName]
  if (bin === undefined || bin.length === 0) {
    throw new CliError(`Package "${specifier}" does not expose bin "${binName}".`)
  }
  return join(dir, bin)
}

/**
 * Porta que o server deve usar, para o banner: `PORT` do ambiente → linha
 * `PORT=` do `.env` → 3000. Inválida/0 devolve `undefined` (o banner sai sem URL,
 * porque o core resolve a porta de verdade).
 */
export function resolvePortHint(root: string): number | undefined {
  const fromEnv = nonEmpty(process.env.PORT)
  const raw = fromEnv ?? nonEmpty(readDotEnvValue(root, "PORT")) ?? "3000"
  const port = Number(raw)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined
  return port
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined
}

function readDotEnvValue(root: string, name: string): string | undefined {
  const file = join(resolve(root), ".env")
  if (!existsSync(file)) return undefined
  let content: string
  try {
    content = readFileSync(file, "utf8")
  } catch {
    return undefined
  }
  const match = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, "m").exec(content)
  if (match === null) return undefined
  return match[1].trim().replace(/^["']|["']$/g, "")
}
