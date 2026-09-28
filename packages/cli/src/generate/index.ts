import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { assertKnownFlags, type ParsedArgv } from "../args"
import {
  type GenerateMigrationsResult,
  generateMigrations,
  NO_SCHEMA_CHANGES_MESSAGE,
} from "../commands/db"
import { CliError, log } from "../output"
import { insertResource, insertTable } from "./insert"
import { buildResource, type ResourceSpec } from "./parse"
import { renderController, renderModel, renderView, VIEW_FILES } from "./render"
import {
  acquireGenerationLock,
  commit,
  type FileWrite,
  findAppRoot,
  readRequired,
  releaseGenerationLock,
  type WritePlan,
} from "./write"

/** Uso aceito pela flag de erro (`Unknown option ... for ...`). */
export const GENERATE_USAGE = "jot generate <model|scaffold> <Name> [field:type[!] ...]"

export type GenerateKind = "model" | "scaffold"

export interface GenerateOptions {
  readonly kind: GenerateKind
  /** `false` pula o `drizzle-kit generate` (edite a migration à mão). */
  readonly dbGenerate?: boolean
  /** Root do app; default: `findAppRoot(process.cwd())`. */
  readonly root?: string
}

export interface GenerateResult {
  readonly root: string
  readonly resource: ResourceSpec
  readonly created: readonly string[]
  readonly updated: readonly string[]
  /** Migrations criadas (`db/migrate/*.sql`); `null` quando `dbGenerate: false`. */
  readonly migration: readonly string[] | null
}

interface GeneratePlan extends WritePlan {
  readonly kind: GenerateKind
  readonly resource: ResourceSpec
}

/** Internal dependency seam; it is deliberately not part of generateResource's public signature. */
interface GenerateDependencies {
  readonly generateMigrations?: typeof generateMigrations
  /** Internal test seam for exercising rollback after a partial multi-file install. */
  readonly commit?: (plan: WritePlan) => void
}

/** Implementa `jot generate model|scaffold <Name> [field:type[!] ...]`. */
export async function runGenerate(parsed: ParsedArgv): Promise<number> {
  assertKnownFlags(parsed, ["no-db-generate"], GENERATE_USAGE)
  const [kind, rawName, ...rawFields] = parsed.positionals

  if (kind === undefined) {
    throw new CliError(
      "Missing generator. Usage: `jot generate model <Name> field:type ...` or " +
        "`jot generate scaffold ...`.",
    )
  }
  if (kind !== "model" && kind !== "scaffold") {
    throw new CliError(
      `Unknown generator "${kind}". Use \`jot generate model <Name> field:type ...\` or ` +
        "`jot generate scaffold ...`.",
    )
  }
  if (rawName === undefined) {
    throw new CliError("Missing name. Usage: `jot generate scaffold Post title:string! body:text`.")
  }

  const cwd = resolve(process.cwd())
  const root = findAppRoot(cwd)
  if (root !== cwd) log(`root: ${root}`)

  await generateResource(rawName, rawFields, {
    kind,
    root,
    dbGenerate: parsed.flags["no-db-generate"] === undefined,
  })
  return 0
}

/**
 * API programática do generator (testes e integrações): monta o plano completo
 * (valida colisões e edições), grava e — por default — roda o drizzle-kit.
 */
export async function generateResource(
  rawName: string,
  rawFields: readonly string[],
  options: GenerateOptions,
): Promise<GenerateResult> {
  return generateResourceWithDependencies(rawName, rawFields, options, {})
}

/** Internal test seam; not re-exported from the @jot/cli package entry point. */
export async function generateResourceWithDependencies(
  rawName: string,
  rawFields: readonly string[],
  options: GenerateOptions,
  dependencies: GenerateDependencies,
): Promise<GenerateResult> {
  const resource = buildResource(rawName, rawFields)
  const root = options.root === undefined ? findAppRoot(process.cwd()) : resolve(options.root)
  const lock = await acquireGenerationLock(root)
  try {
    // All shared files are read and revalidated only after lock acquisition.
    const plan = await planResource(root, resource, options.kind)
    const write = dependencies.commit ?? commit
    write(plan)
    printCreated(plan)

    let migration: readonly string[] | null = null
    let generated = false
    if (options.dbGenerate !== false) {
      let migrationResult: GenerateMigrationsResult | undefined
      try {
        const generate = dependencies.generateMigrations ?? generateMigrations
        migrationResult = await generate(root, { name: `create_${resource.names.table}` })
        if (migrationResult.exitCode !== 0) {
          throw new CliError(
            `\`drizzle-kit generate\` exited with code ${migrationResult.exitCode}.`,
          )
        }
        migration = migrationResult.created
        generated = true
        if (migration.length === 0) log(NO_SCHEMA_CHANGES_MESSAGE)
        else log(`Migration: ${migration.join(", ")}`)
      } catch (error) {
        const label = options.kind === "scaffold" ? "Scaffold" : "Model"
        const detail = error instanceof Error ? ` ${error.message}` : ""
        const recovery =
          migrationResult === undefined
            ? "No migration file list is available; inspect db/migrate for partial output."
            : formatPartialMigrations(migrationResult.created)
        throw new CliError(
          `${label} files were created, but migration generation failed. ${recovery} ` +
            `Fix db/schema.ts and run \`jot db:generate\` again.${detail}`,
        )
      }
    }

    printNextSteps(plan, migration, generated)
    return {
      root,
      resource,
      created: plan.creates.map((file) => file.path),
      updated: plan.updates.map((file) => file.path),
      migration,
    }
  } finally {
    await releaseGenerationLock(lock)
  }
}

