import { test } from "node:test"
import assert from "node:assert/strict"
import * as jot from "./index"

test("jot-framework reúne a API pública dos quatro pacotes", () => {
  const expected = [
    // core
    "defineApp",
    "defineDatabase",
    "routes",
    "Controller",
    "paths",
    "start",
    "registerControllers",
    "registerViews",
    "env",
    // db
    "table",
    "id",
    "string",
    "text",
    "boolean",
    "integer",
    "real",
    "json",
    "timestamps",
    "refs",
    "createDatabase",
    "getDefaultDatabase",
    "setDefaultDatabase",
    "sqliteDriver",
    // orm
    "Model",
    "OrmError",
    "presence",
    "minLength",
    "maxLength",
    "format",
    "eq",
    "and",
    "desc",
    // views
    "renderToString",
    "raw",
    "Fragment",
    "CLIENT_SCRIPT",
  ]
  for (const name of expected) {
    assert.ok(name in jot, `export ausente no jot-framework: ${name}`)
  }
})
