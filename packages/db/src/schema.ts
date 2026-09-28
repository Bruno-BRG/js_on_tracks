import type { BuildColumns, HasDefault, NotNull } from "drizzle-orm/column-builder"
import {
  type AnySQLiteTable,
  type SQLiteColumn,
  type SQLiteColumnBuilderBase,
  type SQLiteTableWithColumns,
  integer as sqliteInteger,
  real as sqliteReal,
  sqliteTable,
  text as sqliteText,
} from "drizzle-orm/sqlite-core"
import { databaseError } from "./driver"

/**
 * Qualquer tabela criada por `table(...)`. Usado pela DSL (ex.: `refs(() => users)`) para
 * aceitar tabelas declaradas depois — a resolução acontece de forma preguiçosa.
 */
export type AnyTable = AnySQLiteTable

/** Ações de chave estrangeira aceitas pelo SQLite. */
export type ReferenceAction = "cascade" | "restrict" | "no action" | "set null" | "set default"

/** Tipo do valor aceito em `default(...)` (respeita `$type` de colunas `json`). */
export type ColumnData<TBuilder extends SQLiteColumnBuilderBase> = TBuilder["_"] extends {
  $type: infer TType
}
  ? TType
  : TBuilder["_"]["data"]

/**
 * Descritor de coluna da DSL: encadeável (`notNull`, `default`, `unique`) e capaz de construir
 * o builder concreto do Drizzle já com o nome SQL em `snake_case`.
 */
export interface ColumnDescriptor<
  TBuilder extends SQLiteColumnBuilderBase = SQLiteColumnBuilderBase,
> {
  /** Constrói o builder do Drizzle com o nome SQL explícito. */
  build(columnName: string): TBuilder
  notNull(): ColumnDescriptor<NotNull<TBuilder>>
  default(value: ColumnData<TBuilder>): ColumnDescriptor<HasDefault<TBuilder>>
  unique(name?: string): ColumnDescriptor<TBuilder>
}

export type AnyColumnDescriptor = ColumnDescriptor<SQLiteColumnBuilderBase>

/**
 * Visão estrutural mínima dos builders do Drizzle usada internamente para encadear métodos
 * sem depender da classe concreta. As classes reais satisfazem essa forma.
 */
type ChainableBuilder = {
  notNull(): SQLiteColumnBuilderBase
  default(value: never): SQLiteColumnBuilderBase
  unique(name?: string): SQLiteColumnBuilderBase
}

function chain<TBuilder extends SQLiteColumnBuilderBase>(builder: TBuilder): ChainableBuilder {
  return builder as unknown as ChainableBuilder
}

function makeColumn<TBuilder extends SQLiteColumnBuilderBase>(
  create: (columnName: string) => TBuilder,
): ColumnDescriptor<TBuilder> {
  return {
    build: create,
    notNull: () =>
      makeColumn<NotNull<TBuilder>>(
        (columnName) => chain(create(columnName)).notNull() as NotNull<TBuilder>,
      ),
    default: (value) =>
      makeColumn<HasDefault<TBuilder>>(
        (columnName) => chain(create(columnName)).default(value as never) as HasDefault<TBuilder>,
      ),
    unique: (name) =>
      makeColumn<TBuilder>((columnName) => chain(create(columnName)).unique(name) as TBuilder),
  }
}

/**
 * `createdAt` → `created_at`, `authorId` → `author_id`, `HTMLParser` → `html_parser`.
 * Nomes de coluna são sempre explícitos: nunca inferidos pelo Drizzle a partir da chave JS.
 */
export function toSnakeCase(fieldName: string): string {
  return fieldName
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
}

/** Colunas de uma tabela da DSL, indexadas pela chave JS (`camelCase`). */
export type BuildersOf<TColumns extends Record<string, AnyColumnDescriptor>> = {
  [K in keyof TColumns]: TColumns[K] extends ColumnDescriptor<infer TBuilder> ? TBuilder : never
}

/** Tabela do Drizzle produzida por `table(...)`, com as colunas mapeadas explicitamente. */
export type Table<
  TName extends string = string,
  TColumns extends Record<string, AnyColumnDescriptor> = Record<string, AnyColumnDescriptor>,
> = SQLiteTableWithColumns<{
  name: TName
  schema: undefined
  columns: BuildColumns<TName, BuildersOf<TColumns>, "sqlite">
  dialect: "sqlite"
}>

/**
 * Declara uma tabela. Cada chave do objeto vira a chave JS (camelCase) e o nome SQL é o
 * `snake_case` dela, passado explicitamente ao builder — o `drizzle-kit generate` lê o
 * resultado normalmente.
 */
export function table<TName extends string, TColumns extends Record<string, AnyColumnDescriptor>>(
  name: TName,
  columns: TColumns,
): Table<TName, TColumns> {
  const builders = Object.fromEntries(
    Object.entries(columns).map(([key, descriptor]) => [key, descriptor.build(toSnakeCase(key))]),
  ) as unknown as BuildersOf<TColumns>
  return sqliteTable(name, builders)
}

/** Chave primária `integer primary key autoincrement`. */
export function id() {
  return makeColumn((name) => sqliteInteger(name).primaryKey({ autoIncrement: true }))
}

/** Coluna `text` (use `text()` quando o conteúdo for longo e sem limite). */
export function string() {
  return makeColumn((name) => sqliteText(name))
}

/** Coluna `text`. */
export function text() {
  return makeColumn((name) => sqliteText(name))
}

/** Coluna `integer` no modo boolean (0/1 no banco, `boolean` no JS). */
export function boolean() {
  return makeColumn((name) => sqliteInteger(name, { mode: "boolean" }))
}

/** Coluna `integer`. */
export function integer() {
  return makeColumn((name) => sqliteInteger(name))
}

/** Coluna `real`. */
export function real() {
  return makeColumn((name) => sqliteReal(name))
}

/** Coluna `text` com `JSON.parse`/`JSON.stringify` no modo JSON do Drizzle. */
export function json<TData = unknown>() {
  return makeColumn((name) => sqliteText(name, { mode: "json" }).$type<TData>())
}

/** Colunas de auditoria: `createdAt`/`updatedAt` (`integer` em `timestamp_ms`), não nulas. */
export function timestamps() {
  return {
    createdAt: makeColumn((name) => sqliteInteger(name, { mode: "timestamp_ms" }).notNull()),
    updatedAt: makeColumn((name) => sqliteInteger(name, { mode: "timestamp_ms" }).notNull()),
  }
}

export interface RefsOptions {
  onDelete?: ReferenceAction
  onUpdate?: ReferenceAction
}

/**
 * Coluna `integer` com FK para o `id` da tabela alvo:
 * `authorId: refs(() => users)` → coluna `author_id` referenciando `users(id)`.
 */
export function refs(target: () => AnyTable, options: RefsOptions = {}) {
  return makeColumn((name) => {
    const actions: { onDelete?: ReferenceAction; onUpdate?: ReferenceAction } = {}
    if (options.onDelete) actions.onDelete = options.onDelete
    if (options.onUpdate) actions.onUpdate = options.onUpdate

    return sqliteInteger(name).references(
      () => {
        const table = target() as unknown as { id?: SQLiteColumn }
        if (!table.id) {
          throw databaseError(
            'refs(...) requires the referenced table to have an "id" column. ' +
              "Declare `id: id()` on the target table (or reference the correct column).",
          )
        }
        return table.id
      },
      Object.keys(actions).length > 0 ? actions : undefined,
    )
  })
}
