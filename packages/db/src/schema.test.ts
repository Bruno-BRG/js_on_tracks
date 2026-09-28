import assert from "node:assert/strict"
import { test } from "node:test"
import { getTableName } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/sqlite-core"
import {
  type AnyTable,
  boolean,
  id,
  integer,
  json,
  real,
  refs,
  string,
  table,
  text,
  timestamps,
} from "./index"

const users = table("users", {
  id: id(),
  name: string().notNull(),
  email: string().notNull().unique(),
  active: boolean().notNull().default(true),
  ...timestamps(),
})

const posts = table("posts", {
  id: id(),
  authorId: refs(() => users, { onDelete: "cascade" }).notNull(),
  title: string().notNull(),
  body: text(),
  views: integer().notNull().default(0),
  rating: real(),
  meta: json<{ tags: string[] }>(),
  published: boolean().default(false),
  ...timestamps(),
})

test("table() converte as chaves JS para nomes de coluna snake_case explícitos", () => {
  const config = getTableConfig(posts)
  assert.equal(config.name, "posts")
  assert.deepEqual(
    config.columns.map((column) => column.name),
    [
      "id",
      "author_id",
      "title",
      "body",
      "views",
      "rating",
      "meta",
      "published",
      "created_at",
      "updated_at",
    ],
  )

  const usersConfig = getTableConfig(users)
  assert.equal(usersConfig.name, "users")
  assert.deepEqual(
    usersConfig.columns.map((column) => column.name),
    ["id", "name", "email", "active", "created_at", "updated_at"],
  )
})

test("drizzle-kit lê o resultado via getTableConfig (tipos, defaults e nullable)", () => {
  const config = getTableConfig(posts)
  const byName = new Map(config.columns.map((column) => [column.name, column]))

  const idColumn = byName.get("id")
  assert.ok(idColumn)
  assert.equal(idColumn.primary, true)
  assert.equal((idColumn as unknown as { autoIncrement: boolean }).autoIncrement, true)

  const title = byName.get("title")
  assert.ok(title)
  assert.equal(title.columnType, "SQLiteText")
  assert.equal(title.notNull, true)
  assert.equal(title.hasDefault, false)

  const body = byName.get("body")
  assert.ok(body)
  assert.equal(body.notNull, false)

  const views = byName.get("views")
  assert.ok(views)
  assert.equal(views.columnType, "SQLiteInteger")
  assert.equal(views.hasDefault, true)
  assert.equal(views.default, 0)

  const rating = byName.get("rating")
  assert.ok(rating)
  assert.equal(rating.columnType, "SQLiteReal")

  const meta = byName.get("meta")
  assert.ok(meta)
  assert.equal(meta.columnType, "SQLiteTextJson")
  assert.equal(meta.dataType, "json")

  const published = byName.get("published")
  assert.ok(published)
  assert.equal(published.columnType, "SQLiteBoolean")
  assert.equal(published.dataType, "boolean")
  assert.equal(published.default, false)

  const createdAt = byName.get("created_at")
  assert.ok(createdAt)
  assert.equal(createdAt.columnType, "SQLiteTimestamp")
  assert.equal(createdAt.notNull, true)
  assert.equal((createdAt as unknown as { mode: string }).mode, "timestamp_ms")

  const email = getTableConfig(users).columns.find((column) => column.name === "email")
  assert.ok(email)
  assert.equal(email.isUnique, true)

  const active = getTableConfig(users).columns.find((column) => column.name === "active")
  assert.ok(active)
  assert.equal(active.default, true)
})

test("refs() gera FK para o id da tabela alvo com onDelete", () => {
  const config = getTableConfig(posts)
  assert.equal(config.foreignKeys.length, 1)

  const foreignKey = config.foreignKeys[0]
  assert.ok(foreignKey)
  assert.equal(foreignKey.onDelete, "cascade")
  const reference = foreignKey.reference()
  assert.equal(getTableName(reference.foreignTable), "users")
  assert.deepEqual(
    reference.columns.map((column) => column.name),
    ["author_id"],
  )
  assert.deepEqual(
    reference.foreignColumns.map((column) => column.name),
    ["id"],
  )
})

test("timestamps() devolve createdAt/updatedAt não-nulos em timestamp_ms", () => {
  const columns = timestamps()
  assert.deepEqual(Object.keys(columns), ["createdAt", "updatedAt"])

  const events = table("events", { id: id(), ...columns })
  const config = getTableConfig(events)
  const byName = new Map(config.columns.map((column) => [column.name, column]))
  for (const name of ["created_at", "updated_at"]) {
    const column = byName.get(name)
    assert.ok(column)
    assert.equal(column.columnType, "SQLiteTimestamp")
    assert.equal(column.notNull, true)
    assert.equal((column as unknown as { mode: string }).mode, "timestamp_ms")
  }
})

test("builders encadeiam notNull/default/unique", () => {
  const chained = table("chained", {
    label: string().notNull().default("x").unique(),
    amount: integer().default(1),
    ownerId: refs(() => users).notNull(),
  })
  const byName = new Map(getTableConfig(chained).columns.map((column) => [column.name, column]))

  const label = byName.get("label")
  assert.ok(label)
  assert.equal(label.notNull, true)
  assert.equal(label.default, "x")
  assert.equal(label.isUnique, true)

  const amount = byName.get("amount")
  assert.ok(amount)
  assert.equal(amount.notNull, false)
  assert.equal(amount.default, 1)

  const ownerId = byName.get("owner_id")
  assert.ok(ownerId)
  assert.equal(ownerId.notNull, true)
  assert.equal(getTableConfig(chained).foreignKeys.length, 1)
})

test("snake_case cobre acrônimos e maiúsculas no meio da chave", () => {
  const weird = table("weird", {
    htmlParser: string(),
    userID: integer(),
    already_snake: boolean(),
  })
  assert.deepEqual(
    getTableConfig(weird).columns.map((column) => column.name),
    ["html_parser", "user_id", "already_snake"],
  )
})

test("refs() sem coluna id na tabela alvo falha com erro didático", () => {
  const tag = table("tags", { label: string() })
  const broken = table("broken", { tagId: refs(() => tag) })
  const foreignKey = getTableConfig(broken).foreignKeys[0]
  assert.ok(foreignKey)
  assert.throws(
    () => foreignKey.reference(),
    /requires the referenced table to have an "id" column/,
  )
})

test("AnyTable aceita qualquer tabela criada pela DSL", () => {
  const accept = (value: AnyTable): AnyTable => value
  assert.equal(accept(users), users)
  assert.equal(accept(posts), posts)
})
