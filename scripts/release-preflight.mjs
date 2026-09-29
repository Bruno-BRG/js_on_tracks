import { appendFile } from "node:fs/promises"
import { EOL } from "node:os"
import { getReleaseRange, readPackageManifest } from "./release-range.mjs"

const { baseSha, headSha } = getReleaseRange()
const packages = [
  ["@js_on_tracks/cli", "packages/cli/package.json"],
  ["@js_on_tracks/core", "packages/core/package.json"],
  ["create-jot", "packages/create-jot/package.json"],
  ["@js_on_tracks/db", "packages/db/package.json"],
  ["jot-framework", "packages/jot-framework/package.json"],
  ["@js_on_tracks/orm", "packages/orm/package.json"],
  ["@js_on_tracks/views", "packages/views/package.json"],
]

const changed = packages.filter(([, file]) => {
  const previous = readPackageManifest(baseSha, file)
  const current = readPackageManifest(headSha, file)
  return previous.version !== current.version
})

console.log(
  changed.length === 0
    ? "No public package versions changed."
    : `Changed public package versions: ${changed.map(([name]) => name).join(", ")}`,
)

if (process.env.GITHUB_OUTPUT !== undefined) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `changed=${String(changed.length > 0)}${EOL}base=${baseSha}${EOL}head=${headSha}${EOL}`,
    "utf8",
  )
}
