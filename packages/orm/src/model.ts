// `Model`: a camada ActiveRecord do JOT (contrato §4.2).
//
// Estado fica fora da instância — `WeakSet` (persistida) e `WeakMap` (errors) — para que
// `JSON.stringify(post)` devolva apenas a linha. Os estáticos usam `this: C extends ModelClass`
// + `RecordOf<C>` para inferir `Post & Row<typeof posts>` sem `declare` manual.
//
// biome-ignore-all lint/complexity/noThisInStatic: `this` polimórfico é o mecanismo de inferência
// dos estáticos (C = typeof Post); trocar por `Model` perderia o tipo da subclasse.

import { eq, getTableName } from "drizzle-orm"
import { availableFields, OrmError } from "./errors"
import {
  type ColumnMap,
  columnsOf,
  countRows,
  deleteRow,
  insertRow,
  normalizeId,
  normalizeWhere,
  primaryKeyOf,
  requireTable,
  selectRows,
  updateRow,
} from "./query"
import type {
  AnyTable,
  Errors,
  Input,
  ModelClass,
  QueryOptions,
  RecordOf,
  Row,
  TableOf,
  WhereInput,
  WhereObject,
} from "./types"
import { runValidation, type Validations } from "./validations"

const PERSISTED = new WeakSet<object>()
const ERRORS = new WeakMap<object, Errors>()
/**
 * `save()` em andamento por instância: chamadas concorrentes na MESMA instância reutilizam a
 * operação (senão cada `await` passaria pelo `INSERT` e criaria N linhas). A entrada é
 * removida quando a operação termina, então um `save()` posterior volta a persistir mudanças.
 */
const SAVING = new WeakMap<object, Promise<boolean>>()

/** Convenção de auditoria do `timestamps()` do `@js_on_tracks/db` (colunas `createdAt`/`updatedAt`). */
const CREATED_AT = "createdAt"
const UPDATED_AT = "updatedAt"

function readValidations(ctor: unknown): Validations {
  const validations = (ctor as { validations?: unknown } | null | undefined)?.validations
  if (validations === undefined || validations === null) return {}
  if (typeof validations !== "object" || Array.isArray(validations)) {
    throw new OrmError(
      "invalid `static validations`.",
      "declare it as an object: static validations = { title: [presence(), minLength(3)] }.",
    )
  }
  return validations as Validations
}

/** Copia para a instância apenas chaves que são colunas; `undefined` é ignorado (não apaga). */
function assignColumns(target: object, table: AnyTable, data: object | undefined): void {
  if (data === undefined) return
  const columns = columnsOf(table)
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (Object.hasOwn(columns, key)) (target as Record<string, unknown>)[key] = value
  }
}

/** Monta a linha a partir das colunas definidas na instância (own props; `undefined` fora). */
function columnValues(target: object, columns: ColumnMap): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const key of Object.keys(columns)) {
    if (!Object.hasOwn(target, key)) continue
    const value = (target as Record<string, unknown>)[key]
    if (value !== undefined) values[key] = value
  }
  return values
}

/** Hidrata uma linha do banco sem rodar o construtor (campos viram own props). */
function hydrate<C extends ModelClass>(ctor: C, row: Row<TableOf<C>>): RecordOf<C> {
  const instance = Object.assign(Object.create(ctor.prototype), row) as object
  PERSISTED.add(instance)
  return instance as RecordOf<C>
}

type ModelConstructor<C extends ModelClass> = new (data?: Input<TableOf<C>>) => RecordOf<C>

function newRecord<C extends ModelClass>(ctor: C, data?: Input<TableOf<C>>): RecordOf<C> {
  const Constructor = ctor as unknown as ModelConstructor<C>
  const instance = new Constructor(data)
  // Garante os dados mesmo se a subclasse declarar um construtor próprio sem repassar `data`.
  assignColumns(instance, requireTable(ctor), data)
  return instance
}

/**
 * Corpo do `save()` (extraído para o `WeakMap` de operações em andamento em `Model.save`).
 * Valida e persiste: `UPDATE` se a instância já foi carregada/salva, `INSERT` caso contrário.
 */
