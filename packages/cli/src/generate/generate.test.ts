import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { newProject } from "../commands/new"
import { CliError } from "../output"
import { generateResource, generateResourceWithDependencies } from "./index"
import {
  acquireGenerationLock,
  acquireGenerationLockWithWriter,
  commit,
  findAppRoot,
  GENERATION_LOCK_RELATIVE_PATH,
  releaseGenerationLock,
} from "./write"

const cliBin = fileURLToPath(new URL("../../bin/jot.js", import.meta.url))

async function makeApp(): Promise<{ base: string; appDir: string }> {
  const base = await mkdtemp(join(tmpdir(), "jot-generate-"))
  const appDir = join(base, "blog")
  await newProject("blog", { cwd: base, install: false })
  const appModules = join(appDir, "node_modules")
  const workspaceModules = fileURLToPath(new URL("../../../../node_modules", import.meta.url))
  await symlink(workspaceModules, appModules, process.platform === "win32" ? "junction" : "dir")
  return { base, appDir }
}

test("generateResource edits schema/routes and creates the files (no db)", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  try {
    const model = await generateResource("note", ["body:text"], {
      kind: "model",
      dbGenerate: false,
      root: appDir,
    })
    assert.deepEqual(model.created, ["app/models/note.ts"])
    assert.deepEqual(model.updated, ["db/schema.ts"])
    assert.equal(model.migration, null)
    assert.ok(existsSync(join(appDir, "app", "models", "note.ts")))
    assert.ok(!existsSync(join(appDir, "app", "controllers", "notes_controller.ts")))
    assert.doesNotMatch(await readFile(join(appDir, "config", "routes.ts"), "utf8"), /notes/)

    const scaffold = await generateResource(
      "post",
      ["title:string!", "body:text", "published:boolean"],
      { kind: "scaffold", dbGenerate: false, root: appDir },
    )
    assert.deepEqual(scaffold.created, [
      "app/models/post.ts",
      "app/controllers/posts_controller.ts",
      "app/views/posts/index.tsx",
      "app/views/posts/show.tsx",
      "app/views/posts/new.tsx",
      "app/views/posts/edit.tsx",
      "app/views/posts/_form.tsx",
    ])
    assert.deepEqual(scaffold.updated, ["db/schema.ts", "config/routes.ts"])
    assert.equal(scaffold.migration, null)

    const schema = await readFile(join(appDir, "db", "schema.ts"), "utf8")
    assert.match(schema, /export const notes = table\("notes", \{/)
    assert.match(schema, /export const posts = table\("posts", \{/)
    assert.match(schema, /title: string\(\)\.notNull\(\),/)
    assert.match(schema, /published: boolean\(\)\.default\(false\),/)
    assert.ok(!schema.includes("export {}"))

    const routes = await readFile(join(appDir, "config", "routes.ts"), "utf8")
    assert.match(routes, /r\.resource\("posts"\)/)
    const loadedRoutes = await runCli(["routes"], appDir)
    assert.equal(
      loadedRoutes.code,
      0,
      `jot routes failed for generated config:\n${loadedRoutes.stdout}\n${loadedRoutes.stderr}`,
    )
    assert.match(`${loadedRoutes.stdout}\n${loadedRoutes.stderr}`, /\/posts/)

    const controller = await readFile(
      join(appDir, "app", "controllers", "posts_controller.ts"),
      "utf8",
    )
    assert.match(controller, /export default class PostsController extends Controller \{/)
    assert.match(controller, /"Post created\."/)
    const form = await readFile(join(appDir, "app", "views", "posts", "_form.tsx"), "utf8")
    assert.match(form, /name="_method" value="put"/)

    // Rodar de novo não toca no disco e lista todos os arquivos existentes.
    await assert.rejects(
      generateResource("post", ["title:string!"], {
        kind: "scaffold",
        dbGenerate: false,
        root: appDir,
      }),
      (error: unknown) =>
        error instanceof CliError &&
        /File\(s\) already exist: app\/models\/post\.ts, app\/controllers\/posts_controller\.ts,/.test(
          error.message,
        ),
    )
    assert.equal(await readFile(join(appDir, "db", "schema.ts"), "utf8"), schema)

    assert.equal(findAppRoot(join(appDir, "app", "views", "posts")), appDir)
    assert.throws(
      () => findAppRoot(base),
      (error: unknown) => error instanceof CliError && /Not inside a JOT app/.test(error.message),
    )
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("generateResource with dbGenerate runs drizzle-kit with a deterministic name", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  try {
    const result = await generateResource("post", ["title:string!"], {
      kind: "scaffold",
      root: appDir,
    })
    assert.deepEqual(result.migration, ["db/migrate/0000_create_posts.sql"])
    const sql = await readFile(join(appDir, "db", "migrate", "0000_create_posts.sql"), "utf8")
    assert.match(sql, /CREATE TABLE `posts`/)
    assert.ok(existsSync(join(appDir, "db", "migrate", "meta", "_journal.json")))
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("CLI validation failures preserve every app file byte-for-byte", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  try {
    const before = await snapshotFiles(appDir)
    const result = await runCli(
      ["generate", "scaffold", "post", "save:string!", "--no-db-generate"],
      appDir,
    )
    assert.equal(result.code, 1)
    assert.match(
      result.stderr,
      /Field "save" is reserved because it conflicts with the @js_on_tracks\/orm Model API/,
    )
    assert.deepEqual(await snapshotFiles(appDir), before)
    assert.ok(!existsSync(join(appDir, "app", "models", "post.ts")))
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("reserved resource names and normalized column aliases fail before writing", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  try {
    const before = await snapshotFiles(appDir)
    for (const args of [
      ["generate", "scaffold", "class", "--no-db-generate"],
      ["generate", "scaffold", "await", "--no-db-generate"],
      ["generate", "model", "post", "createdAT:string", "--no-db-generate"],
      ["generate", "model", "post", "updatedAT:string", "--no-db-generate"],
      ["generate", "model", "post", "fooBar:string", "fooBAR:string", "--no-db-generate"],
    ]) {
      const result = await runCli(args, appDir)
      assert.equal(result.code, 1, `${args.join(" ")} unexpectedly succeeded`)
      assert.match(result.stderr, /reserved|both map to SQL column/)
      assert.deepEqual(await snapshotFiles(appDir), before)
    }
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("resource helper collisions are rejected without changing the app", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  try {
    const before = await snapshotFiles(appDir)
    const result = await runCli(["generate", "scaffold", "root", "--no-db-generate"], appDir)
    assert.equal(result.code, 1)
    assert.match(result.stderr, /route helper "root"/)
    assert.deepEqual(await snapshotFiles(appDir), before)
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("CLI route preflight fails closed for the audited bypasses without changing app bytes", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  const routeFile = join(appDir, "config", "routes.ts")
  try {
    const probes = [
      {
        source: [
          'import { routes } from "jot-framework"',
          'const existingResource = "posts";',
          "export default routes((r) => {",
          '  r.root("home#index")',
          "  r.resource(existingResource)",
          "})",
          "",
        ].join("\n"),
        error: /already has r\.resource\("posts"\)/,
      },
      {
        source: [
          'import { routes } from "jot-framework"',
          "export default routes((r) => {",
          '  r.root("home#index")',
          '  r.get("/custom", "pages#show", { "as": "post" })',
          "})",
          "",
        ].join("\n"),
        error: /route helper "post"/,
      },
      {
        source: [
          'import { routes } from "jot-framework"',
          'const method = "resource";',
          "export default routes((r) => {",
          '  r[method]("posts")',
          "})",
          "",
        ].join("\n"),
        error: /Cannot safely analyze config\/routes\.ts.*Simplify/,
      },
      {
        source: [
          'import { routes } from "jot-framework"',
          "export default routes((r) => {",
          "  const documentation = `$" + '{r.resource("posts")}`',
          "})",
          "",
        ].join("\n"),
        error: /Cannot safely analyze config\/routes\.ts.*Simplify/,
      },
      {
        source: [
          'import { routes } from "jot-framework"',
          'import { addRoutes } from "./route-helpers"',
          "export default routes((r) => {",
          "  addRoutes(r)",
          "})",
          "",
        ].join("\n"),
        error: /Cannot safely analyze config\/routes\.ts.*Simplify/,
      },
      {
        source: [
          'import { routes } from "jot-framework"',
          "let i = 0;",
          "export default routes((r) => {",
          '  i++ / (r.resource("posts") as unknown as number)',
          "})",
          "",
        ].join("\n"),
        error: /Cannot safely analyze config\/routes\.ts.*Simplify/,
      },
      {
        source: [
          'import { routes } from "jot-framework"',
          'const existingResource = "comments";',
          "export default routes((r) => {",
          "  function add(existingResource: string) { r.resource(existingResource) }",
          '  add("posts")',
          "})",
          "",
        ].join("\n"),
        error: /Cannot safely analyze config\/routes\.ts.*Simplify/,
      },
    ] as const

    for (const probe of probes) {
      await writeFile(routeFile, probe.source, "utf8")
      const before = await snapshotFiles(appDir)
      const result = await runCli(
        ["generate", "scaffold", "post", "title:string!", "--no-db-generate"],
        appDir,
      )
      assert.equal(result.code, 1, `probe unexpectedly succeeded:\n${probe.source}`)
      assert.match(result.stderr, probe.error)
      assert.deepEqual(await snapshotFiles(appDir), before)
      assert.ok(!existsSync(join(appDir, "app", "models", "post.ts")))
    }
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("CLI accepts literal and const-string resources with a named route parameter", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  const routeFile = join(appDir, "config", "routes.ts")
  try {
    await writeFile(
      routeFile,
      [
        'import { routes } from "jot-framework"',
        'const existingResource = "comments"',
        "export default routes((router) => {",
        '  router.root("home#index")',
        "  router.resource(existingResource)",
        "})",
        "",
      ].join("\n"),
      "utf8",
    )
    const generated = await runCli(
      ["generate", "scaffold", "post", "title:string!", "--no-db-generate"],
      appDir,
    )
    assert.equal(generated.code, 0, generated.stderr)
    const routes = await readFile(routeFile, "utf8")
    assert.match(routes, /router\.resource\(existingResource\)/)
    assert.match(routes, /router\.resource\("posts"\)/)

    const loaded = await runCli(["routes"], appDir)
    assert.equal(loaded.code, 0, `jot routes failed:\n${loaded.stdout}\n${loaded.stderr}`)
    assert.match(`${loaded.stdout}\n${loaded.stderr}`, /\/comments/)
    assert.match(`${loaded.stdout}\n${loaded.stderr}`, /\/posts/)
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("scaffold path preflight leaves a blocked app untouched and retry succeeds", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  const blocker = join(appDir, "app", "views", "posts")
  try {
    await writeFile(blocker, "blocking file", "utf8")
    const before = await snapshotFiles(appDir)
    const args = ["generate", "scaffold", "post", "title:string!", "--no-db-generate"]
    const failed = await runCli(args, appDir)
    assert.equal(failed.code, 1)
    assert.match(failed.stderr, /parent path "app\/views\/posts" exists but is not a directory/)
    assert.match(failed.stderr, /Move or remove the blocking file/)
    assert.deepEqual(await snapshotFiles(appDir), before)

    await rm(blocker)
    const retried = await runCli(args, appDir)
    assert.equal(retried.code, 0, `retry failed:\n${retried.stderr}`)
    assert.ok(existsSync(join(appDir, "app", "models", "post.ts")))
    assert.ok(existsSync(join(appDir, "app", "views", "posts", "index.tsx")))
    assert.match(
      await readFile(join(appDir, "config", "routes.ts"), "utf8"),
      /r\.resource\("posts"\)/,
    )
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("a failure after several staged installs rolls every generated byte back", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  try {
    const before = await snapshotFiles(appDir)
    await assert.rejects(
      generateResourceWithDependencies(
        "post",
        ["title:string!"],
        { kind: "scaffold", dbGenerate: false, root: appDir },
        {
          commit: (plan) =>
            commit(plan, {
              afterInstall: (_path, installCount) => {
                if (installCount === 9) throw new Error("injected failure after file 9")
              },
            }),
        },
      ),
      (error: unknown) =>
        error instanceof CliError &&
        error.message.includes("injected failure after file 9") &&
        error.message.includes("All generated changes were rolled back"),
    )
    assert.deepEqual(await snapshotFiles(appDir), before)
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("stale generation locks fail safely and remain untouched", { timeout: 60_000 }, async () => {
  const { base, appDir } = await makeApp()
  const lockPath = join(appDir, ...GENERATION_LOCK_RELATIVE_PATH.split("/"))
  try {
    await mkdir(join(appDir, ".jot"), { recursive: true })
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 2_147_483_647, token: "stale-test-lock", startedAt: 1 }),
      "utf8",
    )
    const before = await snapshotFiles(appDir)
    await assert.rejects(
      generateResource("post", [], { kind: "model", dbGenerate: false, root: appDir }),
      (error: unknown) =>
        error instanceof CliError &&
        error.message.includes("generator lock") &&
        error.message.includes("is stale") &&
        error.message.includes("remove the lock file"),
    )
    assert.deepEqual(await snapshotFiles(appDir), before)
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("lock acquisition rejects a .jot junction before writing outside the app", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  const outside = join(base, "outside")
  const stateDirectory = join(appDir, ".jot")
  try {
    await mkdir(outside)
    await rm(stateDirectory, { recursive: true, force: true })
    await symlink(outside, stateDirectory, process.platform === "win32" ? "junction" : "dir")
    await assert.rejects(
      acquireGenerationLock(appDir),
      (error: unknown) =>
        error instanceof CliError &&
        error.message.includes("must be a real directory") &&
        error.message.includes("symbolic link or junction"),
    )
    assert.deepEqual(await readdir(outside), [])
    assert.ok(!existsSync(join(outside, "generate.lock")))
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("a failed lock-record write keeps the uncertain partial lock for manual recovery", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  const lockPath = join(await realpath(appDir), ...GENERATION_LOCK_RELATIVE_PATH.split("/"))
  try {
    await assert.rejects(
      acquireGenerationLockWithWriter(appDir, async (handle, contents) => {
        await handle.writeFile(contents.slice(0, 12), "utf8")
        throw new Error("injected lock record write failure")
      }),
      (error: unknown) =>
        error instanceof CliError &&
        error.message.includes("A partial lock may remain") &&
        error.message.includes(lockPath) &&
        error.message.includes("remove that lock file"),
    )
    assert.equal((await readFile(lockPath, "utf8")).length, 12)
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("lock release preserves a record whose owner token no longer matches", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  try {
    const lock = await acquireGenerationLock(appDir)
    const replacement = { pid: lock.pid, token: "replacement-owner", startedAt: Date.now() }
    await writeFile(lock.path, JSON.stringify(replacement), "utf8")
    await releaseGenerationLock(lock)
    assert.deepEqual(JSON.parse(await readFile(lock.path, "utf8")), replacement)
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("two CLI generators queue on the app lock and retain both resources", {
  timeout: 60_000,
}, async () => {
  const { base, appDir } = await makeApp()
  let heldLock: Awaited<ReturnType<typeof acquireGenerationLock>> | undefined
  try {
    heldLock = await acquireGenerationLock(appDir)
    const alpha = startCli(["generate", "scaffold", "alpha", "--no-db-generate"], appDir)
    const beta = startCli(["generate", "scaffold", "beta", "--no-db-generate"], appDir)
    await Promise.all([
      alpha.waitFor("Waiting for another `jot generate`"),
      beta.waitFor("Waiting for another `jot generate`"),
    ])
    assert.ok(existsSync(heldLock.path), "queued generators must not remove an active foreign lock")
    const lockRecord = JSON.parse(await readFile(heldLock.path, "utf8")) as { token: string }
    assert.equal(lockRecord.token, heldLock.token)
    await releaseGenerationLock(heldLock)
    heldLock = undefined

    const [alphaResult, betaResult] = await Promise.all([alpha.result, beta.result])
    assert.equal(
      alphaResult.code,
      0,
      `stdout:\n${alphaResult.stdout}\nstderr:\n${alphaResult.stderr}`,
    )
    assert.equal(betaResult.code, 0, `stdout:\n${betaResult.stdout}\nstderr:\n${betaResult.stderr}`)

    const schema = await readFile(join(appDir, "db", "schema.ts"), "utf8")
    const routes = await readFile(join(appDir, "config", "routes.ts"), "utf8")
    assert.match(schema, /export const alphas = table\("alphas"/)
    assert.match(schema, /export const betas = table\("betas"/)
    assert.match(routes, /r\.resource\("alphas"\)/)
    assert.match(routes, /r\.resource\("betas"\)/)
    for (const file of [
      "app/models/alpha.ts",
      "app/models/beta.ts",
      "app/controllers/alphas_controller.ts",
      "app/controllers/betas_controller.ts",
      "app/views/alphas/index.tsx",
      "app/views/betas/index.tsx",
    ]) {
      assert.ok(existsSync(join(appDir, file)), `missing ${file}`)
    }
  } finally {
    if (heldLock !== undefined) await releaseGenerationLock(heldLock)
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("migration failures report partial files and recovery", { timeout: 60_000 }, async () => {
  const { base, appDir } = await makeApp()
  const partialMigration = "db/migrate/0000_create_posts.sql"
  try {
    await assert.rejects(
      generateResourceWithDependencies(
        "post",
        ["title:string!"],
        { kind: "model", root: appDir },
        {
          generateMigrations: async (root) => {
            await mkdir(join(root, "db", "migrate"), { recursive: true })
            await writeFile(join(root, partialMigration), "-- partial migration", "utf8")
            return {
              before: [],
              after: [partialMigration],
              created: [partialMigration],
              exitCode: 1,
            }
          },
        },
      ),
      (error: unknown) =>
        error instanceof CliError &&
        error.message.includes(partialMigration) &&
        error.message.includes("may be incomplete") &&
        error.message.includes("jot db:generate"),
    )
    assert.ok(existsSync(join(appDir, "app", "models", "post.ts")))
    assert.ok(existsSync(join(appDir, partialMigration)))
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

interface CliResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

function runCli(args: readonly string[], cwd: string): Promise<CliResult> {
  return startCli(args, cwd).result
}

function startCli(
  args: readonly string[],
  cwd: string,
): {
  readonly result: Promise<CliResult>
  readonly waitFor: (text: string) => Promise<void>
} {
  const child = spawn(process.execPath, [cliBin, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let stdout = ""
  let stderr = ""
  let closed = false
  let exitCode = 1
  const waiters = new Map<string, Array<{ resolve: () => void; reject: (error: Error) => void }>>()
  const notify = (chunk: string): void => {
    for (const [text, listeners] of waiters) {
      if (!stdout.includes(text)) continue
      waiters.delete(text)
      for (const listener of listeners) listener.resolve()
    }
    void chunk
  }
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk)
    notify(String(chunk))
  })
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk)
    notify(String(chunk))
  })
  const result = new Promise<CliResult>((resolveResult, rejectResult) => {
    child.once("error", rejectResult)
    child.once("close", (code) => {
      exitCode = code ?? 1
      closed = true
      for (const listeners of waiters.values()) {
        for (const listener of listeners) {
          listener.reject(
            new Error(`CLI exited before expected output. stdout: ${stdout} stderr: ${stderr}`),
          )
        }
      }
      waiters.clear()
      resolveResult({ code: exitCode, stdout, stderr })
    })
  })
  const waitFor = (text: string): Promise<void> => {
    if (stdout.includes(text) || stderr.includes(text)) return Promise.resolve()
    if (closed) return Promise.reject(new Error(`CLI exited ${exitCode} before output: ${text}`))
    return new Promise<void>((resolveWait, rejectWait) => {
      const listeners = waiters.get(text) ?? []
      listeners.push({ resolve: resolveWait, reject: rejectWait })
      waiters.set(text, listeners)
    })
  }
  return { result, waitFor }
}

async function snapshotFiles(root: string): Promise<readonly [string, Buffer][]> {
  const files: [string, Buffer][] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) await visit(fullPath)
      else if (entry.isFile()) {
        files.push([fullPath.slice(root.length + 1), await readFile(fullPath)])
      }
    }
  }
  await visit(root)
  return files.sort(([left], [right]) => left.localeCompare(right))
}
