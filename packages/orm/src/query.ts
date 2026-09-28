// Consultas do ORM sobre o Drizzle: normalização de filtros/ordenação, SELECT/COUNT e
// INSERT/UPDATE/DELETE com `returning()` (SQLite suporta — confirmado no spike do `@jot/db`).

import { and, asc, count, desc, eq, getTableColumns, getTableName, type SQL } from "drizzle-orm"
import {
  type SQLiteColumn,
  type SQLiteInsertValue,
  SQLiteTable,
  type SQLiteUpdateSetSource,
} from "drizzle-orm/sqlite-core"
import { drizzle } from "./database"
import { availableFields, describeValue, OrmError } from "./errors"
import type { AnyTable, OrderTerm, QueryOptions, Row, WhereInput } from "./types"

/** Colunas de uma tabela indexadas pela chave JS (`getTableColumns`). */
export type ColumnMap = Record<string, SQLiteColumn>

/** Nomes que pertencem à API do `Model` e não podem ser colunas (sobrescreveriam métodos). */
const RESERVED_COLUMNS = [
  "constructor",
  "then",
  "errors",
  "isValid",
  "update",
  "save",
  "destroy",
] as const

/** Tabelas já checadas (a checagem de colunas reservadas roda uma vez por tabela). */
const checkedTables = new WeakSet<AnyTable>()

export function isTable(value: unknown): value is AnyTable {
  return value instanceof SQLiteTable
}

/**
 * Lê `ctor.table` validando em runtime (uma subclasse sem `static table` falha aqui) e
 * recusa colunas reservadas — sem isso o `Object.assign` da hidratação sobrescreveria
 * `post.save`, e uma coluna `then` faria `await post` chamar a coluna.
 */
export function requireTable<TTable extends AnyTable = AnyTable>(ctor: unknown): TTable {
  const table = (ctor as { table?: unknown } | null | undefined)?.table
  if (!isTable(table)) {
    const name = typeof ctor === "function" && ctor.name !== "" ? ctor.name : "anonymous"
    throw new OrmError(
      `Model '${name}' has no table defined.`,
      "declare it with `static readonly table = yourTable` — e.g. " +
        "class Post extends Model<typeof posts> { static readonly table = posts }.",
    )
  }

  if (!checkedTables.has(table)) {
    const reserved = Object.keys(getTableColumns(table)).filter((key) =>
      (RESERVED_COLUMNS as readonly string[]).includes(key),
    )
    if (reserved.length > 0) {
      throw new OrmError(
        `table '${getTableName(table)}' has reserved column(s): ${reserved.map((key) => `'${key}'`).join(", ")}.`,
        "rename them (e.g. saveAction) — these names belong to the Model API.",
      )
    }
    checkedTables.add(table)
  }

  return table as TTable
}

/** Colunas da tabela pela chave JS. */
export function columnsOf(table: AnyTable): ColumnMap {
  return getTableColumns(table)
}

/** Identifica a coluna `primary` (a primeira, se houver mais de uma). */
export interface PrimaryKeyInfo {
  readonly name: string
  readonly column: SQLiteColumn
  readonly autoIncrement: boolean
}

