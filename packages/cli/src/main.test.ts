import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const cliBin = resolve(here, "..", "bin", "jot.js")
const packageDir = resolve(here, "..")

interface BinResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

function runJot(args: readonly string[], cwd: string): Promise<BinResult> {
  return new Promise<BinResult>((resolveRun, reject) => {
    const child = spawn(process.execPath, [cliBin, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1" },
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

test("jot --version prints the CLI version", { timeout: 30_000 }, async () => {
  const result = await runJot(["--version"], packageDir)
  assert.equal(result.code, 0)
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/)
})

test("jot --help lists the commands", { timeout: 30_000 }, async () => {
  const result = await runJot(["--help"], packageDir)
  assert.equal(result.code, 0)
  assert.match(result.stdout, /jot server/)
  assert.match(result.stdout, /jot db:rollback \[n\]/)
  assert.match(result.stdout, /Run from your app root/)
})

test("jot without arguments prints the help and exits 1", { timeout: 30_000 }, async () => {
  const result = await runJot([], packageDir)
  assert.equal(result.code, 1)
  assert.match(result.stdout, /Usage:/)
})

test("unknown command exits 1 with a suggestion", { timeout: 30_000 }, async () => {
  const result = await runJot(["servr"], packageDir)
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Unknown command "servr"\. Did you mean `jot server`\?/)
  assert.match(result.stderr, /Run `jot --help` for the list of commands\./)

  // Chaves herdadas de Object.prototype não podem virar comandos.
  const inherited = await runJot(["constructor"], packageDir)
  assert.equal(inherited.code, 1)
  assert.match(inherited.stderr, /Unknown command "constructor"/)
})

test("unknown option exits 1 citing the command", { timeout: 30_000 }, async () => {
  const result = await runJot(["server", "--port", "4000"], packageDir)
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Unknown option "--port" for `jot server`/)
})

test("jot server outside an app root exits 1", { timeout: 30_000 }, async () => {
  const result = await runJot(["server"], packageDir)
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Not a JOT app root/)
  assert.match(result.stderr, /config\/app\.ts and config\/routes\.ts/)
})

test("jot db:rollback with a non-numeric count exits 1", { timeout: 30_000 }, async () => {
  const result = await runJot(["db:rollback", "abc"], packageDir)
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Invalid rollback count "abc"/)
  assert.match(result.stderr, /jot db:rollback \[n\]/)
})

test("jot console without a TTY exits 1", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "jot-main-"))
  try {
    await mkdir(join(root, "config"), { recursive: true })
    await writeFile(join(root, "config", "app.ts"), "")
    await writeFile(join(root, "config", "routes.ts"), "")
    await writeFile(join(root, "config", "database.ts"), "")
    const result = await runJot(["console"], root)
    assert.equal(result.code, 1)
    assert.match(result.stderr, /interactive terminal \(TTY\)/)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
