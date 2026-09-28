import type { FieldSpec, FieldType } from "./fields"
import type { ResourceSpec } from "./parse"

/** Views criadas pelo scaffold, na ordem em que são listadas/exibidas. */
export const VIEW_FILES = ["index", "show", "new", "edit", "_form"] as const
export type ViewName = (typeof VIEW_FILES)[number]

/** Ordem canônica dos builders no import do `jot-framework` (schema.ts). */
const CANONICAL_BUILDERS = [
  "table",
  "id",
  "string",
  "text",
  "integer",
  "real",
  "boolean",
  "json",
  "timestamps",
]

/** Builders que a tabela precisa (para o merge do import). */
export function tableBuilders(resource: ResourceSpec): string[] {
  const needed = new Set(["table", "id", "timestamps"])
  for (const field of resource.fields) needed.add(builderName(field.type))
  return CANONICAL_BUILDERS.filter((builder) => needed.has(builder))
}

function builderName(type: FieldType): string {
  return type === "decimal" ? "real" : type
}

/** Linha do campo na tabela: `title: string().notNull(),`. */
function fieldBuilder(field: FieldSpec): string {
  const base = `${builderName(field.type)}()`
  if (field.type === "boolean") {
    return `${base}${field.notNull ? ".notNull()" : ""}.default(false)`
  }
  return field.notNull ? `${base}.notNull()` : base
}

/** Bloco `export const posts = table("posts", { ... })` (sem EOL final). */
export function renderTableBlock(resource: ResourceSpec, eol = "\n"): string {
  const { table } = resource.names
  const lines = [`export const ${table} = table("${table}", {`, "  id: id(),"]
  for (const field of resource.fields) lines.push(`  ${field.name}: ${fieldBuilder(field)},`)
  lines.push("  ...timestamps(),", "})")
  return lines.join(eol)
}

/** Model com `declare` (tipo completo da linha) e `presence()` nos campos `!`. */
export function renderModel(resource: ResourceSpec): string {
  const n = resource.names
  const required = resource.fields.filter((field) => field.notNull)
  const lines = [
    required.length > 0
      ? 'import { Model, presence } from "jot-framework"'
      : 'import { Model } from "jot-framework"',
    `import { ${n.table} } from "../../db/schema.ts"`,
    "",
    `/** \`declare\` gives the full row type; views annotate \`{ ${n.singular}: ${n.singularIdent} }\` without \`InstanceOf\`. */`,
    `export class ${n.singularIdent} extends Model<typeof ${n.table}> {`,
    `  static readonly table = ${n.table}`,
    "",
    "  declare id: number",
  ]
  for (const field of resource.fields) {
    lines.push(`  declare ${field.name}: ${declareType(field)}`)
  }
  lines.push("  declare createdAt: Date", "  declare updatedAt: Date", "")
  if (required.length === 0) {
    lines.push("  static validations = {}", "}")
  } else {
    lines.push("  static validations = {")
    for (const field of required) lines.push(`    ${field.name}: [presence()],`)
    lines.push("  }", "}")
  }
  return lines.join("\n")
}

function declareType(field: FieldSpec): string {
  switch (field.type) {
    case "integer":
    case "real":
    case "decimal":
      return field.notNull ? "number" : "number | null"
    case "boolean":
      return field.notNull ? "boolean" : "boolean | null"
    case "json":
      return "unknown"
    default:
      return field.notNull ? "string" : "string | null"
  }
}

