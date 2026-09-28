import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { newProject } from "./index"

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
  assert.match(
    result.stdout,
    /jot generate scaffold <Name> \[field:type\[!\] \.\.\.\] \[--no-db-generate\]/,
  )
  assert.match(result.stdout, /jot g model\|scaffold/)
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

test("jot new . and .. explain that an app name is required", { timeout: 30_000 }, async () => {
  for (const name of [".", ".."] as const) {
    const result = await runJot(["new", name, "--no-install"], packageDir)
    assert.equal(result.code, 1)
    assert.match(result.stderr, /Invalid app name/)
    assert.match(result.stderr, /creates a new folder/)
    assert.match(result.stderr, /jot new blog/)
  }
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

test("jot generate validates generator, name and app root", { timeout: 60_000 }, async () => {
  const missingGenerator = await runJot(["generate"], packageDir)
  assert.equal(missingGenerator.code, 1)
  assert.match(missingGenerator.stderr, /Missing generator\. Usage:/)

  const alias = await runJot(["g"], packageDir)
  assert.equal(alias.code, 1)
  assert.match(alias.stderr, /Missing generator/) // `jot g` é alias de `jot generate`

  const unknownKind = await runJot(["generate", "wat", "post"], packageDir)
  assert.equal(unknownKind.code, 1)
  assert.match(unknownKind.stderr, /Unknown generator "wat"/)

  const missingName = await runJot(["generate", "scaffold"], packageDir)
  assert.equal(missingName.code, 1)
  assert.match(
    missingName.stderr,
    /Missing name\. Usage: `jot generate scaffold Post title:string! body:text`/,
  )

  const unknownFlag = await runJot(["generate", "scaffold", "post", "--foo"], packageDir)
  assert.equal(unknownFlag.code, 1)
  assert.match(
    unknownFlag.stderr,
    /Unknown option "--foo" for `jot generate <model\|scaffold> <Name> \[field:type\[!\] \.\.\.\]`/,
  )

  const outsideApp = await runJot(["generate", "scaffold", "post", "title:string!"], packageDir)
  assert.equal(outsideApp.code, 1)
  assert.match(outsideApp.stderr, /Not inside a JOT app/)
  assert.match(outsideApp.stderr, /jot new myapp/)
})

test("jot g model accepts --no-db-generate and runs from a subfolder", {
  timeout: 60_000,
}, async () => {
  const base = await mkdtemp(join(tmpdir(), "jot-generate-cli-"))
  const appDir = join(base, "notes")
  try {
    await newProject("notes", { cwd: base, install: false })
    const result = await runJot(
      ["g", "model", "note", "title:string!", "--no-db-generate"],
      join(appDir, "app"),
    )

    assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    assert.match(result.stdout, /root: /)
    assert.match(result.stdout, /Model generated for Note \(table "notes"\)\./)
    assert.match(result.stdout, /jot db:generate/)
    assert.ok(existsSync(join(appDir, "app", "models", "note.ts")))
    assert.ok(
      !existsSync(join(appDir, "db", "migrate", "0000_create_notes.sql")),
      "--no-db-generate must not create a migration",
    )
    assert.match(
      await readFile(join(appDir, "db", "schema.ts"), "utf8"),
      /title: string\(\)\.notNull\(\)/,
    )
    assert.doesNotMatch(await readFile(join(appDir, "config", "routes.ts"), "utf8"), /notes/)
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
