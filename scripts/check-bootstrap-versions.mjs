import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { appendFile, readFile } from "node:fs/promises"
import { EOL } from "node:os"

const bootstrapSha = process.env.BOOTSTRAP_SHA
assert.ok(
  bootstrapSha && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(bootstrapSha),
  "BOOTSTRAP_SHA must be the commit SHA being checked.",
)

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
assert.equal(head, bootstrapSha, `Checked out ${head}, but bootstrap SHA is ${bootstrapSha}.`)

const publicPackages = [
  ["@js_on_tracks/cli", "packages/cli/package.json"],
  ["@js_on_tracks/core", "packages/core/package.json"],
  ["create-jot", "packages/create-jot/package.json"],
  ["@js_on_tracks/db", "packages/db/package.json"],
  ["jot-framework", "packages/jot-framework/package.json"],
  ["@js_on_tracks/orm", "packages/orm/package.json"],
  ["@js_on_tracks/views", "packages/views/package.json"],
]

for (const [name, file] of publicPackages) {
  const manifest = JSON.parse(await readFile(file, "utf8"))
  const committed = JSON.parse(
    execFileSync("git", ["show", `${bootstrapSha}:${file}`], { encoding: "utf8" }),
  )
  assert.deepEqual(manifest, committed, `${file} differs from bootstrap SHA ${bootstrapSha}.`)
  assert.equal(
    manifest.name,
    name,
    `Bootstrap publishing requires the manifest name "${name}" in ${file}; found "${manifest.name}".`,
  )
  assert.equal(
    manifest.version,
    "1.0.0",
    `Bootstrap publishing requires ${name}@1.0.0; found ${name}@${manifest.version}. Merge the Changesets version pull request first.`,
  )
}

if (process.env.GITHUB_OUTPUT !== undefined) {
  await appendFile(process.env.GITHUB_OUTPUT, `sha=${bootstrapSha}${EOL}`, "utf8")
}

console.log(
  `Validated all seven initial package versions at SHA ${bootstrapSha}: ${publicPackages.map(([name]) => `${name}@1.0.0`).join(", ")}.`,
)
