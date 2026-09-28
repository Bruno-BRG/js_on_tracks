import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { EOL, tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { env, loadDotEnv } from "./env"

const NAME = "JOT_TEST_ENV_VALUE"

test("env: fallback, precedência do processo e erro didático", () => {
  delete process.env[NAME]
  try {
    assert.equal(env(NAME, "fallback"), "fallback")
    process.env[NAME] = "from-process"
    assert.equal(env(NAME, "fallback"), "from-process")
    delete process.env[NAME]
    assert.throws(
      () => env(NAME),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, new RegExp(`Environment variable "${NAME}" is not defined`))
        assert.match(error.message, /\.env/)
        return true
      },
    )
  } finally {
    delete process.env[NAME]
  }
})

test("loadDotEnv lê o .env do diretório e é idempotente", () => {
  const dir = mkdtempSync(join(tmpdir(), "jot-env-"))
  writeFileSync(join(dir, ".env"), `${NAME}=from-dotenv${EOL}`, "utf8")
  delete process.env[NAME]
  try {
    assert.equal(loadDotEnv(dir), true)
    assert.equal(env(NAME), "from-dotenv")
    assert.equal(loadDotEnv(dir), false) // já carregado nesta execução
  } finally {
    delete process.env[NAME]
  }
})

test("loadDotEnv em diretório sem .env devolve false", () => {
  const dir = mkdtempSync(join(tmpdir(), "jot-env-empty-"))
  assert.equal(loadDotEnv(dir), false)
})
