import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, statSync } from "node:fs"
import { cp, readdir, readFile, writeFile } from "node:fs/promises"
import { basename, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { assertKnownFlags, type ParsedArgv } from "../args"
import { CliError, log } from "../output"

export interface NewProjectOptions {
  /** Diretório onde a pasta do app será criada (default: `process.cwd()`). */
  cwd?: string
  /** `false` pula o `npm install` (default: instala). */
  install?: boolean
}

export interface NewProjectResult {
  /** Nome da pasta criada (basename do destino). */
  readonly name: string
  /** Caminho absoluto do app. */
  readonly dir: string
  /** `true` quando o `npm install` rodou e terminou com sucesso. */
  readonly installed: boolean
}

const TEMPLATE_DIR = fileURLToPath(new URL("../../templates/app", import.meta.url))

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".css",
  ".html",
  ".sql",
  ".example",
])

/**
 * Cria um app a partir de `templates/app`: copia, troca `__APP_NAME__`, gera o
 * `.env` com segredo aleatório e (por default) roda `npm install`.
 *
 * É a mesma função usada por `jot new` e pelo `create-jot`.
 */
export async function newProject(
  name: string,
  options: NewProjectOptions = {},
): Promise<NewProjectResult> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const folderName = name.trim()
  if (folderName.length === 0) {
    throw new CliError("Missing app name. Usage: `jot new <name> [--no-install]`.")
  }

  const dir = resolve(cwd, folderName)
  const base = basename(dir)
  if (base.length === 0 || base === "." || base === "..") {
    throw new CliError(`Invalid app name "${name}". Use a folder name like "blog" or "my_app".`)
  }
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory() || (await readdir(dir)).length > 0) {
      throw new CliError(
        `Directory "${dir}" already exists and is not empty. Choose another name or remove it first.`,
      )
    }
  }

  const packageName = sanitizePackageName(base)
  if (packageName.length === 0) {
    throw new CliError(`Invalid app name "${name}". Use a folder name like "blog" or "my_app".`)
  }

  await cp(TEMPLATE_DIR, dir, {
    recursive: true,
    filter: (source) => !source.split(sep).includes("node_modules"),
  })
  await replaceAppName(dir, base, packageName)
  await createEnvFile(dir)

  let installed = false
  if (options.install !== false) {
    log("Installing dependencies with npm...")
    const code = await runNpmInstall(dir)
    if (code !== 0) {
      throw new CliError(
        `npm install failed (exit ${code}). Run \`npm install\` inside ${dir} to see the full log.`,
      )
    }
    installed = true
  }

  return { name: base, dir, installed }
}

/** Implementa `jot new <name> [--no-install]`. */
export async function runNew(parsed: ParsedArgv): Promise<number> {
  assertKnownFlags(parsed, ["no-install"], "jot new <name> [--no-install]")
  const name = parsed.positionals[0]
  if (name === undefined) {
    throw new CliError("Missing app name. Usage: `jot new <name> [--no-install]`.")
  }
  const extra = parsed.positionals[1]
  if (extra !== undefined) {
    throw new CliError(`Unexpected argument "${extra}". Usage: \`jot new <name> [--no-install]\`.`)
  }

  const install = parsed.flags["no-install"] === undefined
  const result = await newProject(name, { install })
  printNextSteps(result, install)
  return 0
}

function printNextSteps(result: NewProjectResult, install: boolean): void {
  log(`Created ${result.name} at ${result.dir}`)
  log("")
  log("Next steps:")
  log(`  cd ${result.name}`)
  if (!install) log("  npm install")
  log("  jot db:migrate")
  log("  jot server  → http://localhost:3000")
}

function sanitizePackageName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")
}

async function replaceAppName(dir: string, appName: string, packageName: string): Promise<void> {
  for (const file of await listFiles(dir)) {
    if (!TEXT_EXTENSIONS.has(extname(file))) continue
    const content = await readFile(file, "utf8")
    if (!content.includes("__APP_NAME__")) continue
    const replacement = basename(file) === "package.json" ? packageName : appName
    await writeFile(file, content.split("__APP_NAME__").join(replacement), "utf8")
  }
}

async function createEnvFile(dir: string): Promise<void> {
  const example = join(dir, ".env.example")
  if (!existsSync(example)) return
  const content = await readFile(example, "utf8")
  const secret = randomBytes(32).toString("hex")
  const replaced = /^JOT_SECRET=.*$/m.test(content)
    ? content.replace(/^JOT_SECRET=.*$/m, `JOT_SECRET=${secret}`)
    : `${content.endsWith("\n") ? content : `${content}\n`}JOT_SECRET=${secret}\n`
  await writeFile(join(dir, ".env"), replaced, "utf8")
}

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue
      files.push(...(await listFiles(full)))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

function runNpmInstall(dir: string): Promise<number> {
  return new Promise<number>((resolveChild, reject) => {
    // `shell: true` é o que resolve `npm.cmd` no Windows.
    const child = spawn("npm", ["install"], {
      cwd: dir,
      stdio: "inherit",
      shell: true,
      windowsHide: true,
    })
    child.once("error", (error) => {
      reject(
        new CliError(
          `Failed to start npm: ${error.message}`,
          "Check that Node.js >= 24 (with npm) is on PATH.",
        ),
      )
    })
    child.once("close", (code) => resolveChild(code ?? 1))
  })
}
