import assert from "node:assert/strict"
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { newProject } from "../src/index"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..")
const cliBin = resolve(here, "..", "bin", "jot.js")

interface BinResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

test("golden e2e: generate scaffold → migrate → server → CRUD", { timeout: 120_000 }, async () => {
  await mkdir(join(repoRoot, ".tmp-e2e"), { recursive: true })
  const base = await mkdtemp(join(repoRoot, ".tmp-e2e", "run-"))
  const appDir = join(base, "blog")
  const output: string[] = []
  let cli: ChildProcess | undefined
  try {
    await newProject("blog", { cwd: base, install: false })

    // Roda da subpasta `app/` de propósito: prova o walk do findAppRoot.
    const generate = await runBin(
      [
        "generate",
        "scaffold",
        "post",
        "title:string!",
        "body:text",
        "published:boolean",
        "amount:integer!",
        "score:real",
      ],
      join(appDir, "app"),
    )
    assert.equal(
      generate.code,
      0,
      `generate failed.\nstdout:\n${generate.stdout}\nstderr:\n${generate.stderr}`,
    )
    assert.match(generate.stdout, /root: /)
    assert.match(generate.stdout, /Scaffold generated for Post \(table "posts"\)\./)
    assert.match(
      generate.stdout,
      /Created: app\/models\/post\.ts, app\/controllers\/posts_controller\.ts,/,
    )
    assert.match(generate.stdout, /app\/views\/posts\/\{index,show,new,edit,_form\}\.tsx/)
    assert.match(generate.stdout, /Updated: db\/schema\.ts, config\/routes\.ts/)
    assert.match(generate.stdout, /Migration: db\/migrate\/0000_create_posts\.sql/)

    const typecheck = await runExecutable(
      process.execPath,
      [
        resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"),
        "--noEmit",
        "-p",
        join(appDir, "tsconfig.json"),
      ],
      appDir,
    )
    assert.equal(
      typecheck.code,
      0,
      `generated app typecheck failed.\nstdout:\n${typecheck.stdout}\nstderr:\n${typecheck.stderr}`,
    )

    const migrate = await runBin(["db:migrate"], appDir)
    assert.equal(
      migrate.code,
      0,
      `db:migrate failed.\nstdout:\n${migrate.stdout}\nstderr:\n${migrate.stderr}`,
    )
    assert.match(migrate.stdout, /applied 0000_create_posts/)

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

    // Lista vazia (nenhum seed: o scaffold nasceu do zero).
    const emptyList = await fetch(`http://localhost:${port}/posts`)
    assert.equal(emptyList.status, 200)
    assert.match(await emptyList.text(), /No posts yet\./)

    const newPage = await fetch(`http://localhost:${port}/posts/new`)
    assert.equal(newPage.status, 200)
    assert.match(await newPage.text(), /<form/)

    const created = await postForm(`http://localhost:${port}/posts`, {
      title: "E2E post",
      body: "created in the golden test",
      published: "1",
      amount: "7",
      score: "2.5",
    })
    assert.equal(created.status, 303)
    const location = created.headers.get("location")
    assert.ok(location !== null, "POST /posts did not redirect")
    assert.match(location, /^\/posts\/1$/)

    const show = await fetch(`http://localhost:${port}${location}`)
    assert.equal(show.status, 200)
    const showHtml = await show.text()
    assert.match(showHtml, /E2E post/)
    assert.match(showHtml, /Yes/)
    assert.match(showHtml, /2\.5/)

    const editPage = await fetch(`http://localhost:${port}${location}/edit`)
    assert.equal(editPage.status, 200)
    assert.match(await editPage.text(), /E2E post/)

    const emptyIntegerUpdate = await postForm(`http://localhost:${port}${location}`, {
      _method: "put",
      title: "E2E post",
      body: "created in the golden test",
      amount: "",
    })
    assert.equal(emptyIntegerUpdate.status, 422, "empty required integer update must be rejected")

    const fractionalIntegerUpdate = await postForm(`http://localhost:${port}${location}`, {
      _method: "put",
      title: "E2E post",
      body: "created in the golden test",
      amount: "1.5",
    })
    assert.equal(fractionalIntegerUpdate.status, 422, "fractional integer update must be rejected")
    const fractionalIntegerHtml = await fractionalIntegerUpdate.text()
    assert.match(fractionalIntegerHtml, /Amount must be a whole number/)
    assert.match(fractionalIntegerHtml, /name="amount" value="1\.5"/)

    const invalidRealUpdate = await postForm(`http://localhost:${port}${location}`, {
      _method: "put",
      title: "E2E post",
      body: "created in the golden test",
      amount: "7",
      score: "not-a-number",
    })
    assert.equal(invalidRealUpdate.status, 422, "non-numeric real update must be rejected")
    const invalidRealHtml = await invalidRealUpdate.text()
    assert.match(invalidRealHtml, /Score must be a number/)
    assert.match(invalidRealHtml, /name="score" value="not-a-number"/)

    const stillUnchanged = await fetch(`http://localhost:${port}${location}`)
    assert.equal(stillUnchanged.status, 200)
    const unchangedHtml = await stillUnchanged.text()
    assert.match(unchangedHtml, /E2E post/)
    assert.match(unchangedHtml, /2\.5/)
    const unchangedDatabase = new DatabaseSync(join(appDir, "db", "dev.sqlite"))
    try {
      const row = unchangedDatabase
        .prepare("SELECT amount, score FROM posts WHERE id = ?")
        .get(1) as { amount: number; score: number | null } | undefined
      assert.equal(row?.amount, 7, "invalid integer updates must not persist")
      assert.equal(row?.score, 2.5, "invalid real updates must not persist")
    } finally {
      unchangedDatabase.close()
    }

    const updated = await postForm(`http://localhost:${port}${location}`, {
      _method: "put",
      title: "Edited post",
      body: "edited in the golden test",
      amount: "7",
      score: "2.5",
    })
    assert.equal(updated.status, 303)

    const afterUpdate = await fetch(`http://localhost:${port}${location}`)
    assert.equal(afterUpdate.status, 200)
    const afterUpdateHtml = await afterUpdate.text()
    assert.match(afterUpdateHtml, /Edited post/)
    assert.match(afterUpdateHtml, /edited in the golden test/)

    const omittedNumericUpdate = await postForm(`http://localhost:${port}${location}`, {
      _method: "put",
      title: "Updated without numbers",
      body: "numeric values should remain unchanged",
    })
    assert.equal(omittedNumericUpdate.status, 303)
    const omittedNumericDatabase = new DatabaseSync(join(appDir, "db", "dev.sqlite"))
    try {
      const row = omittedNumericDatabase
        .prepare("SELECT amount, score FROM posts WHERE id = ?")
        .get(1) as { amount: number; score: number | null } | undefined
      assert.equal(row?.amount, 7, "omitting an integer on update must preserve its previous value")
      assert.equal(row?.score, 2.5, "omitting a real on update must preserve its previous value")
    } finally {
      omittedNumericDatabase.close()
    }

    const clearNullableReal = await postForm(`http://localhost:${port}${location}`, {
      _method: "put",
      title: "Edited post",
      body: "edited in the golden test",
      amount: "7",
      score: "",
    })
    assert.equal(clearNullableReal.status, 303)
    const database = new DatabaseSync(join(appDir, "db", "dev.sqlite"))
    try {
      const row = database.prepare("SELECT score FROM posts WHERE id = ?").get(1) as
        | { score: number | null }
        | undefined
      assert.equal(row?.score, null, "empty nullable real input must persist SQL NULL")
    } finally {
      database.close()
    }
    const clearedEdit = await fetch(`http://localhost:${port}${location}/edit`)
    assert.equal(clearedEdit.status, 200)
    assert.match(await clearedEdit.text(), /name="score" value=""/)

    const deleted = await postForm(`http://localhost:${port}${location}`, { _method: "delete" })
    assert.equal(deleted.status, 303)
    assert.equal(deleted.headers.get("location"), "/posts")

    const missing = await fetch(`http://localhost:${port}${location}`)
    assert.equal(missing.status, 404)
    assert.match(await missing.text(), /404/)

    // Validação do presence(): 422 com a mensagem no form.
    const invalid = await postForm(`http://localhost:${port}/posts`, {
      title: "",
      body: "no title",
    })
    assert.equal(invalid.status, 422)
    assert.match(await invalid.text(), /can&#39;t be blank/)

    const missingRequiredInteger = await postForm(`http://localhost:${port}/posts`, {
      title: "Missing amount",
      amount: "",
    })
    assert.equal(missingRequiredInteger.status, 422)
    assert.match(await missingRequiredInteger.text(), /amount.*can&#39;t be blank/)

    const fractionalIntegerPost = await postForm(`http://localhost:${port}/posts`, {
      title: "Fractional amount",
      amount: "1.5",
    })
    assert.equal(fractionalIntegerPost.status, 422)
    const fractionalIntegerPostHtml = await fractionalIntegerPost.text()
    assert.match(fractionalIntegerPostHtml, /Amount must be a whole number/)
    assert.match(fractionalIntegerPostHtml, /name="amount" value="1\.5"/)
  } finally {
    if (cli?.pid !== undefined) killTreeByPid(cli.pid)
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

function postForm(url: string, fields: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  })
}

function runBin(args: readonly string[], cwd: string): Promise<BinResult> {
  return runExecutable(process.execPath, [cliBin, ...args], cwd)
}

function runExecutable(command: string, args: readonly string[], cwd: string): Promise<BinResult> {
  return new Promise<BinResult>((resolveRun, reject) => {
    const child = spawn(command, [...args], {
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
