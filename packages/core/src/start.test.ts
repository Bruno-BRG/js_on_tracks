import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { getDefaultDatabase } from "@jot/db"
import { defineApp } from "./app"
import { Controller } from "./controller"
import { __clearRegistries, registerControllers } from "./registry"
import { routes } from "./routes"
import { start } from "./server"

const root = mkdtempSync(join(tmpdir(), "jot-start-"))
const SECRET = "test-secret"

test("start sobe na porta 0, loga a linha de listening e responde/recebe 200", async (t) => {
  __clearRegistries()
  class HomeController extends Controller {
    index() {
      return this.json({ ok: true })
    }
  }
  registerControllers({ Home: HomeController })

  const log = t.mock.method(console, "log", () => {})
  const handle = await start({
    app: defineApp({ name: "test-app" }),
    routes: routes((r) => r.root("home#index")),
    root,
    port: 0,
    secret: SECRET,
  })
  try {
    assert.ok(handle.port > 0)
    assert.equal(handle.url, `http://localhost:${handle.port}`)

    const lines = log.mock.calls.map((call) => stripAnsi(String(call.arguments[0])))
    assert.ok(
      lines.includes(`JOT listening on http://localhost:${handle.port}`),
      `linhas: ${lines.join(" | ")}`,
    )
    assert.ok(lines.some((line) => line.startsWith("JOT test-app (")))

    const response = await fetch(`${handle.url}/`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  } finally {
    await handle.close()
  }
})

test("porta inválida é erro didático", async () => {
  const app = defineApp({ name: "test-app" })
  await assert.rejects(
    start({ app, routes: routes(() => {}), root, port: -1, secret: SECRET }),
    /Invalid port -1/,
  )
  await assert.rejects(
    start({ app, routes: routes(() => {}), root, port: 70000, secret: SECRET }),
    /Invalid port 70000/,
  )
})

test("PORT inválido no ambiente é erro didático", async () => {
  const previous = process.env.PORT
  process.env.PORT = "abc"
  try {
    await assert.rejects(
      start({
        app: defineApp({ name: "test-app" }),
        routes: routes(() => {}),
        root,
        secret: SECRET,
      }),
      /Invalid port "abc"/,
    )
  } finally {
    if (previous === undefined) delete process.env.PORT
    else process.env.PORT = previous
  }
})

test("start cria o Database e o registra como default", async (t) => {
  t.mock.method(console, "log", () => {})
  const dir = mkdtempSync(join(tmpdir(), "jot-start-db-"))
  const handle = await start({
    app: defineApp({ name: "db-app" }),
    routes: routes(() => {}),
    database: {
      url: join(dir, "dev.sqlite"),
      migrationsDir: join(dir, "migrate"),
      logQueries: false,
    },
    root: dir,
    port: 0,
    secret: SECRET,
  })
  try {
    const database = getDefaultDatabase()
    assert.equal(database.url, join(dir, "dev.sqlite"))
    assert.equal(database.migrationsDir, join(dir, "migrate"))
  } finally {
    await handle.close()
  }
})

test("porta ocupada (EADDRINUSE) é erro didático", async (t) => {
  t.mock.method(console, "log", () => {})
  const app = defineApp({ name: "test-app" })
  const first = await start({
    app,
    routes: routes(() => {}),
    root,
    port: 0,
    secret: SECRET,
  })
  try {
    await assert.rejects(
      start({ app, routes: routes(() => {}), root, port: first.port, secret: SECRET }),
      /already in use/,
    )
  } finally {
    await first.close()
  }
})

function stripAnsi(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: remove ANSI para comparar o texto puro
  return value.replace(/\u001b\[[0-9;]*m/g, "")
}
