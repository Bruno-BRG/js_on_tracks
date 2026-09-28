import { CliError } from "../output"
import { type FieldSpec, parseField } from "./fields"
import { type ResourceNames, resourceNames } from "./naming"
import { RESERVED_BINDING_IDENTIFIERS } from "./reserved"

/** Resource montado a partir do argv (`scaffold post title:string! ...`). */
export interface ResourceSpec {
  readonly rawName: string
  readonly names: ResourceNames
  readonly fields: readonly FieldSpec[]
}

/** Valida o nome do resource (1 segmento, sem `/`/`-`, sem começar com número). */
export function buildResource(rawName: string, rawFields: readonly string[]): ResourceSpec {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(rawName)) {
    throw new CliError(
      `Invalid name "${rawName}". Use letters, numbers and underscores, e.g. "post" or "blog_post". ` +
        "Namespaced generators (admin/posts) are not supported yet.",
    )
  }

  const names = resourceNames(rawName)
  const bindings = [names.table, names.singular]
  const reservedBinding = bindings.find((binding) => RESERVED_BINDING_IDENTIFIERS.has(binding))
  if (reservedBinding !== undefined) {
    throw new CliError(
      `Invalid name "${rawName}": generated binding "${reservedBinding}" is reserved by JavaScript/TypeScript. Choose a different resource name.`,
    )
  }

  const fields: FieldSpec[] = []
  const seenNames = new Set<string>()
  const seenColumns = new Map<string, string>()
  for (const token of rawFields) {
    const field = parseField(token)
    if (seenNames.has(field.name)) {
      throw new CliError(`Duplicate field "${field.rawName}". Remove one of the declarations.`)
    }
    const previous = seenColumns.get(field.column)
    if (previous !== undefined) {
      throw new CliError(
        `Fields "${previous}" and "${field.rawName}" both map to SQL column "${field.column}". Rename one before generating.`,
      )
    }
    seenNames.add(field.name)
    seenColumns.set(field.column, field.rawName)
    fields.push(field)
  }

  return { rawName, names, fields }
}
