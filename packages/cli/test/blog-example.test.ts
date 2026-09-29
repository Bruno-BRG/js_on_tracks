import assert from "node:assert/strict"
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { dirname, join, resolve, sep } from "node:path"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..")
const exampleRoot = join(repoRoot, "examples", "blog")
const cliBin = join(repoRoot, "packages", "cli", "bin", "jot.js")
const secret = "blog-example-smoke-secret-long-enough-for-tests"

interface BinResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

class CookieJar {
  private cookie: string | undefined

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.cookie !== undefined) headers.set("cookie", this.cookie)
    const response = await fetch(url, { ...init, headers })
    for (const setCookie of response.headers.getSetCookie()) {
      this.cookie = setCookie.split(";")[0]
    }
    return response
  }
}

test("blog example runs migrations and CSRF-protected CRUD without network access", {
  timeout: 90_000,
}, async () => {
  const tempRoot = join(repoRoot, ".tmp-e2e")
  await mkdir(tempRoot, { recursive: true })
  const tempDir = await mkdtemp(join(tempRoot, "blog-example-"))
  const appDir = join(tempDir, "blog")
  const output: string[] = []
  let server: ChildProcess | undefined

  try {
    await cp(exampleRoot, appDir, {
      recursive: true,
      filter: (source) =>
        !source.split(sep).includes("node_modules") &&
        !source.split(sep).includes(".jot") &&
        !source.endsWith(`${sep}.env`),
    })

    const migration = await runCli(["db:migrate"], appDir)
    assert.equal(
      migration.code,
      0,
      `db:migrate failed.\nstdout:\n${migration.stdout}\nstderr:\n${migration.stderr}`,
    )
    assert.match(migration.stdout, /applied 0000_create_posts/)

    const port = await freePort()
    server = spawn(process.execPath, [cliBin, "server"], {
      cwd: appDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        DATABASE_URL: join(appDir, "db", "dev.sqlite"),
        JOT_SECRET: secret,
        PORT: String(port),
      },
    })
    server.stdout?.on("data", (chunk) => output.push(String(chunk)))
    server.stderr?.on("data", (chunk) => output.push(String(chunk)))

    await waitFor(
      () => /JOT listening on http:\/\/localhost:(\d+)/.exec(output.join("")),
      30_000,
      output,
    )

    const baseUrl = `http://localhost:${port}`
    const jar = new CookieJar()
    const home = await jar.request(`${baseUrl}/`)
    assert.equal(home.status, 200)
    assert.match(await home.text(), /Hello from JOT/)

    const emptyList = await jar.request(`${baseUrl}/posts`)
    assert.equal(emptyList.status, 200)
    assert.match(await emptyList.text(), /No posts yet\./)

    const newPage = await jar.request(`${baseUrl}/posts/new`)
    assert.equal(newPage.status, 200)
    const newHtml = await newPage.text()
    const token = /name="_csrf" value="([A-Za-z0-9_-]{43})"/.exec(newHtml)?.[1]
    assert.ok(token, "the generated form should contain a CSRF token")

    const rejected = await jar.request(`${baseUrl}/posts`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "Rejected post", body: "No token" }),
    })
    assert.equal(rejected.status, 403)

    const created = await postForm(jar, `${baseUrl}/posts`, token, {
      title: "Example post",
      body: "Created by the example smoke test.",
    })
    assert.equal(created.status, 303)
    const location = created.headers.get("location")
    assert.equal(location, "/posts/1")

    const show = await jar.request(`${baseUrl}${location}`)
    assert.equal(show.status, 200)
    assert.match(await show.text(), /Example post/)

    const updated = await postForm(jar, `${baseUrl}${location}`, token, {
      _method: "put",
      title: "Updated example post",
      body: "Updated by the smoke test.",
    })
    assert.equal(updated.status, 303)
    const updatedPage = await jar.request(`${baseUrl}${location}`)
    assert.match(await updatedPage.text(), /Updated example post/)

    const deleted = await postForm(jar, `${baseUrl}${location}`, token, { _method: "delete" })
    assert.equal(deleted.status, 303)
    assert.equal(deleted.headers.get("location"), "/posts")

    const missing = await jar.request(`${baseUrl}${location}`)
    assert.equal(missing.status, 404)
  } finally {
    if (server?.pid !== undefined) killTreeByPid(server.pid)
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

function postForm(
  jar: CookieJar,
  url: string,
  token: string,
  fields: Record<string, string>,
): Promise<Response> {
  return jar.request(url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, _csrf: token }),
  })
}

function runCli(args: readonly string[], cwd: string): Promise<BinResult> {
  return new Promise<BinResult>((resolveRun, reject) => {
    const child = spawn(process.execPath, [cliBin, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.once("error", reject)
    child.once("close", (code) => resolveRun({ code: code ?? 1, stdout, stderr }))
  })
}

function freePort(): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const socket = createServer()
    socket.once("error", reject)
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      socket.close(() => resolvePort(port))
    })
  })
}

async function waitFor<T>(
  find: () => T | undefined | null | false,
  timeoutMs: number,
  output: readonly string[],
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = find()
    if (value) return value
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the example server.\n${output.join("")}`,
      )
    }
    await delay(250)
  }
}

function killTreeByPid(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" })
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // The process has already exited.
    }
  }
}
