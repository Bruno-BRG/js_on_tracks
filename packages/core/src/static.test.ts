import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { CLIENT_SCRIPT } from "@js_on_tracks/views"
import { routes } from "./routes"
import { createApp } from "./server"

const root = mkdtempSync(join(tmpdir(), "jot-static-"))
mkdirSync(join(root, "public", "sub"), { recursive: true })
writeFileSync(join(root, "public", "styles.css"), "body { color: red }", "utf8")
writeFileSync(join(root, "public", "sub", "index.html"), "<h1>Sub</h1>", "utf8")
writeFileSync(join(root, "secret.txt"), "top secret", "utf8")

const app = createApp({
  routes: routes(() => {}),
  root,
  secret: "test-secret-for-jot-session-tests-with-32-bytes",
})

test("serve public/styles.css com content-type e sem Set-Cookie", async () => {
  const response = await app.request("/styles.css")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "text/css; charset=utf-8")
  assert.equal(await response.text(), "body { color: red }")
  assert.equal(response.headers.getSetCookie().length, 0)
})

test("diretório serve index.html", async () => {
  const response = await app.request("/sub/")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
  assert.equal(await response.text(), "<h1>Sub</h1>")
})

test("/_jot/jot.js serve o CLIENT_SCRIPT", async () => {
  const response = await app.request("/_jot/jot.js")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "text/javascript; charset=utf-8")
  assert.equal(await response.text(), CLIENT_SCRIPT)
})

test("HEAD devolve headers sem corpo", async () => {
  const response = await app.request("/styles.css", { method: "HEAD" })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "text/css; charset=utf-8")
  assert.equal(await response.text(), "")
})

test("traversal para fora de public/ é 404", async () => {
  for (const path of ["/%2e%2e/secret.txt", "/%2e%2e%2fsecret.txt", "/..%2fsecret.txt"]) {
    const response = await app.request(path)
    assert.equal(response.status, 404, path)
    assert.doesNotMatch(await response.text(), /top secret/)
  }
})

test("arquivo ausente cai no 404 do app", async () => {
  const response = await app.request("/nope.css")
  assert.equal(response.status, 404)
  assert.match(await response.text(), /404/)
})

test("métodos que não GET/HEAD não são servidos pelo static", async () => {
  const response = await app.request("/styles.css", { method: "POST" })
  assert.equal(response.status, 404)
})
