// Testes de runtime do `@js_on_tracks/orm`: CRUD, consultas, timestamps e erros didáticos.
// Banco SQLite `:memory:` do `@js_on_tracks/db` (sem rede, sem arquivos temporários).

import assert from "node:assert/strict"
import { after, test } from "node:test"
import { id, string, table } from "@js_on_tracks/db"
import { and, eq, gt, Model, minLength, OrmError, presence } from "./index"
import { closeTestDatabase, posts, useTestDatabase, widgets } from "./test-fixtures"

class Post extends Model<typeof posts> {
  static readonly table = posts

  static validations = {
    title: [presence(), minLength(3)],
    body: [presence()],
  }
}

// Mesma tabela, sem validações: isola a semântica de update()/save() no teste de undefined/null.
class LoosePost extends Model<typeof posts> {
  static readonly table = posts
}

// Tabela própria para os testes de concorrência e de constraint (nome é UNIQUE).
class Widget extends Model<typeof widgets> {
  static readonly table = widgets
}

async function rejectsWithOrmError(
  run: () => Promise<unknown>,
  pattern: RegExp,
): Promise<OrmError> {
  try {
    await run()
  } catch (error) {
    assert.ok(error instanceof OrmError, `expected OrmError, got: ${String(error)}`)
    assert.match(error.message, pattern)
    return error
  }
  assert.fail(`expected the call to reject with ${String(pattern)}`)
}

after(async () => {
  await closeTestDatabase()
})

// Precisa ser o primeiro teste do arquivo: roda antes de qualquer `useTestDatabase()`.
test("without a database, queries fail with a didactic OrmError", async () => {
  await rejectsWithOrmError(() => Post.all(), /no database configured/)
  await rejectsWithOrmError(() => Post.count(), /no database configured/)
})

test("create() inserts and hydrates defaults and timestamps", async () => {
  await useTestDatabase()

  const post = await Post.create({ title: "Hello", body: "World" })

  assert.equal(typeof post.id, "number")
  assert.equal(post.title, "Hello")
  assert.equal(post.body, "World")
  assert.equal(post.published, false) // default do schema veio no returning
  assert.ok(post.createdAt instanceof Date)
  assert.ok(post.updatedAt instanceof Date)
  assert.equal(await Post.count(), 1)
})

test("new() does not persist; save() returns false when invalid and true after fixing", async () => {
  await useTestDatabase()
  const before = await Post.count()

  const post = Post.new({ title: "ab", body: "" })
  assert.equal(post.id, undefined)
  assert.equal(await Post.count(), before)

  assert.equal(await post.save(), false)
  assert.equal(await Post.count(), before)
  assert.deepEqual(post.errors, {
    title: ["must be at least 3 characters"],
    body: ["can't be blank"],
  })

  post.update({ title: "abc", body: "ok" })
  assert.equal(await post.save(), true)
  assert.equal(typeof post.id, "number")
  assert.deepEqual(post.errors, {}) // limpo na validação que passou
  assert.equal(await Post.count(), before + 1)
})

