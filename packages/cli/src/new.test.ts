import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import { test } from "node:test"
import { newProject } from "./commands/new"
import { CliError } from "./output"

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".css",
  ".html",
  ".sql",
  ".example",
])

test("newProject copies the template and replaces __APP_NAME__", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "jot-new-"))
  try {
    const result = await newProject("my_app", { cwd: tmp, install: false })
    assert.equal(result.name, "my_app")
    assert.equal(result.installed, false)
    assert.equal(result.dir, join(tmp, "my_app"))

    const pkg = JSON.parse(await readFile(join(result.dir, "package.json"), "utf8")) as {
      name: string
    }
    assert.equal(pkg.name, "my_app")
    assert.match(await readFile(join(result.dir, "config", "app.ts"), "utf8"), /name: "my_app"/)
    assert.deepEqual(await findLeftovers(result.dir), [])

    const env = await readFile(join(result.dir, ".env"), "utf8")
    assert.match(env, /^PORT=3000$/m)
    assert.match(env, /^JOT_SECRET=[0-9a-f]{64}$/m)
    assert.doesNotMatch(env, /dev-secret-change-me/)
    assert.ok(existsSync(join(result.dir, ".env.example")))
    assert.ok(existsSync(join(result.dir, "tsconfig.json")))
    assert.ok(existsSync(join(result.dir, "drizzle.config.ts")))
    assert.ok(existsSync(join(result.dir, "app", "controllers", "home_controller.ts")))
    assert.ok(existsSync(join(result.dir, "app", "views", "layouts", "application.tsx")))
    assert.ok(existsSync(join(result.dir, "db", "schema.ts")))
    assert.ok(existsSync(join(result.dir, "db", "migrate", ".gitkeep")))
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("newProject sanitizes the package.json name for npm", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "jot-new-"))
  try {
    const result = await newProject("My App", { cwd: tmp, install: false })
    assert.equal(result.name, "My App")
    const pkg = JSON.parse(await readFile(join(result.dir, "package.json"), "utf8")) as {
      name: string
    }
    assert.equal(pkg.name, "my-app")
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("newProject refuses a non-empty destination", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "jot-new-"))
  try {
    await mkdir(join(tmp, "taken"))
    await writeFile(join(tmp, "taken", "file.txt"), "x")
    await assert.rejects(
      newProject("taken", { cwd: tmp, install: false }),
      (error: unknown) =>
        error instanceof CliError && /already exists and is not empty/.test(error.message),
    )
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("newProject rejects an empty name", async () => {
  await assert.rejects(
    newProject("   ", { install: false }),
    (error: unknown) =>
      error instanceof CliError &&
      /Missing app name\. Usage: `jot new <name> \[--no-install\]`/.test(error.message),
  )
})

async function findLeftovers(dir: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await findLeftovers(full)))
    else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(full))) {
      if ((await readFile(full, "utf8")).includes("__APP_NAME__")) found.push(full)
    }
  }
  return found
}