function formatPartialMigrations(files: readonly string[]): string {
  if (files.length === 0) return "No migration files were reported as created."
  return (
    `Migration file(s) created before failure: ${files.join(", ")}. ` +
    "They may be incomplete; inspect them and remove any partial artifact before retrying."
  )
}

/** Lê schema/routes e monta tudo em memória; nada é escrito antes de validar. */
async function planResource(
  root: string,
  resource: ResourceSpec,
  kind: GenerateKind,
): Promise<GeneratePlan> {
  const n = resource.names
  const creates: FileWrite[] = [
    { path: `app/models/${n.singularFile}.ts`, content: renderModel(resource) },
  ]
  if (kind === "scaffold") {
    creates.push({
      path: `app/controllers/${n.controllerFile}`,
      content: renderController(resource),
    })
    for (const view of VIEW_FILES) {
      creates.push({
        path: `app/views/${n.viewsDir}/${view}.tsx`,
        content: renderView(resource, view),
      })
    }
  }

  const collisions = creates
    .filter((file) => existsSync(join(root, file.path)))
    .map((file) => file.path)
  if (collisions.length > 0) {
    throw new CliError(
      `File(s) already exist: ${collisions.join(", ")}. Remove them or pick another name.`,
    )
  }

  const updates: FileWrite[] = [
    {
      path: "db/schema.ts",
      content: insertTable(readRequired(root, "db/schema.ts", schemaMissingHint(root)), resource),
    },
  ]
  if (kind === "scaffold") {
    updates.push({
      path: "config/routes.ts",
      content: await insertResource(
        readRequired(root, "config/routes.ts", routesMissingHint(root)),
        resource,
        root,
      ),
    })
  }

  return { root, kind, resource, creates, updates }
}

function schemaMissingHint(root: string): string {
  return (
    `db/schema.ts not found in ${root}. Create it ` +
    '(e.g. `export const posts = table("posts", { id: id() })`) and re-run this generator.'
  )
}

function routesMissingHint(root: string): string {
  return (
    `config/routes.ts not found in ${root}. \`jot generate scaffold\` needs it to add the REST ` +
    "routes; `jot generate model` works without it."
  )
}

function printCreated(plan: GeneratePlan): void {
  const n = plan.resource.names
  const created = plan.creates.map((file) => file.path)
  const display =
    plan.kind === "scaffold"
      ? [created[0], created[1], `app/views/${n.viewsDir}/{index,show,new,edit,_form}.tsx`]
      : created
  const createdText =
    display.length === 1 ? display[0] : `${display[0]}, ${display[1]},\n         ${display[2]}`

  log(
    `${plan.kind === "scaffold" ? "Scaffold" : "Model"} generated for ${n.singularIdent} ` +
      `(table "${n.table}").`,
  )
  log(`Created: ${createdText}`)
  log(`Updated: ${plan.updates.map((file) => file.path).join(", ")}`)
}

function printNextSteps(
  plan: GeneratePlan,
  migration: readonly string[] | null,
  generated: boolean,
): void {
  const n = plan.resource.names
  log("")
  log("Next steps:")
  if (!generated || (migration !== null && migration.length === 0)) log("  jot db:generate")
  log("  jot db:migrate")
  if (plan.kind === "scaffold") {
    log(`  jot server  → http://localhost:3000/${n.table}`)
    log("  Restart `jot server` if it is already running to pick up the new controller and views.")
  } else {
    log(
      `  Add \`r.resource("${n.table}")\` to config/routes.ts when you are ready to expose ` +
        `${n.singularIdent} via REST.`,
    )
  }
}