/** Controller com as 7 actions REST; helpers só quando os campos pedem. */
export function renderController(resource: ResourceSpec): string {
  const n = resource.names
  const model = n.singularIdent
  const record = n.singular
  const fields = resource.fields
  const lines = [
    'import { Controller, paths } from "jot-framework"',
    `import { ${model} } from "../models/${n.singularFile}.ts"`,
    "",
    `export default class ${n.controllerClass} extends Controller {`,
    "  async index() {",
    `    const ${n.table} = await ${model}.all()`,
    `    return this.render("${n.viewsDir}/index", { ${n.table} })`,
    "  }",
    "  async new() {",
    `    return this.render("${n.viewsDir}/new", { ${record}: ${model}.new({}) })`,
    "  }",
    "  async create() {",
  ]
  pushAssignments(lines, `const ${record} = ${model}.new`, fields)
  lines.push(...numericGuardLines(fields, n.viewsDir, "new", record))
  lines.push(
    `    if (await ${record}.save()) {`,
    `      return this.redirectTo(paths.${n.helper}(${record}.id), { flash: { notice: "${model} created." } })`,
    "    }",
    `    return this.render("${n.viewsDir}/new", { ${record} }, { status: 422 })`,
    "  }",
    "  async show() {",
    `    const ${record} = await ${model}.find(String(this.params.id))`,
    `    if (!${record}) return this.renderNotFound()`,
    `    return this.render("${n.viewsDir}/show", { ${record} })`,
    "  }",
    "  async edit() {",
    `    const ${record} = await ${model}.find(String(this.params.id))`,
    `    if (!${record}) return this.renderNotFound()`,
    `    return this.render("${n.viewsDir}/edit", { ${record} })`,
    "  }",
    "  async update() {",
    `    const ${record} = await ${model}.find(String(this.params.id))`,
    `    if (!${record}) return this.renderNotFound()`,
  )
  pushAssignments(lines, `${record}.update`, fields)
  lines.push(...numericGuardLines(fields, n.viewsDir, "edit", record))
  lines.push(
    `    if (await ${record}.save()) {`,
    `      return this.redirectTo(paths.${n.helper}(${record}.id), { flash: { notice: "${model} updated." } })`,
    "    }",
    `    return this.render("${n.viewsDir}/edit", { ${record} }, { status: 422 })`,
    "  }",
    "  async destroy() {",
    `    const ${record} = await ${model}.find(String(this.params.id))`,
    `    if (!${record}) return this.renderNotFound()`,
    `    await ${record}.destroy()`,
    `    return this.redirectTo(paths.${n.helperPlural}(), { flash: { notice: "${model} deleted." } })`,
    "  }",
    "}",
  )
  const helpers = helperFunctions(fields)
  if (helpers.length > 0) lines.push("", ...helpers)
  return lines.join("\n")
}

function pushAssignments(lines: string[], call: string, fields: readonly FieldSpec[]): void {
  if (fields.length === 0) {
    lines.push(`    ${call}({})`)
    return
  }
  lines.push(`    ${call}({`)
  for (const field of fields) lines.push(`      ${field.name}: ${castExpression(field)},`)
  lines.push("    })")
}

function castExpression(field: FieldSpec): string {
  const param = `this.params.${field.name}`
  switch (field.type) {
    case "integer":
      return `toInteger(${param})${field.notNull ? " as number" : ""}`
    case "real":
    case "decimal":
      return `toNumber(${param})${field.notNull ? " as number" : ""}`
    case "boolean":
      return `${param} === "1"`
    case "json":
      return `parseJson(${param})`
    default:
      return `String(${param} ?? "")`
  }
}

function numericGuardLines(
  fields: readonly FieldSpec[],
  viewsDir: string,
  view: "new" | "edit",
  record: string,
): string[] {
  const numericFields = fields.filter(
    (field) => field.type === "integer" || field.type === "real" || field.type === "decimal",
  )
  if (numericFields.length === 0) return []
  const invalid = numericFields.map(
    (field) =>
      `!isValidNumber(this.params.${field.name}, ${field.type === "integer" ? "true" : "false"})`,
  )
  const validations = numericFields.map((field) => {
    const integer = field.type === "integer"
    const message = integer ? "whole number" : "number"
    return [
      `      if (!isValidNumber(this.params.${field.name}, ${integer ? "true" : "false"})) {`,
      `        ${record}.errors.${field.name} = ["${field.label} must be a ${message}."]`,
      "      }",
    ]
  })
  const submittedValues = numericFields
    .map((field) => `${field.name}: this.params.${field.name}`)
    .join(", ")
  return [
    `    if (${invalid.join(" || ")}) {`,
    `      ${record}.isValid()`,
    ...validations.flat(),
    `      return this.render("${viewsDir}/${view}", { ${record}, values: { ${submittedValues} } }, { status: 422 })`,
    "    }",
  ]
}

function helperFunctions(fields: readonly FieldSpec[]): string[] {
  const lines: string[] = []
  if (
    fields.some(
      (field) => field.type === "integer" || field.type === "real" || field.type === "decimal",
    )
  ) {
    // Missing values remain undefined; empty nullable values are null; invalid values are
    // guarded before save(), while required nulls reach presence() and produce a 422.
    lines.push(
      "function toNumber(value: string | undefined): number | null | undefined {",
      "  if (value === undefined) return undefined",
      '  if (value.trim() === "") return null',
      "  const parsed = Number(value)",
      "  return Number.isFinite(parsed) ? parsed : null",
      "}",
      "function toInteger(value: string | undefined): number | null | undefined {",
      "  if (value === undefined) return undefined",
      '  if (value.trim() === "") return null',
      "  const parsed = Number(value)",
      "  return Number.isInteger(parsed) ? parsed : null",
      "}",
      "function isValidNumber(value: string | undefined, integer: boolean): boolean {",
      '  if (value === undefined || value.trim() === "") return true',
      "  const parsed = Number(value)",
      "  return Number.isFinite(parsed) && (!integer || Number.isInteger(parsed))",
      "}",
    )
  }
  if (fields.some((field) => field.type === "json")) {
    lines.push(
      "function parseJson(value: string | undefined): unknown {",
      '  if (value === undefined || value.trim() === "") return null',
      "  try { return JSON.parse(value) } catch { return value }",
      "}",
    )
  }
  return lines
}