async function persist(instance: Model<AnyTable>): Promise<boolean> {
  if (!instance.isValid()) return false

  const table = requireTable(instance.constructor)
  const columns = columnsOf(table)
  const pk = primaryKeyOf(table)
  const values = columnValues(instance, columns)

  if (PERSISTED.has(instance)) {
    const id = (instance as unknown as Record<string, unknown>)[pk.name]
    if (id === undefined || id === null) {
      throw new OrmError(
        `cannot update '${getTableName(table)}' without a primary key value.`,
        "load a persisted row with find()/findBy()/where(), or save() it first.",
      )
    }
    if (columns[CREATED_AT]?.dataType === "date") delete values[CREATED_AT]
    if (columns[UPDATED_AT]?.dataType === "date") values[UPDATED_AT] = new Date()

    const row = await updateRow(table, values, eq(pk.column, id))
    assignColumns(instance, table, row)
    return true
  }

  const pkValue = values[pk.name]
  if (pkValue === undefined || pkValue === null) {
    if (!pk.autoIncrement) {
      throw new OrmError(
        `missing value for primary key '${pk.name}'.`,
        "this table's primary key is not autoincrement; set it before calling save().",
      )
    }
    delete values[pk.name]
  }
  if (columns[CREATED_AT]?.dataType === "date") values[CREATED_AT] ??= new Date()
  if (columns[UPDATED_AT]?.dataType === "date") values[UPDATED_AT] ??= new Date()

  const row = await insertRow(table, values)
  assignColumns(instance, table, row)
  PERSISTED.add(instance)
  return true
}

/**
 * Modelo ActiveRecord sobre uma tabela do Drizzle.
 *
 * ```ts
 * export class Post extends Model<typeof posts> {
 *   static readonly table = posts
 *   static validations = { title: [presence(), minLength(3)] }
 * }
 *
 * const post = await Post.create({ title: "Hello" })  // timestamps automáticos
 * const found = await Post.find(1)
 * if (found) found.title
 * ```
 *
 * Notas de tipagem:
 * - `Post.find(1)` devolve `Post & Row<typeof posts> | null` (interseção montada pelos estáticos).
 * - Métodos da subclasse que leem campos da linha precisam de `this: RecordOf<typeof Post>`.
 * - `Model` não declara `static table`/`static validations`: com `noImplicitOverride` os
 *   subclasses teriam de usar `override` (o contrato não usa).
 */
export class Model<TTable extends AnyTable = AnyTable> {
  constructor(data?: Input<TTable>) {
    assignColumns(this, requireTable(this.constructor), data)
  }

  /** Erros da última validação (`[]` trocado a cada `isValid`). */
  get errors(): Errors {
    return ERRORS.get(this) ?? {}
  }

  /** Roda as validações, repopula `errors` e devolve se não há nenhum erro. */
  isValid(): boolean {
    const table = requireTable(this.constructor)
    const columns = columnsOf(table)
    const validations = readValidations(this.constructor)
    const errors: Errors = {}

    for (const [field, rules] of Object.entries(validations)) {
      if (!Object.hasOwn(columns, field)) {
        throw new OrmError(
          `validation for unknown field '${field}' in '${getTableName(table)}'.`,
          availableFields(Object.keys(columns)),
        )
      }
      if (!Array.isArray(rules)) {
        throw new OrmError(
          `invalid validations for field '${field}' in '${getTableName(table)}'.`,
          "each field maps to an array of validators, e.g. { title: [presence(), minLength(3)] }.",
        )
      }
      const value = (this as Record<string, unknown>)[field]
      for (const rule of rules) {
        const message = runValidation(rule, field, value)
        if (message === undefined) continue
        const messages = errors[field] ?? []
        messages.push(message)
        errors[field] = messages
      }
    }

    ERRORS.set(this, errors)
    return Object.keys(errors).length === 0
  }

  /** Aplica campos em memória (não persiste, não mexe em `errors`); devolve `this`. */
  update(data: Input<TTable>): this {
    assignColumns(this, requireTable(this.constructor), data)
    return this
  }

  /**
   * Valida e persiste: `UPDATE` se a instância foi carregada/salva antes, `INSERT` caso
   * contrário. `createdAt`/`updatedAt` são automáticos (colunas `dataType === "date"`).
   * Devolve `false` (sem persistir) quando `isValid()` falha.
   *
   * Chamadas concorrentes na mesma instância (`Promise.all([post.save(), post.save()])`)
   * compartilham a operação em andamento — um registro novo é inserido uma única vez.
   */
  async save(): Promise<boolean> {
    const pending = SAVING.get(this)
    if (pending !== undefined) return pending

    const operation = persist(this)
    SAVING.set(this, operation)
    try {
      return await operation
    } finally {
      SAVING.delete(this)
    }
  }

