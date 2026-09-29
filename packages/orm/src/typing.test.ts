// Asserções de tipo do `@js_on_tracks/orm` — verificadas por `npm run typecheck` (`tsx` não checa tipos).
// As chamadas ficam dentro de uma função que nunca roda no teste: o `@ts-expect-error` cobre
// o erro de compilação e o runtime não toca no banco.

import assert from "node:assert/strict"
import { test } from "node:test"
import {
  and,
  type Errors,
  eq,
  gt,
  Model,
  ne,
  not,
  or,
  presence,
  type RecordOf,
  type SQL,
} from "./index"
import { posts } from "./test-fixtures"

class Post extends Model<typeof posts> {
  static readonly table = posts

  static validations = {
    title: [presence()],
  }
}

// Sem `static table`: qualquer estático é um erro de tipo (e de runtime, coberto em orm.test.ts).
class NoTable extends Model<typeof posts> {}

// Nunca chamada: só o compilador lê este corpo.
async function _typeAssertions(): Promise<void> {
  // find() devolve `Post & Row<typeof posts> | null` (requisito do contrato: sem `declare`).
  const one = await Post.find(1)
  if (one) {
    const title: string = one.title
    const id: number = one.id
    const published: boolean | null = one.published
    const createdAt: Date = one.createdAt
    const asPost: Post = one
    void title
    void id
    void published
    void createdAt
    void asPost
  }

  const maybeTitle: string | undefined = (await Post.find(1))?.title
  void maybeTitle

  const all: Array<RecordOf<typeof Post>> = await Post.all()
  const firstTitle: string = all[0].title
  void firstTitle

  const ordered = await Post.all({ order: "-title", limit: 1, offset: 0 })
  const orderedMany = await Post.all({ order: ["-title", "id"] })
  void ordered
  void orderedMany

  const byTitle: Post | null = await Post.findBy({ title: "x" })
  void byTitle

  const byCallback: Array<Post> = await Post.where((t) => and(eq(t.published, true), gt(t.id, 10)))
  const byCallbackOrdered = await Post.where((t) => or(eq(t.title, "x"), not(ne(t.body, "y"))), {
    order: "-id",
  })
  void byCallback
  void byCallbackOrdered

  const counted: number = await Post.count()
  const countedWhere: number = await Post.count({ published: false })
  const countedCallback: number = await Post.count((t) => gt(t.id, 1))
  void counted
  void countedWhere
  void countedCallback

  const blank: RecordOf<typeof Post> = Post.new({})
  const created = Post.new({ title: "x", body: null, published: true })
  const createdTitle: string = created.title
  const createdId: number = created.id
  const saved: boolean = await created.save()
  const row = await Post.create({ title: "x" })
  const rowTitle: string = row.title
  void blank
  void createdTitle
  void createdId
  void saved
  void rowTitle

  // Record<string, string | undefined> (params de controller) é aceito.
  const params: Record<string, string | undefined> = { title: "x" }
  const fromParams = Post.new(params)
  const updated: Post = fromParams.update({ title: "y" })
  const errors: Errors = fromParams.errors
  const valid: boolean = fromParams.isValid()
  const removed: Promise<void> = fromParams.destroy()
  void updated
  void errors
  void valid
  void removed

  const raw: SQL<unknown> | undefined = and(eq(posts.published, true))
  const withRaw = await Post.where(() => raw)
  void withRaw

  const paginated: Array<Post> = await Post.where((t) => gt(t.id, 0), { order: "id" })
  void paginated

  // @ts-expect-error unknown field in `where`
  void Post.where({ nope: 1 })
  // @ts-expect-error wrong value type in `where`
  void Post.where({ published: "x" })
  // @ts-expect-error unknown field in `order`
  void Post.all({ order: "-nope" })
  // @ts-expect-error wrong value type for `title`
  void Post.new({ title: 123 })
  // @ts-expect-error static call on a class without `static table`
  void NoTable.all()
}

test("typing assertions are compiled by tsc (runtime smoke)", () => {
  assert.equal(typeof Model, "function")
  assert.equal(typeof Post.new, "function")
})
