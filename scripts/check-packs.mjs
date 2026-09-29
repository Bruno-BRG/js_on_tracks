import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const npmCli = process.env.npm_execpath
assert.ok(npmCli, "Run this check with `npm run check:packs` so npm can provide its CLI path.")

const packages = [
  {
    name: "@jot/cli",
    dir: "packages/cli",
    runtime: [
      "package/bin/jot.js",
      "package/templates/app/package.json",
      "package/templates/app/_gitignore",
    ],
  },
  { name: "@jot/core", dir: "packages/core", runtime: [] },
  { name: "create-jot", dir: "packages/create-jot", runtime: ["package/bin/create-jot.js"] },
  { name: "@jot/db", dir: "packages/db", runtime: [] },
  { name: "jot-framework", dir: "packages/jot-framework", runtime: [] },
  { name: "@jot/orm", dir: "packages/orm", runtime: [] },
  {
    name: "@jot/views",
    dir: "packages/views",
    runtime: ["package/src/jsx-runtime.ts", "package/src/jsx-dev-runtime.ts"],
  },
]

for (const entry of packages) {
  const manifest = JSON.parse(await readFile(join(repoRoot, entry.dir, "package.json"), "utf8"))
  assert.equal(manifest.name, entry.name)
  assert.notEqual(manifest.private, true, `${entry.name} must be publishable.`)

  const result = spawnSync(process.execPath, [npmCli, "pack", "--dry-run", "--json"], {
    cwd: join(repoRoot, entry.dir),
    encoding: "utf8",
  })
  assert.equal(
    result.status,
    0,
    `npm pack failed for ${entry.name}.\n${result.stdout}\n${result.stderr}`,
  )
  const report = JSON.parse(result.stdout)
  const files = new Set(report[0].files.map((file) => `package/${file.path}`))

  for (const required of [
    "package/package.json",
    "package/README.md",
    "package/README.pt-BR.md",
    "package/LICENSE",
    "package/src/index.ts",
    ...entry.runtime,
  ]) {
    assert.ok(files.has(required), `${entry.name} tarball is missing ${required}.`)
  }

  for (const file of files) {
    assert.ok(!/\.test\.tsx?$/.test(file), `${entry.name} includes a test file: ${file}`)
    assert.ok(!/^package\/test\//.test(file), `${entry.name} includes a test fixture: ${file}`)
    assert.ok(!/\/fixtures\//.test(file), `${entry.name} includes a fixture: ${file}`)
    assert.ok(
      !/\/tsconfig\.json$/.test(file) || file.startsWith("package/templates/app/"),
      `${entry.name} includes a development tsconfig: ${file}`,
    )
    assert.ok(!/test-fixtures\.ts$/.test(file), `${entry.name} includes test fixtures: ${file}`)
  }

  console.log(`${entry.name}: ${files.size} publish files checked`)
}
