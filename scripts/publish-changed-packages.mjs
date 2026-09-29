import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { getReleaseRange, readPackageManifest } from "./release-range.mjs"

const npmCli = process.env.npm_execpath
assert.ok(
  npmCli,
  "Run this command with `npm run release:publish` so npm can provide its CLI path.",
)
const { baseSha, headSha } = getReleaseRange()

const packages = [
  ["@js_on_tracks/db", "packages/db/package.json"],
  ["@js_on_tracks/views", "packages/views/package.json"],
  ["@js_on_tracks/orm", "packages/orm/package.json"],
  ["@js_on_tracks/core", "packages/core/package.json"],
  ["@js_on_tracks/cli", "packages/cli/package.json"],
  ["jot-framework", "packages/jot-framework/package.json"],
  ["create-jot", "packages/create-jot/package.json"],
]

const changed = packages.flatMap(([name, file]) => {
  const previous = readPackageManifest(baseSha, file)
  const current = readPackageManifest(headSha, file)
  return previous.version !== current.version ? [[name, current.version]] : []
})

if (changed.length === 0) {
  console.log("No publishable package versions changed in this commit.")
  process.exit(0)
}

for (const [name, version] of changed) {
  const existing = spawnSync(process.execPath, [npmCli, "view", `${name}@${version}`, "version"], {
    encoding: "utf8",
  })
  if (existing.status === 0 && existing.stdout.trim() === version) {
    console.log(`${name}@${version} is already on npm; skipping the bootstrap version.`)
    continue
  }
  if (
    existing.status !== 0 &&
    !/E404|404 Not Found|No match found/i.test(`${existing.stdout}\n${existing.stderr}`)
  ) {
    throw new Error(
      `Could not check ${name}@${version} on npm.\n${existing.stdout}\n${existing.stderr}`,
    )
  }

  console.log(`Publishing ${name} from the approved npm-publish environment.`)
  const result = spawnSync(
    process.execPath,
    [npmCli, "publish", `--workspace=${name}`, "--access=public"],
    { stdio: "inherit" },
  )
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
