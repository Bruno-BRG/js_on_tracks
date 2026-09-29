// Tipos públicos do `@js_on_tracks/orm` (contrato §4.2).
//
// A inferência dos estáticos vem de `this: C extends ModelClass` + `RecordOf<C>`:
// `Post.find(1)` devolve `Post & Row<typeof posts> | null` sem nenhum `declare` manual.
// `Model` não declara campos estáticos (`table`/`validations`) porque `noImplicitOverride`
// exigiria `override` nos subclasses (TS4114) — o contrato usa `static readonly table = posts`.

import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import type { Model } from "./model" // ciclo apenas de tipos (apagado no runtime)

/** Qualquer tabela do Drizzle/SQLite aceita pelo ORM. */
export type AnyTable = SQLiteTable

/** Linha como devolvida por um `SELECT` (colunas com defaults/nullable resolvidos). */
export type Row<TTable extends AnyTable> = InferSelectModel<TTable>

/** Campos aceitos em `new`/`create`/`update`: insert model parcial. */
export type Input<TTable extends AnyTable> = Partial<InferInsertModel<TTable>>

/** Mapa de erros de validação: campo → lista de mensagens. */
export type Errors = Record<string, string[]>

/** Nome JS de uma coluna (`title`, `createdAt`, ...). */
export type ColumnName<TTable extends AnyTable> = keyof Row<TTable> & string

/** Termo de ordenação: `"title"` (asc) ou `"-title"` (desc). */
export type OrderTerm<TTable extends AnyTable> = ColumnName<TTable> | `-${ColumnName<TTable>}`

export interface QueryOptions<TTable extends AnyTable> {
  order?: OrderTerm<TTable> | readonly OrderTerm<TTable>[]
  limit?: number
  offset?: number
}

/** Igualdade por campo: `{ published: false }`. */
export type WhereObject<TTable extends AnyTable> = Partial<Row<TTable>>

/**
 * Filtro aceito por `where`/`count`: igualdade por campo ou callback que recebe a tabela
 * (ex.: `(t) => and(eq(t.published, true), gt(t.id, 10))`; `and(...)` pode devolver `undefined`).
 */
export type WhereInput<TTable extends AnyTable> =
  | WhereObject<TTable>
  | ((table: TTable) => SQL<unknown> | undefined)

/**
 * Forma estrutural de uma classe modelo (o lado estático). Usada como restrição de `C`:
 * `prototype: Model<AnyTable>` (e não `object`) é o que dá `save()`/`errors` dentro dos
 * estáticos, como em `create()`.
 */
export interface ModelClass {
  readonly table: AnyTable
  readonly prototype: Model<AnyTable>
}

/** Tabela da classe modelo (`typeof Post` → `typeof posts`). */
export type TableOf<C extends ModelClass> = C["table"]

/** Instância própria da subclasse (métodos dela inclusos), sem os campos da linha. */
export type InstanceOf<C extends ModelClass> = C["prototype"]

/** O que os estáticos devolvem: a instância da subclasse + as colunas da tabela. */
export type RecordOf<C extends ModelClass> = InstanceOf<C> & Row<TableOf<C>>
