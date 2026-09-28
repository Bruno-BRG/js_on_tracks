import assert from "node:assert/strict"
import { test } from "node:test"
import { defineApp } from "./app"
import { defineDatabase } from "./database"

test("defineApp valida o nome e devolve a config normalizada", () => {
  assert.deepEqual(defineApp({ name: "blog" }), { name: "blog" })
  assert.equal(defineApp({ name: "  blog  " }).name, "blog")
  assert.throws(
    () => defineApp({ name: "   " }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /defineApp requires a non-empty "name"/)
      assert.match(error.message, /config\/app\.ts/)
      return true
    },
  )
  assert.throws(() => defineApp({} as { name: string }), /non-empty "name"/)
})

test("defineDatabase valida a url e devolve a config normalizada", () => {
  assert.deepEqual(defineDatabase({ url: "./db/dev.sqlite" }), { url: "./db/dev.sqlite" })
  assert.equal(defineDatabase({ url: "  ./db/dev.sqlite  " }).url, "./db/dev.sqlite")
  assert.throws(
    () => defineDatabase({ url: " " }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /defineDatabase requires a non-empty "url"/)
      assert.match(error.message, /config\/database\.ts/)
      return true
    },
  )
})
