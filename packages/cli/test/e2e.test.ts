import assert from "node:assert/strict"
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { newProject } from "../src/index"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..")
const cliBin = resolve(here, "..", "bin", "jot.js")
const fixtureBlogDir = resolve(here, "fixtures", "blog")

interface BinResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

test("golden e2e: scaffold → migrate → server → CRUD", { timeout: 120_000 }, async () => {
  await mkdir(join(repoRoot, ".tmp-e2e"), { recursive: true })
  const base = await mkdtemp(join(repoRoot, ".tmp-e2e", "run-"))
  const appDir = join(base, "blog")
  const output: string[] = []
  let cli: ChildProcess | undefined
  try {
    await newProject("blog", { cwd: base, install: false })
    await cp(fixtureBlogDir, appDir, { recursive: true })

    const migrate = await runBin(["db:migrate"], appDir)
    assert.equal(
      migrate.code,
      0,
      `db:migrate failed.\nstdout:\n${migrate.stdout}\nstderr:\n${migrate.stderr}`,
    )
    assert.match(migrate.stdout, /applied 0001/)

    const port = await freePort()
    cli = spawn(process.execPath, [cliBin, "server"], {
      cwd: appDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      env: { ...process.env, PORT: String(port) },
    })
    cli.stdout?.on("data", (chunk) => output.push(String(chunk)))
    cli.stderr?.on("data", (chunk) => output.push(String(chunk)))

    const listening = await waitFor(
      () => /JOT listening on http:\/\/localhost:(\d+)/.exec(output.join("")),
      30_000,
      output,
    )
    assert.equal(Number(listening[1]), port)

    const home = await fetch(`http://localhost:${port}/`)
    assert.equal(home.status, 200)
    assert.match(await home.text(), /Hello from JOT/)

    const posts = await fetch(`http://localhost:${port}/posts`)
    assert.equal(posts.status, 200)
    assert.match(await posts.text(), /First post/)

    const created = await fetch(`http://localhost:${port}/posts`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "E2E post", body: "created in the golden test" }),
    })
    assert.equal(created.status, 303)
    const location = created.headers.get("location")
    assert.ok(location !== null, "POST /posts did not redirect")
    assert.match(location, /^\/posts\/\d+$/)

    const show = await fetch(`http://localhost:${port}${location}`)
    assert.equal(show.status, 200)
    assert.match(await show.text(), /E2E post/)

    const missing = await fetch(`http://localhost:${port}/posts/99999`)
    assert.equal(missing.status, 404)
    assert.match(await missing.text(), /404/)
  } finally {
    if (cli?.pid !== undefined) killTreeByPid(cli.pid)
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

function runBin(args: readonly string[], cwd: string): Promise<BinResult> {
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
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

async function waitFor<T>(
  find: () => T | undefined | null | false,
  timeoutMs: number,
  dump: readonly string[],
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = find()
    if (value) return value
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the golden e2e.\nOutput:\n${dump.join("")}`,
      )
    }
    await delay(250)
  }
}

/** Mata a árvore inteira (o `--watch` roda o app em um processo filho). */
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
      // Já morreu.
    }
  }
}