  /**
   * Remove a linha pela chave primária. A instância deixa de estar persistida e a chave é
   * limpa: um `save()` posterior insere um novo registro (novo id em tabelas autoincrement).
   */
  async destroy(): Promise<void> {
    const table = requireTable(this.constructor)
    const pk = primaryKeyOf(table)
    const value = (this as Record<string, unknown>)[pk.name]
    if (value === undefined || value === null) {
      throw new OrmError(
        `cannot delete '${getTableName(table)}' without a primary key value.`,
        "load the row with find()/findBy()/where(), or save() it before calling destroy().",
      )
    }

    await deleteRow(table, eq(pk.column, value))
    PERSISTED.delete(this)
    delete (this as Record<string, unknown>)[pk.name]
  }

  /** Instância nova, sem tocar no banco (`new Post(data)` com a tipagem da linha). */
  static new<C extends ModelClass>(this: C, data?: Input<TableOf<C>>): RecordOf<C> {
    return newRecord(this, data)
  }

  /**
   * Insere e devolve a instância persistida; lança `OrmError` quando as validações falham
   * (use `new()` + `save()` para tratar o retorno `false`).
   */
  static async create<C extends ModelClass>(
    this: C,
    data?: Input<TableOf<C>>,
  ): Promise<RecordOf<C>> {
    const instance = newRecord(this, data)
    if (await instance.save()) return instance

    const details = Object.entries(instance.errors)
      .map(([field, messages]) => `${field} ${messages.join(", ")}`)
      .join("; ")
    throw new OrmError(
      `could not save '${getTableName(requireTable(this))}': validation failed (${details}).`,
      "fix the errors (see `instance.errors`) or use `new()` + `save()` to handle them without raising.",
    )
  }

  /** Todas as linhas (default: pk asc). */
  static async all<C extends ModelClass>(
    this: C,
    options?: QueryOptions<TableOf<C>>,
  ): Promise<Array<RecordOf<C>>> {
    const table = requireTable<TableOf<C>>(this)
    const rows = await selectRows(table, undefined, options)
    return rows.map((row) => hydrate(this, row))
  }

  /** Busca pela chave primária (aceita `number` ou string numérica); `null` se não existir. */
  static async find<C extends ModelClass>(
    this: C,
    id: number | string,
  ): Promise<RecordOf<C> | null> {
    const table = requireTable<TableOf<C>>(this)
    const pk = primaryKeyOf(table)
    const rows = await selectRows(table, eq(pk.column, normalizeId(id)), { limit: 1 })
    const row = rows[0]
    return row === undefined ? null : hydrate(this, row)
  }

  /** Primeira linha que casa com a igualdade por campo (ordenação default: pk asc). */
  static async findBy<C extends ModelClass>(
    this: C,
    where: WhereObject<TableOf<C>>,
    options?: QueryOptions<TableOf<C>>,
  ): Promise<RecordOf<C> | null> {
    const table = requireTable<TableOf<C>>(this)
    const rows = await selectRows(table, normalizeWhere(table, where), { ...options, limit: 1 })
    const row = rows[0]
    return row === undefined ? null : hydrate(this, row)
  }

  /** Linhas que casam com um objeto de igualdade ou com um callback de operadores. */
  static async where<C extends ModelClass>(
    this: C,
    where?: WhereInput<TableOf<C>>,
    options?: QueryOptions<TableOf<C>>,
  ): Promise<Array<RecordOf<C>>> {
    const table = requireTable<TableOf<C>>(this)
    const rows = await selectRows(table, normalizeWhere(table, where), options)
    return rows.map((row) => hydrate(this, row))
  }

  /** Conta linhas (todas ou as que casam com o filtro). */
  static async count<C extends ModelClass>(
    this: C,
    where?: WhereInput<TableOf<C>>,
  ): Promise<number> {
    const table = requireTable<TableOf<C>>(this)
    return countRows(table, normalizeWhere(table, where))
  }
}