test("create() raises OrmError with the validation messages", async () => {
  await useTestDatabase()

  const error = await rejectsWithOrmError(() => Post.create({ title: "" }), /validation failed/)
  assert.match(error.message, /title can't be blank/)
  assert.match(error.message, /body can't be blank/)
})

test("find() accepts numbers and numeric strings, null when missing", async () => {
  await useTestDatabase()

  const first = await Post.create({ title: "First post", body: "one" })
  const second = await Post.create({ title: "Second post", body: "two" })

  assert.equal((await Post.find(first.id))?.title, "First post")
  assert.equal((await Post.find(String(second.id)))?.title, "Second post")
  assert.equal(await Post.find(999_999), null)

  await rejectsWithOrmError(() => Post.find("abc"), /non-numeric id/)
  await rejectsWithOrmError(() => Post.find(""), /non-numeric id/)
  await rejectsWithOrmError(() => Post.find(1.5), /non-numeric id/)
})

test("findBy() filters by field equality and returns null without a match", async () => {
  await useTestDatabase()

  const post = await Post.create({ title: "Findable", body: "x" })

  assert.equal((await Post.findBy({ title: "Findable" }))?.id, post.id)
  assert.equal(await Post.findBy({ title: "Missing title" }), null)
  assert.equal((await Post.findBy({ published: false }))?.published, false)
})

test("all() orders by pk asc by default and accepts order/limit/offset", async () => {
  await useTestDatabase()
  const before = await Post.count()

  await Post.create({ title: "zz-order-a", body: "x" })
  await Post.create({ title: "zz-order-b", body: "x" })
  await Post.create({ title: "zz-order-c", body: "x" })

  const everything = await Post.all()
  assert.equal(everything.length, before + 3)
  assert.deepEqual(
    everything.slice(-3).map((post) => post.title),
    ["zz-order-a", "zz-order-b", "zz-order-c"],
  )

  const descending = await Post.all({ order: "-title" })
  assert.equal(descending[0]?.title, "zz-order-c")

  const page = await Post.all({ order: ["-title", "id"], limit: 1, offset: 1 })
  assert.deepEqual(
    page.map((post) => post.title),
    ["zz-order-b"],
  )

  const limited = await Post.all({ limit: 2 })
  assert.deepEqual(
    limited.map((post) => post.id),
    everything.slice(0, 2).map((post) => post.id),
  )
})

test("where() accepts equality objects and operator callbacks", async () => {
  await useTestDatabase()

  const first = await Post.create({ title: "Where A", body: "x" })
  const second = await Post.create({ title: "Where B", body: "x" })
  second.update({ published: true })
  await second.save()

  const unpublished = await Post.where({ published: false })
  assert.ok(unpublished.length > 0)
  assert.ok(unpublished.every((post) => post.published === false))
  assert.ok(unpublished.some((post) => post.id === first.id))

  const byCallback = await Post.where((t) => and(eq(t.published, true), gt(t.id, 1)))
  assert.ok(byCallback.every((post) => post.published === true && post.id > 1))
  assert.ok(byCallback.some((post) => post.id === second.id))

  const ordered = await Post.where((t) => eq(t.published, false), { order: "-id" })
  const ids = ordered.map((post) => post.id)
  assert.deepEqual(
    ids,
    [...ids].sort((left, right) => right - left),
  )
})

test("count() counts all rows or filtered ones", async () => {
  await useTestDatabase()

  assert.equal(await Post.count(), (await Post.all()).length)
  assert.equal(
    await Post.count({ published: true }),
    (await Post.where({ published: true })).length,
  )
  assert.equal(await Post.count((t) => gt(t.id, 1)), (await Post.where((t) => gt(t.id, 1))).length)
})

test("update() only changes memory; save() persists and refreshes updatedAt", async () => {
  await useTestDatabase()

  const post = await Post.create({ title: "Original", body: "body" })
  const createdAt = post.createdAt

  post.update({ title: "Changed" })
  assert.equal(post.title, "Changed")
  assert.equal((await Post.find(post.id))?.title, "Original") // ainda não persistiu

  // save() não reescreve createdAt e sempre seta updatedAt = agora.
  const future = new Date(createdAt.getTime() + 86_400_000)
  post.update({ createdAt: new Date(0), updatedAt: future })
  assert.equal(await post.save(), true)

  assert.equal(post.title, "Changed")
  assert.equal(post.createdAt.getTime(), createdAt.getTime())
  assert.ok(post.updatedAt.getTime() > 0)
  assert.ok(post.updatedAt.getTime() < future.getTime())

  const persisted = await Post.find(post.id)
  assert.equal(persisted?.title, "Changed")
  assert.equal(persisted?.createdAt.getTime(), createdAt.getTime())
  assert.ok(persisted !== null && persisted.updatedAt.getTime() > 0)
})

test("undefined keeps the current value, null clears it and unknown keys are ignored", async () => {
  await useTestDatabase()

  const post = await LoosePost.create({ title: "Keepers", body: "keep" })

  const patch: { title: string; body?: string; _method: string } = {
    title: "Keepers",
    _method: "put",
  }
  post.update(patch)
  assert.equal(post.body, "keep")
  assert.equal((post as unknown as { _method?: string })._method, undefined)

  post.update({ body: null })
  assert.equal(post.body, null)
  assert.equal(await post.save(), true)
  assert.equal((await LoosePost.find(post.id))?.body, null)
})

test("destroy() removes the row; a later save() inserts a new record", async () => {
  await useTestDatabase()

  const post = await Post.create({ title: "Doomed", body: "x" })
  const oldId = post.id
  const before = await Post.count()

  await post.destroy()
  assert.equal(await Post.find(oldId), null)
  assert.equal(await Post.count(), before - 1)

  assert.equal(await post.save(), true)
  assert.equal(typeof post.id, "number")
  assert.notEqual(post.id, oldId)
  assert.equal(await Post.count(), before)
  assert.equal((await Post.find(post.id))?.title, "Doomed")
})

test("controller-style flow: new(params) → save() → find(String(id))", async () => {
  await useTestDatabase()

  // Mesma forma do controller do e2e (`this.params` é Record<string, string | undefined>).
  const params: Record<string, string | undefined> = { title: "From params", body: undefined }
  const post = LoosePost.new(params)

  assert.equal(post.body, undefined) // undefined não sobrescreve/não grava
  assert.equal(await post.save(), true)
  assert.equal(typeof post.id, "number")

  const found = await LoosePost.find(String(post.id))
  assert.equal(found?.title, "From params")
})

test("concurrent save() calls on the same new instance insert a single row", async () => {
  await useTestDatabase()

  const widget = Widget.new({ name: "Concurrent" })
  const results = await Promise.all([widget.save(), widget.save(), widget.save()])

  assert.deepEqual(results, [true, true, true])
  assert.equal(await Widget.count(), 1) // nenhuma linha duplicada
  assert.equal((await Widget.where({ name: "Concurrent" })).length, 1)
  assert.equal(typeof widget.id, "number")

  // Depois de resolvida, a instância volta a persistir normalmente (UPDATE, não outro INSERT).
  widget.update({ name: "Concurrent v2" })
  assert.equal(await widget.save(), true)
  assert.equal(await Widget.count(), 1)
  assert.equal((await Widget.find(widget.id))?.name, "Concurrent v2")
})

test("duplicate primary key or unique value raises didactic OrmError preserving cause", async () => {
  await useTestDatabase()
  const before = await Widget.count()

  const widget = await Widget.create({ name: "Unique one" })
  assert.equal(await Widget.count(), before + 1)

  const duplicateId = await rejectsWithOrmError(
    () => Widget.create({ id: widget.id, name: "Unique two" }),
    /duplicate value for a unique column in 'widgets'/,
  )
  assert.match(duplicateId.message, /use a different value/)
  assert.ok(duplicateId.cause instanceof Error)
  // O Drizzle encapsula o erro do driver: a cadeia de `cause` preserva o motivo original.
  const driverCause = (duplicateId.cause as { cause?: unknown }).cause
  assert.match(String(driverCause), /UNIQUE constraint failed: widgets\.id/)

  await rejectsWithOrmError(
    () => Widget.create({ name: "Unique one" }),
    /duplicate value for a unique column/,
  )

  const other = await Widget.create({ name: "Unique three" })
  other.update({ name: "Unique one" })
  await rejectsWithOrmError(() => other.save(), /duplicate value for a unique column/)

  assert.equal(await Widget.count(), before + 2) // nenhuma tentativa duplicada entrou
})

test("destroy() without a primary key value raises OrmError", async () => {
  await useTestDatabase()

  const post = Post.new({ title: "Unsaved", body: "x" })
  await rejectsWithOrmError(() => post.destroy(), /without a primary key value/)
})

test("internal state (persisted/errors) does not leak into the instance", async () => {
  await useTestDatabase()

  const post = await Post.create({ title: "Serializable", body: "x" })
  assert.equal(post.isValid(), true)

  const parsed = JSON.parse(JSON.stringify(post)) as Record<string, unknown>
  assert.deepEqual(Object.keys(parsed).sort(), [
    "body",
    "createdAt",
    "id",
    "published",
    "title",
    "updatedAt",
  ])
})

test("unknown fields, invalid options and tables without pk raise didactic errors", async () => {
  await useTestDatabase()

  await rejectsWithOrmError(
    () => Post.where({ nope: 1 } as never),
    /unknown field in filter: 'nope'/,
  )
  await rejectsWithOrmError(() => Post.all({ order: "-nope" } as never), /unknown field in order/)
  await rejectsWithOrmError(() => Post.all("x" as never), /invalid options/)
  await rejectsWithOrmError(() => Post.all({ limit: -1 } as never), /invalid limit/)

  const labels = table("labels", { name: string().notNull() })
  class Label extends Model<typeof labels> {
    static readonly table = labels
  }
  await rejectsWithOrmError(() => Label.all(), /has no primary key/)

  const broken = table("broken", { id: id(), save: string() })
  class Broken extends Model<typeof broken> {
    static readonly table = broken
  }
  await rejectsWithOrmError(() => Broken.all(), /reserved column/)
})

test("a Model subclass without static table raises OrmError", async () => {
  class NoTable extends Model<typeof posts> {}
  const Untyped = NoTable as unknown as typeof Post
  await rejectsWithOrmError(() => Untyped.all(), /has no table defined/)
})