export function primaryKeyOf(table: AnyTable): PrimaryKeyInfo {
  for (const [name, column] of Object.entries(columnsOf(table))) {
    if (!column.primary) continue
    const autoIncrement = (column as { autoIncrement?: unknown }).autoIncrement === true
    return { name, column, autoIncrement }
  }
  throw new OrmError(
    `table '${getTableName(table)}' has no primary key.`,
    "define one with `id: id()` (integer primary key autoincrement).",
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Mensagens do erro e da cadeia de `cause`s (o Drizzle encapsula o erro do driver). */
function errorChain(error: unknown): string[] {
  const messages: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    messages.push(current.message)
    current = (current as { cause?: unknown }).cause
  }
  return messages
}

/**
 * Converte violações de UNIQUE/PK (falha previsível: id explícito duplicado, valor repetido
 * em coluna única) em `OrmError` didático, preservando o erro original em `cause`.
 * Outras falhas (NOT NULL, FK, ...) seguem cruas.
 */
function constraintError(error: unknown, table: AnyTable): OrmError | undefined {
  const detail = errorChain(error).find((message) =>
    /unique constraint|primary key constraint/i.test(message),
  )
  if (detail === undefined) return undefined

  const columns = /failed:\s*([^\n]+)/i.exec(detail)?.[1]?.trim()
  return new OrmError(
    `duplicate value for a unique column in '${getTableName(table)}'${columns === undefined ? "" : ` (${columns})`}.`,
    "use a different value; for autoincrement primary keys, call save() without setting `id`.",
    { cause: error },
  )
}

/**
 * Normaliza o filtro: callback recebe a tabela (operadores avançados); objeto aplica
 * igualdade por campo (`undefined` é ignorado); campo desconhecido → `OrmError`.
 */
export function normalizeWhere<TTable extends AnyTable>(
  table: TTable,
  where: WhereInput<TTable> | undefined,
): SQL<unknown> | undefined {
  if (where === undefined || where === null) return undefined
  if (typeof where === "function") return where(table)
  if (!isPlainObject(where)) {
    throw new OrmError(
      `invalid filter: ${describeValue(where)}.`,
      "use an object ({ field: value }) or a callback ((t) => eq(t.field, value)).",
    )
  }

  const columns = columnsOf(table)
  const conditions: SQL<unknown>[] = []
  for (const [name, value] of Object.entries(where)) {
    if (value === undefined) continue
    const column = columns[name]
    if (column === undefined) {
      throw new OrmError(
        `unknown field in filter: '${name}'.`,
        availableFields(Object.keys(columns)),
      )
    }
    conditions.push(eq(column, value))
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return and(...conditions)
}

/**
 * Ordenação: `"createdAt"` asc, `"-createdAt"` desc; default `asc(pk)`.
 * Termo desconhecido → `OrmError`.
 */
export function orderColumns<TTable extends AnyTable>(
  table: TTable,
  order: OrderTerm<TTable> | readonly OrderTerm<TTable>[] | undefined,
): SQL<unknown>[] {
  if (order === undefined) return [asc(primaryKeyOf(table).column)]

  const terms: readonly OrderTerm<TTable>[] = Array.isArray(order) ? order : [order]
  if (terms.length === 0) return [asc(primaryKeyOf(table).column)]

  const columns = columnsOf(table)
  return terms.map((term) => {
    const text = String(term)
    const descending = text.startsWith("-")
    const name = descending ? text.slice(1) : text
    const column = columns[name]
    if (column === undefined) {
      throw new OrmError(
        `unknown field in order: '${text}'.`,
        availableFields(Object.keys(columns)),
      )
    }
    return descending ? desc(column) : asc(column)
  })
}

/** Valida `options` em runtime (quem chama via `any`/JS também recebe erro didático). */
export function normalizeOptions<TTable extends AnyTable>(
  options: QueryOptions<TTable> | undefined,
): QueryOptions<TTable> {
  if (options === undefined) return {}
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new OrmError(
      `invalid options: ${describeValue(options)}.`,
      'pass an object like { order: "-createdAt", limit: 10, offset: 0 }.',
    )
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new OrmError(
      `invalid limit: ${String(options.limit)}.`,
      "limit must be a non-negative integer.",
    )
  }
  if (options.offset !== undefined && (!Number.isInteger(options.offset) || options.offset < 0)) {
    throw new OrmError(
      `invalid offset: ${String(options.offset)}.`,
      "offset must be a non-negative integer.",
    )
  }
  return options
}

/** `find(1)`/`find("1")` viram `1`; qualquer outra coisa → `OrmError` didático. */
export function normalizeId(id: number | string): number {
  if (typeof id === "number" && Number.isInteger(id)) return id
  if (typeof id === "string" && /^-?\d+$/.test(id.trim())) return Number(id.trim())
  throw new OrmError(
    `find('${String(id)}') received a non-numeric id.`,
    "use find(1) or find('1'); for other filters use findBy({ field: value }).",
  )
}

export async function selectRows<TTable extends AnyTable>(
  table: TTable,
  where: SQL<unknown> | undefined,
  options?: QueryOptions<TTable>,
): Promise<Array<Row<TTable>>> {
  const normalized = normalizeOptions(options)
  let query = drizzle().select().from(table).$dynamic()
  if (where !== undefined) query = query.where(where)
  query = query.orderBy(...orderColumns(table, normalized.order))
  if (normalized.limit !== undefined) query = query.limit(normalized.limit)
  if (normalized.offset !== undefined) query = query.offset(normalized.offset)
  return await query
}

export async function countRows<TTable extends AnyTable>(
  table: TTable,
  where: SQL<unknown> | undefined,
): Promise<number> {
  const rows = await drizzle().select({ total: count() }).from(table).where(where)
  return Number(rows[0]?.total ?? 0)
}

export async function insertRow<TTable extends AnyTable>(
  table: TTable,
  values: Record<string, unknown>,
): Promise<Row<TTable>> {
  let row: Row<TTable> | undefined
  try {
    const rows = await drizzle()
      .insert(table)
      .values(values as SQLiteInsertValue<TTable>)
      .returning()
    row = rows[0] as Row<TTable> | undefined
  } catch (error) {
    throw constraintError(error, table) ?? error
  }
  if (row === undefined) {
    throw new OrmError(
      `insert into '${getTableName(table)}' did not return the created row.`,
      "confirm that the database driver supports returning().",
    )
  }
  return row
}

export async function updateRow<TTable extends AnyTable>(
  table: TTable,
  values: Record<string, unknown>,
  where: SQL<unknown>,
): Promise<Row<TTable>> {
  let row: Row<TTable> | undefined
  try {
    const rows = await drizzle()
      .update(table)
      .set(values as SQLiteUpdateSetSource<TTable>)
      .where(where)
      .returning()
    row = rows[0] as Row<TTable> | undefined
  } catch (error) {
    throw constraintError(error, table) ?? error
  }
  if (row === undefined) {
    throw new OrmError(
      `update on '${getTableName(table)}' did not return the updated row.`,
      "confirm that the row still exists and the driver supports returning().",
    )
  }
  return row
}

export async function deleteRow<TTable extends AnyTable>(
  table: TTable,
  where: SQL<unknown>,
): Promise<void> {
  await drizzle().delete(table).where(where)
}
