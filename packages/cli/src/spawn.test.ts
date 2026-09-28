import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { CliError } from "./output"
import { killTree, NODE_FLAGS, resolvePackageBin, resolveTsx } from "./spawn"

test("NODE_FLAGS carries tsx and source maps", () => {
  assert.ok(NODE_FLAGS.includes("--import"))
  assert.ok(NODE_FLAGS.includes("tsx"))
  assert.ok(NODE_FLAGS.includes("--enable-source-maps"))
  assert.ok(NODE_FLAGS.includes("--disable-warning=ExperimentalWarning"))
  assert.ok(!(NODE_FLAGS as readonly string[]).includes("--watch"))
})

test("resolvePackageBin finds drizzle-kit without node_modules/.bin", () => {
  const bin = resolvePackageBin("drizzle-kit", "drizzle-kit")
  assert.ok(bin.endsWith("bin.cjs"), bin)
  assert.ok(existsSync(bin))
})

test("resolvePackageBin rejects an unknown bin name", () => {
  assert.throws(
    () => resolvePackageBin("drizzle-kit", "does-not-exist"),
    (error: unknown) =>
      error instanceof CliError && /does not expose bin "does-not-exist"/.test(error.message),
  )
})

test("resolveTsx throws outside a project with tsx installed", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "jot-spawn-"))
  try {
    assert.throws(
      () => resolveTsx(tmp),
      (error: unknown) => error instanceof CliError && /tsx is not installed/.test(error.message),
    )
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("killTree terminates the process and the close event arrives", {
  timeout: 20_000,
}, async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  })
  await new Promise<void>((resolveSpawn, reject) => {
    child.once("spawn", () => resolveSpawn())
    child.once("error", reject)
  })
  const closed = new Promise<number | null>((resolveClose) =>
    child.once("close", (code) => resolveClose(code)),
  )
  killTree(child)
  const winner = await Promise.race([
    closed,
    new Promise<"timeout">((resolveTimeout) => {
      setTimeout(() => resolveTimeout("timeout"), 10_000).unref()
    }),
  ])
  assert.notEqual(winner, "timeout", "killTree did not terminate the child process")
})