/** View do scaffold (`index`, `show`, `new`, `edit` ou `_form`). */
export function renderView(resource: ResourceSpec, view: ViewName): string {
  switch (view) {
    case "index":
      return renderIndex(resource)
    case "show":
      return renderShow(resource)
    case "new":
      return renderNew(resource)
    case "edit":
      return renderEdit(resource)
    case "_form":
      return renderForm(resource)
  }
}

function renderForm(resource: ResourceSpec): string {
  const n = resource.names
  const lines = [
    `import type { ${n.singularIdent} } from "../../models/${n.singularFile}.ts"`,
    "",
    `export default function ${n.singularIdent}Form({`,
    `  ${n.singular},`,
    "  csrfToken,",
    "  action,",
    '  method = "post",',
    "  values,",
    "}: {",
    `  ${n.singular}: ${n.singularIdent}`,
    "  csrfToken: string",
    "  action: string",
    '  method?: "post" | "put"',
    "  values?: Record<string, string | undefined>",
    "}) {",
    "  return (",
    '    <form method="post" action={action}>',
    '      <input type="hidden" name="_csrf" value={csrfToken} />',
    '      {method === "put" ? <input type="hidden" name="_method" value="put" /> : null}',
  ]
  for (const field of resource.fields) lines.push(...formFieldLines(field, n.singular))
  lines.push('      <button type="submit">Save</button>', "    </form>", "  )", "}")
  return lines.join("\n")
}

function formFieldLines(field: FieldSpec, record: string): string[] {
  const lines = ["      <div>"]
  if (field.type === "boolean") {
    lines.push(
      `        <input id="${field.name}" type="checkbox" name="${field.name}" value="1" checked={${record}.${field.name} === true} />`,
      `        <label for="${field.name}">${field.label}</label>`,
    )
  } else if (field.type === "json") {
    lines.push(
      `        <label for="${field.name}">${field.label}</label>`,
      `        <textarea id="${field.name}" name="${field.name}">{${jsonValue(field, record)}}</textarea>`,
    )
  } else if (field.type === "integer" || field.type === "real" || field.type === "decimal") {
    const step = field.type === "real" || field.type === "decimal" ? ' step="any"' : ""
    lines.push(
      `        <label for="${field.name}">${field.label}</label>`,
      `        <input id="${field.name}" type="number"${step} name="${field.name}" value={values?.${field.name} ?? ${record}.${field.name} ?? ""} />`,
    )
  } else if (field.type === "text") {
    lines.push(
      `        <label for="${field.name}">${field.label}</label>`,
      `        <textarea id="${field.name}" name="${field.name}">{${record}.${field.name} ?? ""}</textarea>`,
    )
  } else {
    lines.push(
      `        <label for="${field.name}">${field.label}</label>`,
      `        <input id="${field.name}" name="${field.name}" value={${record}.${field.name} ?? ""} />`,
    )
  }
  if (
    field.notNull ||
    field.type === "integer" ||
    field.type === "real" ||
    field.type === "decimal"
  ) {
    lines.push(
      `        {${record}.errors.${field.name} && ${record}.errors.${field.name}.length > 0 ? (`,
      `          <p class="error">{${record}.errors.${field.name}.join(", ")}</p>`,
      "        ) : null}",
    )
  }
  lines.push("      </div>")
  return lines
}

function renderIndex(resource: ResourceSpec): string {
  const n = resource.names
  const display = displayField(resource)
  const linkText = display === undefined ? `#{${n.singular}.id}` : `{${n.singular}.${display.name}}`
  return [
    'import { paths } from "jot-framework"',
    `import type { ${n.singularIdent} } from "../../models/${n.singularFile}.ts"`,
    "",
    `export default function ${n.pluralIdent}Index({ ${n.table} }: { ${n.table}: ${n.singularIdent}[] }) {`,
    "  return (",
    "    <section>",
    `      <h1>${n.pluralIdent}</h1>`,
    `      {${n.table}.length === 0 ? <p>No ${n.table.replace(/_/g, " ")} yet.</p> : null}`,
    `      <ul class="${n.table}">`,
    `        {${n.table}.map((${n.singular}) => (`,
    "          <li>",
    `            <a href={paths.${n.helper}(${n.singular}.id)}>${linkText}</a>`,
    "          </li>",
    "        ))}",
    "      </ul>",
    "      <p>",
    `        <a href={paths.new${n.singularIdent}()}>New ${n.singular.replace(/_/g, " ")}</a>`,
    "      </p>",
    "    </section>",
    "  )",
    "}",
  ].join("\n")
}

