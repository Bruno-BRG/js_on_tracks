import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import {
  assertUniqueIdents,
  camelCase,
  controllerIdent,
  controllerKey,
  viewIdent,
  viewKey,
} from "./naming"
import { CliError } from "./output"

/** Resultado de `collect()`: o que foi encontrado e quais arquivos foram gerados. */
export interface CollectResult {
  /** Raiz absoluta do app. */
  readonly root: string
  /** Chaves de controller em ordem alfabética (ex.: `Admin/Posts`, `Home`). */
  readonly controllers: readonly string[]
  /** Nomes de view em ordem alfabética (ex.: `home/index`, `layouts/application`). */
  readonly views: readonly string[]
  readonly hasDatabaseConfig: boolean
  readonly hasSchema: boolean
}

interface RegistryEntry {
  readonly key: string
  readonly ident: string
  readonly file: string
  readonly importPath: string
}

interface ModelEntry {
  readonly key: string
  readonly file: string
  readonly importPath: string
}

/** Identificadores já usados pelo console-script (evita colisão com imports de models). */
const RESERVED_CONSOLE_IDENTS = new Set([
  "startRepl",
  "createDatabase",
  "paths",
  "setDefaultDatabase",
  "database",
  "routes",
  "schemaNs",
  "db",
  "models",
  "repl",
])

/**
 * Varre o app e regrava `.jot/**` (manifest, entry e scripts dos comandos).
 *
 * Determinístico de propósito: chaves em ordem alfabética, imports posix com
 * extensão explícita e LF no fim de cada arquivo. Sem `app/controllers` ou
 * `app/views` os registries saem vazios (o erro didático fica a cargo do core).
 */
export function collect(root: string): CollectResult {
  const appRoot = resolve(root)
  const dotJot = join(appRoot, ".jot")
  mkdirSync(dotJot, { recursive: true })

  const hasDatabaseConfig = existsSync(join(appRoot, "config", "database.ts"))
  const hasSchema = existsSync(join(appRoot, "db", "schema.ts"))

  const controllersDir = join(appRoot, "app", "controllers")
  const controllers = walk(controllersDir)
    .filter((file) => file.endsWith("_controller.ts"))
    .map((file) => {
      const key = controllerKey(posixRelative(controllersDir, file))
      const rel = posixRelative(appRoot, file)
      return { key, ident: controllerIdent(key), file: rel, importPath: `../${rel}` }
    })
    .sort((a, b) => compare(a.key, b.key))

  const viewsDir = join(appRoot, "app", "views")
  const views = walk(viewsDir)
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => {
      const key = viewKey(posixRelative(viewsDir, file))
      const rel = posixRelative(appRoot, file)
      return { key, ident: viewIdent(key), file: rel, importPath: `../${rel}` }
    })
    .sort((a, b) => compare(a.key, b.key))

  assertUniqueIdents([...controllers, ...views])

  const modelsDir = join(appRoot, "app", "models")
  const models = walk(modelsDir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => {
      const rel = posixRelative(appRoot, file)
      return {
        key: posixRelative(modelsDir, file).replace(/\.ts$/, ""),
        file: rel,
        importPath: `../${rel}`,
      }
    })
    .sort((a, b) => compare(a.key, b.key))

  writeFileSync(join(dotJot, ".gitignore"), "*\n")
  writeFileSync(join(dotJot, "manifest.ts"), renderManifest(controllers, views))
  writeFileSync(join(dotJot, "entry.ts"), renderEntry(hasDatabaseConfig))
  writeFileSync(join(dotJot, "routes-script.ts"), renderRoutesScript())

  if (hasDatabaseConfig) {
    writeFileSync(join(dotJot, "db-script.ts"), renderDbScript(hasSchema))
    writeFileSync(join(dotJot, "console-script.ts"), renderConsoleScript(hasSchema, models))
  } else {
    // Sem `config/database.ts` os scripts não têm como rodar; não deixe sobras de um boot antigo.
    rmSync(join(dotJot, "db-script.ts"), { force: true })
    rmSync(join(dotJot, "console-script.ts"), { force: true })
  }

  return {
    root: appRoot,
    controllers: controllers.map((entry) => entry.key),
    views: views.map((entry) => entry.key),
    hasDatabaseConfig,
    hasSchema,
  }
}

