import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"

const npmCli = process.env.npm_execpath
assert.ok(
  npmCli,
  "Run this check with `npm run check:npm-version` so npm can provide its CLI path.",
)

const version = execFileSync(process.execPath, [npmCli, "--version"], { encoding: "utf8" }).trim()
const [major, minor, patch] = version.split(".").map(Number)
assert.ok(
  major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1))),
  `npm ${version} found; npm CLI 11.5.1 or newer is required for Trusted Publishing.`,
)
console.log(`npm CLI ${version} supports Trusted Publishing.`)