function renderShow(resource: ResourceSpec): string {
  const n = resource.names
  const display = displayField(resource)
  const heading =
    display === undefined
      ? `${n.singularIdent} #{${n.singular}.id}`
      : `{${n.singular}.${display.name}}`
  const detailFields = resource.fields.filter((field) => field !== display)
  const lines = [
    'import { paths } from "jot-framework"',
    `import type { ${n.singularIdent} } from "../../models/${n.singularFile}.ts"`,
    "",
    `export default function ${n.pluralIdent}Show({ ${n.singular}, csrfToken }: { ${n.singular}: ${n.singularIdent}; csrfToken: string }) {`,
    "  return (",
    "    <article>",
    `      <h1>${heading}</h1>`,
  ]
  if (detailFields.length > 0) {
    lines.push("      <dl>")
    for (const field of detailFields) {
      lines.push(
        `        <dt>${field.label}</dt>`,
        `        <dd>${showValue(field, n.singular)}</dd>`,
      )
    }
    lines.push("      </dl>")
  }
  lines.push(
    "      <p>",
    `        <a href={paths.edit${n.singularIdent}(${n.singular}.id)}>Edit</a> · <a href={paths.${n.helperPlural}()}>Back to ${n.table.replace(/_/g, " ")}</a>`,
    "      </p>",
    `      <form method="post" action={paths.${n.helper}(${n.singular}.id)}>`,
    '        <input type="hidden" name="_csrf" value={csrfToken} />',
    '        <input type="hidden" name="_method" value="delete" />',
    '        <button type="submit">Delete</button>',
    "      </form>",
    "    </article>",
    "  )",
    "}",
  )
  return lines.join("\n")
}

function showValue(field: FieldSpec, record: string): string {
  if (field.type === "boolean") return `{${record}.${field.name} ? "Yes" : "No"}`
  if (field.type === "json") return `{${jsonValue(field, record)}}`
  return `{${record}.${field.name}}`
}

function renderNew(resource: ResourceSpec): string {
  const n = resource.names
  return [
    'import { paths } from "jot-framework"',
    `import type { ${n.singularIdent} } from "../../models/${n.singularFile}.ts"`,
    `import ${n.singularIdent}Form from "./_form.tsx"`,
    "",
    `export default function ${n.pluralIdent}New({ ${n.singular}, csrfToken, values }: { ${n.singular}: ${n.singularIdent}; csrfToken: string; values?: Record<string, string | undefined> }) {`,
    "  return (",
    "    <section>",
    `      <h1>New ${n.singular.replace(/_/g, " ")}</h1>`,
    `      <${n.singularIdent}Form ${n.singular}={${n.singular}} csrfToken={csrfToken} action={paths.${n.helperPlural}()} values={values} />`,
    "    </section>",
    "  )",
    "}",
  ].join("\n")
}

function renderEdit(resource: ResourceSpec): string {
  const n = resource.names
  return [
    'import { paths } from "jot-framework"',
    `import type { ${n.singularIdent} } from "../../models/${n.singularFile}.ts"`,
    `import ${n.singularIdent}Form from "./_form.tsx"`,
    "",
    `export default function ${n.pluralIdent}Edit({ ${n.singular}, csrfToken, values }: { ${n.singular}: ${n.singularIdent}; csrfToken: string; values?: Record<string, string | undefined> }) {`,
    "  return (",
    "    <section>",
    `      <h1>Edit ${n.singular.replace(/_/g, " ")}</h1>`,
    `      <${n.singularIdent}Form ${n.singular}={${n.singular}} csrfToken={csrfToken} action={paths.${n.helper}(${n.singular}.id)} method="put" values={values} />`,
    "    </section>",
    "  )",
    "}",
  ].join("\n")
}

/** Primeiro campo de texto (string/text) vira o "título" exibido nas views. */
function displayField(resource: ResourceSpec): FieldSpec | undefined {
  return resource.fields.find((field) => field.type === "string" || field.type === "text")
}

function jsonValue(field: FieldSpec, record: string): string {
  return `${record}.${field.name} === null || ${record}.${field.name} === undefined ? "" : JSON.stringify(${record}.${field.name})`
}