/** Garante que o diretório é um app JOT (`config/app.ts` + `config/routes.ts`). */
export function assertAppRoot(root: string): void {
  const appRoot = resolve(root)
  const missing = ["config/app.ts", "config/routes.ts"].filter(
    (rel) => !existsSync(join(appRoot, rel)),
  )
  if (missing.length > 0) {
    throw new CliError(
      `Not a JOT app root: ${appRoot}. Expected config/app.ts and config/routes.ts. ` +
        "Run this from your app folder (or create one with `jot new myapp`).",
    )
  }
}

/** Garante que o app tem `config/database.ts` (usado por `jot db:migrate`/`db:rollback`/`console`). */
export function assertDatabase(root: string): void {
  const appRoot = resolve(root)
  if (!existsSync(join(appRoot, "config", "database.ts"))) {
    throw new CliError(
      `config/database.ts not found in ${appRoot}. Create it (see a fresh \`jot new\` app) ` +
        "and run `jot db:migrate` again.",
    )
  }
}

function renderManifest(
  controllers: readonly RegistryEntry[],
  views: readonly RegistryEntry[],
): string {
  const lines = [
    "// AUTO-GENERATED by JOT — do not edit. Regenerated on every `jot server`, `jot routes` and `jot console`.",
    'import { registerControllers, registerViews } from "jot-framework"',
  ]
  for (const entry of controllers) lines.push(`import ${entry.ident} from "${entry.importPath}"`)
  for (const entry of views) lines.push(`import ${entry.ident} from "${entry.importPath}"`)
  lines.push("")
  lines.push(`registerControllers(${objectLiteral(controllers)})`)
  lines.push(`registerViews(${objectLiteral(views)})`)
  return `${lines.join("\n")}\n`
}

function renderEntry(hasDatabaseConfig: boolean): string {
  const lines = [
    "// AUTO-GENERATED by JOT — do not edit.",
    'import "./manifest.ts"',
    'import { start } from "jot-framework"',
    'import app from "../config/app.ts"',
    'import routes from "../config/routes.ts"',
  ]
  if (hasDatabaseConfig) lines.push('import database from "../config/database.ts"')
  lines.push("")
  lines.push(
    hasDatabaseConfig ? "await start({ app, routes, database })" : "await start({ app, routes })",
  )
  return `${lines.join("\n")}\n`
}

function renderDbScript(hasSchema: boolean): string {
  const lines = [
    "// AUTO-GENERATED by JOT — do not edit.",
    'import { createDatabase } from "jot-framework"',
    'import database from "../config/database.ts"',
  ]
  if (hasSchema) lines.push('import * as schemaNs from "../db/schema.ts"')
  lines.push("")
  lines.push(
    hasSchema
      ? 'const schema = ("default" in schemaNs ? schemaNs.default : schemaNs) as Record<string, unknown>'
      : "const schema = {} as Record<string, unknown>",
  )
  lines.push("const db = createDatabase({")
  lines.push("  url: database.url,")
  lines.push("  schema,")
  lines.push('  migrationsDir: database.migrationsDir ?? "db/migrate",')
  lines.push("  logQueries: false,")
  lines.push("})")
  lines.push('const [command = "migrate", rawCount] = process.argv.slice(2)')
  lines.push("try {")
  lines.push('  if (command === "migrate") {')
  lines.push("    const applied = await db.migrate()")
  lines.push(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: o script gerado precisa do placeholder `${...}` literal
    '    console.log(applied.length ? `applied ${applied.join(", ")}` : "nothing to apply (database is up to date)")',
  )
  lines.push('  } else if (command === "rollback") {')
  lines.push("    const count = rawCount === undefined ? 1 : Number(rawCount)")
  lines.push("    const undone = await db.rollback(count)")
  // biome-ignore lint/suspicious/noTemplateCurlyInString: o script gerado precisa do placeholder `${...}` literal
  lines.push('    console.log(`rolled back ${undone.join(", ")}`)')
  lines.push("  } else {")
  lines.push(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: o script gerado precisa do placeholder `${...}` literal
    '    console.error(`Unknown db command "${command}". Use \\`jot db:migrate\\` or \\`jot db:rollback [n]\\`.`)',
  )
  lines.push("    process.exitCode = 1")
  lines.push("  }")
  lines.push("} finally {")
  lines.push("  await db.close()")
  lines.push("}")
  return `${lines.join("\n")}\n`
}

