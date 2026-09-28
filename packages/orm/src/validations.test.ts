// Testes das validações (puros, sem banco): presence, minLength, maxLength, format e `isValid`.

import assert from "node:assert/strict"
import { test } from "node:test"
import { format, Model, maxLength, minLength, OrmError, presence, type Validation } from "./index"
import { posts } from "./test-fixtures"
import { runValidation } from "./validations"

function throwsOrmError(run: () => unknown, pattern: RegExp): OrmError {
  try {
    run()
  } catch (error) {
    assert.ok(error instanceof OrmError, `expected OrmError, got: ${String(error)}`)
    assert.match(error.message, pattern)
    return error
  }
  assert.fail(`expected an OrmError matching ${String(pattern)}`)
}

test("presence() rejects null, undefined, empty and blank strings", () => {
  const rule = presence()

  assert.equal(runValidation(rule, "title", null), "can't be blank")
  assert.equal(runValidation(rule, "title", undefined), "can't be blank")
  assert.equal(runValidation(rule, "title", ""), "can't be blank")
  assert.equal(runValidation(rule, "title", "   "), "can't be blank")
  assert.equal(runValidation(rule, "title", "ok"), undefined)
  assert.equal(runValidation(rule, "title", 0), undefined)
  assert.equal(runValidation(rule, "title", false), undefined)
  assert.equal(runValidation(presence("is required"), "title", ""), "is required")
})

test("minLength()/maxLength() check the borders and skip null/undefined", () => {
  const min = minLength(3)

  assert.equal(runValidation(min, "title", "ab"), "must be at least 3 characters")
  assert.equal(runValidation(min, "title", "abc"), undefined)
  assert.equal(runValidation(min, "title", "abcd"), undefined)
  assert.equal(runValidation(min, "title", 123), "must be a string")
  assert.equal(runValidation(min, "title", null), undefined)
  assert.equal(runValidation(min, "title", undefined), undefined)
  assert.equal(runValidation(minLength(3, "too short"), "title", "ab"), "too short")

  const max = maxLength(3)

  assert.equal(runValidation(max, "title", "abcd"), "must be at most 3 characters")
  assert.equal(runValidation(max, "title", "abc"), undefined)
  assert.equal(runValidation(max, "title", "ab"), undefined)
  assert.equal(runValidation(max, "title", 123), "must be a string")
  assert.equal(runValidation(max, "title", null), undefined)
  assert.equal(runValidation(maxLength(3, "too long"), "title", "abcd"), "too long")
})

test("format() matches the pattern and accepts a custom message", () => {
  const rule = format(/^a\d+$/)

  assert.equal(runValidation(rule, "code", "a1"), undefined)
  assert.equal(runValidation(rule, "code", "b1"), "has an invalid format")
  assert.equal(runValidation(rule, "code", null), undefined)
  assert.equal(runValidation(rule, "code", 1), "must be a string")
  assert.equal(runValidation(format(/^\d+$/, "digits only"), "code", "x"), "digits only")
})

test("format() is deterministic with global and sticky regexes", () => {
  // `/g` e `/y` mantêm `lastIndex`; o mesmo valor deve dar sempre o mesmo resultado.
  const global = format(/^[0-9]+$/g)
  assert.equal(runValidation(global, "code", "123"), undefined)
  assert.equal(runValidation(global, "code", "123"), undefined)
  assert.equal(runValidation(global, "code", "123"), undefined)
  assert.equal(runValidation(global, "code", "12a"), "has an invalid format")
  assert.equal(runValidation(global, "code", "12a"), "has an invalid format")
  assert.equal(runValidation(global, "code", "12a"), "has an invalid format")

  const sticky = format(/^[0-9]+$/y)
  assert.equal(runValidation(sticky, "code", "123"), undefined)
  assert.equal(runValidation(sticky, "code", "123"), undefined)
})

test("isValid() is deterministic with a global regex", () => {
  class RegexPost extends Model<typeof posts> {
    static readonly table = posts
    static validations = { title: [format(/^[a-z]+$/g)] }
  }

  const post = RegexPost.new({ title: "abc" })
  assert.equal(post.isValid(), true)
  assert.equal(post.isValid(), true)
  assert.equal(post.isValid(), true)
  assert.deepEqual(post.errors, {})
})

test("an unknown validation kind raises OrmError with the field name", () => {
  const unknown = { kind: "wat" } as unknown as Validation

  throwsOrmError(
    () => runValidation(unknown, "title", "x"),
    /unknown validation 'wat' on field 'title'/,
  )
})

class Post extends Model<typeof posts> {
  static readonly table = posts

  static validations = {
    title: [presence(), minLength(3), maxLength(10)],
    body: [presence()],
  }
}

test("isValid() accumulates messages per field and clears them on each call", () => {
  // `isValid` não toca no banco: roda sem `setDefaultDatabase`.
  const post = Post.new({ title: "", body: "" })

  assert.equal(post.isValid(), false)
  assert.deepEqual(post.errors, {
    title: ["can't be blank", "must be at least 3 characters"],
    body: ["can't be blank"],
  })

  const previous = post.errors
  post.update({ title: "ab", body: "ok" })
  assert.equal(post.isValid(), false)
  assert.deepEqual(post.errors, { title: ["must be at least 3 characters"] })
  assert.notEqual(post.errors, previous) // novo objeto a cada validação

  post.update({ title: "abc", body: "ok" })
  assert.equal(post.isValid(), true)
  assert.deepEqual(post.errors, {})
})

test("a validation for an unknown field raises OrmError with the available fields", () => {
  class BadPost extends Model<typeof posts> {
    static readonly table = posts
    static validations = { nope: [presence()] }
  }

  throwsOrmError(() => BadPost.new({}).isValid(), /validation for unknown field 'nope'/)
})

test("an invalid static validations shape raises OrmError", () => {
  class BrokenPost extends Model<typeof posts> {
    static readonly table = posts
    static validations = "nope"
  }

  throwsOrmError(() => BrokenPost.new({}).isValid(), /invalid `static validations`/)
})

test("a field whose rules are not an array raises OrmError", () => {
  class WrongRules extends Model<typeof posts> {
    static readonly table = posts
    static validations = { title: presence() }
  }

  throwsOrmError(() => WrongRules.new({}).isValid(), /invalid validations for field 'title'/)
})
