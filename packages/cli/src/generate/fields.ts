import { camelCase } from "../naming"
import { CliError } from "../output"
import { snakeCase } from "./naming"
import { ORM_INSTANCE_MEMBERS, RESERVED_BINDING_IDENTIFIERS } from "./reserved"

/** Tipos aceitos em `name:type`. */
export const FIELD_TYPES = [
  "string",
  "text",
  "integer",
  "real",
  "decimal",
  "boolean",
  "json",
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

/** Como o campo aparece no formulário. */
export type FieldInput = "text" | "textarea" | "number" | "number-any" | "checkbox"

/** Campo declarado em `jot generate ... field:type[!]`. */
export interface FieldSpec {
  /** Chave JS no schema (`authorId`). */
  readonly name: string
  /** Nome como digitado (`author_id`), usado nas mensagens. */
  readonly rawName: string
  /** Coluna SQL (`author_id`), derivada pelo `toSnakeCase` do `@jot/db`. */
  readonly column: string
  /** Rótulo humano (`Author id`). */
  readonly label: string
  readonly type: FieldType
  readonly notNull: boolean
}

const FIELD_TYPES_HINT = `Valid types: ${FIELD_TYPES.join(", ")}.`

const RESERVED_COLUMNS = new Set(["id", "created_at", "updated_at"])

/**
 * Interpreta `name:type[!]`. `!` vira `.notNull()` no schema e `presence()` no model.
 *
 * `decimal` é alias de `real` (SQLite não tem decimal) e `boolean` sempre ganha
 * `.default(false)` (estilo do fixture/blog).
 */
export function parseField(token: string): FieldSpec {
  const separator = token.indexOf(":")
  if (separator === -1) {
    throw new CliError(
      `Invalid field "${token}". Use \`name:type\`, for example \`title:string!\`. ${FIELD_TYPES_HINT}`,
    )
  }

  const rawName = token.slice(0, separator).trim()
  const rawType = token.slice(separator + 1).trim()
  const notNull = rawType.endsWith("!")
  const type = rawType.replace(/!$/, "")

  if (!isFieldType(type)) {
    throw new CliError(`Invalid field "${token}". Unknown type "${type}". ${FIELD_TYPES_HINT}`)
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(rawName)) {
    throw new CliError(
      `Invalid field name "${rawName}". Use letters, numbers and underscores (e.g. "title" or "author_id").`,
    )
  }

  const name = camelCase(rawName)
  const column = snakeCase(name)
  if (RESERVED_COLUMNS.has(column)) {
    if (column === "id") {
      throw new CliError(
        `Field "${rawName}" is reserved: \`id()\` already declares the primary key for every table.`,
      )
    }
    throw new CliError(
      `Field "${rawName}" is reserved: \`timestamps()\` already adds createdAt/updatedAt.`,
    )
  }
  if (ORM_INSTANCE_MEMBERS.has(name)) {
    throw new CliError(
      `Field "${rawName}" is reserved because it conflicts with the @jot/orm Model API. Choose a different field name.`,
    )
  }
  if (RESERVED_BINDING_IDENTIFIERS.has(name)) {
    throw new CliError(
      `Field "${rawName}" is reserved by JavaScript/TypeScript and cannot be generated as a model property. Choose a different field name.`,
    )
  }

  return {
    name,
    rawName,
    column,
    label: labelOf(column),
    type,
    notNull,
  }
}

function isFieldType(type: string): type is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(type)
}

/** `author_id` → `Author id`. */
function labelOf(column: string): string {
  const spaced = column.replace(/_/g, " ")
  return spaced[0].toUpperCase() + spaced.slice(1)
}