function renderRoutesScript(): string {
  const lines = [
    "// AUTO-GENERATED by JOT — do not edit.",
    'import routes from "../config/routes.ts"',
    "",
    "const rows = routes.definitions.map((definition) => ({",
    "  method: definition.method,",
    "  path: definition.path,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: o script gerado precisa do placeholder `${...}` literal
    "  handler: `${definition.controllerKey}#${definition.action}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: o script gerado precisa do placeholder `${...}` literal
    '  helper: definition.as ? `paths.${definition.as}()` : "",',
    "}))",
    "const widths = {",
    "  method: Math.max(6, ...rows.map((row) => row.method.length)),",
    "  path: Math.max(4, ...rows.map((row) => row.path.length)),",
    "  handler: Math.max(7, ...rows.map((row) => row.handler.length)),",
    "  helper: Math.max(6, ...rows.map((row) => row.helper.length)),",
    "}",
    'const pad = (value: string, width: number): string => value + " ".repeat(width - value.length)',
    "const cells = (row: { method: string; path: string; handler: string; helper: string }): string[] => [",
    "  pad(row.method, widths.method),",
    "  pad(row.path, widths.path),",
    "  pad(row.handler, widths.handler),",
    "  pad(row.helper, widths.helper),",
    "]",
    'console.log(cells({ method: "Method", path: "Path", handler: "Handler", helper: "Helper" }).join("  "))',
    'for (const row of rows) console.log(cells(row).join("  "))',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: o script gerado precisa do placeholder `${...}` literal
    "console.log(`(${rows.length} routes)`)",
  ]
  return `${lines.join("\n")}\n`
}

function renderConsoleScript(hasSchema: boolean, models: readonly ModelEntry[]): string {
  const idents = namespaceIdents(models)
  const lines = [
    "// AUTO-GENERATED by JOT — do not edit.",
    'import { start as startRepl } from "node:repl"',
    'import { createDatabase, paths, setDefaultDatabase } from "jot-framework"',
    'import database from "../config/database.ts"',
    'import routes from "../config/routes.ts"',
  ]
  if (hasSchema) lines.push('import * as schemaNs from "../db/schema.ts"')
  models.forEach((model, index) => {
    lines.push(`import * as ${idents[index]} from "${model.importPath}"`)
  })
  lines.push("")
  lines.push(
    hasSchema
      ? 'const schema = ("default" in schemaNs ? schemaNs.default : schemaNs) as Record<string, unknown>'
      : "const schema = {} as Record<string, unknown>",
  )
  lines.push("const db = createDatabase({")
  lines.push("  url: database.url,")
  lines.push("  schema,")
  lines.push('  migrationsDir: database.migrationsDir ?? "db/migrate",')
  lines.push("  logQueries: false,")
  lines.push("})")
  lines.push("setDefaultDatabase(db)")
  lines.push("")
  lines.push("const models: Record<string, unknown> = {}")
  if (models.length > 0) {
    lines.push(`for (const namespace of [${idents.join(", ")}]) {`)
    lines.push("  for (const value of Object.values(namespace as Record<string, unknown>)) {")
    lines.push(
      '    if (typeof value === "function" && value.name.length > 0) models[value.name] = value',
    )
    lines.push("  }")
    lines.push("}")
  }
  lines.push("")
  lines.push('const repl = startRepl({ prompt: "jot> ", useGlobal: false, ignoreUndefined: true })')
  lines.push("Object.assign(repl.context, { db, models, paths, routes, ...models })")
  lines.push('repl.on("exit", () => {')
  lines.push("  void db.close()")
  lines.push("})")
  return `${lines.join("\n")}\n`
}

/** Idents `postNs`, `adminPostNs`, ... únicos e sem colidir com as variáveis do script. */
function namespaceIdents(models: readonly ModelEntry[]): string[] {
  const used = new Set(RESERVED_CONSOLE_IDENTS)
  return models.map((model) => {
    const base = camelCase(model.key) || "model"
    let ident = `${base}Ns`
    while (used.has(ident)) ident = `_${ident}`
    used.add(ident)
    return ident
  })
}

function objectLiteral(entries: readonly RegistryEntry[]): string {
  if (entries.length === 0) return "{}"
  return `{ ${entries.map((entry) => `${jsKey(entry.key)}: ${entry.ident}`).join(", ")} }`
}

function jsKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

function posixRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join("/")
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
