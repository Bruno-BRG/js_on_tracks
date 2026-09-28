import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { type CreateJotOutput, runCreateJot } from "./main"

const here = dirname(fileURLToPath(import.meta.url))
const binPath = resolve(here, "..", "bin", "create-jot.js")

interface BinResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

function runBin(args: readonly string[]): Promise<BinResult> {
  return new Promise<BinResult>((resolveRun, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      // stdin por pipe = sem TTY, como no CI.
      stdio: ["pipe", "pipe", "pipe"],
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

function collector(): { output: string[]; stdout: CreateJotOutput } {
  const output: string[] = []
  return {
    output,
    stdout: {
      write(text: string) {
        output.push(text)
        return true
      },
    },
  }
}

test("create-jot --help prints the usage", async () => {
  const sink = collector()
  const code = await runCreateJot(["--help"], { stdout: sink.stdout })
  assert.equal(code, 0)
  assert.match(sink.output.join(""), /npm create jot@latest <name>/)
})

test("create-jot --version prints the version", async () => {
  const sink = collector()
  const code = await runCreateJot(["-v"], { stdout: sink.stdout })
  assert.equal(code, 0)
  assert.match(sink.output.join("").trim(), /^\d+\.\d+\.\d+/)
})

test("missing name without a TTY exits 1", { timeout: 30_000 }, async () => {
  const result = await runBin([])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Missing project name\. Usage: `npm create jot@latest <name>`/)
})

test("create-jot scaffolds an app with --no-install", { timeout: 60_000 }, async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "create-jot-"))
  try {
    t.mock.method(console, "log", () => {})
    const code = await runCreateJot(["my_app", "--no-install"], { cwd: tmp })
    assert.equal(code, 0)
    const appDir = join(tmp, "my_app")
    const pkg = JSON.parse(await readFile(join(appDir, "package.json"), "utf8")) as {
      name: string
    }
    assert.equal(pkg.name, "my_app")
    assert.ok(existsSync(join(appDir, "config", "routes.ts")))
    // `--no-install` de verdade: o npm não rodou.
    assert.ok(!existsSync(join(appDir, "node_modules")))
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("unknown option exits 1 with a didactic message", async () => {
  const result = await runBin(["--wat"])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Unknown option "--wat"/)
})
