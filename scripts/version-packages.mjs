import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { EOL } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const changesetsCli =
  process.env.CHANGESETS_CLI_BIN ?? join(repoRoot, "node_modules", "@changesets", "cli", "bin.js")
const changeset = spawnSync(process.execPath, [changesetsCli, "version"], {
  cwd: repoRoot,
  stdio: "inherit",
})

if (changeset.error !== undefined) throw changeset.error
if (changeset.status !== 0) process.exit(changeset.status ?? 1)

const manifestFields = [
  "name",
  "version",
  "license",
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "engines",
  "bin",
  "os",
  "cpu",
  "funding",
  "hasInstallScript",
  "workspaces",
]
const lockPath = join(repoRoot, "package-lock.json")
const lockText = await readFile(lockPath, "utf8")
const lock = JSON.parse(lockText)

assert.equal(lock.lockfileVersion, 3, "Expected npm lockfile version 3.")
await syncManifest(join(repoRoot, "package.json"), "")

for (const entry of await readdir(join(repoRoot, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifestPath = join(repoRoot, "packages", entry.name, "package.json")
  const lockKey = relative(repoRoot, join(repoRoot, "packages", entry.name))
    .split(sep)
    .join("/")
  await syncManifest(manifestPath, lockKey)
}

const newline = lockText.match(/\r\n|\n|\r/)?.[0] ?? EOL
const hasFinalNewline = /(?:\r\n|\n|\r)$/.test(lockText)
const serializedLock = JSON.stringify(lock, null, 2).replace(/\n/g, newline)
const syncedLock = hasFinalNewline ? `${serializedLock}${newline}` : serializedLock
if (syncedLock !== lockText) {
  await writeFile(lockPath, syncedLock, "utf8")
  console.log("Synchronized package-lock.json with the versioned workspace manifests.")
} else {
  console.log("package-lock.json already matches the versioned workspace manifests.")
}

async function syncManifest(manifestPath, lockKey) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const lockEntry = lock.packages[lockKey]
  assert.ok(lockEntry, `Lockfile entry is missing for ${lockKey || "the root package"}.`)

  for (const field of manifestFields) {
    if (manifest[field] === undefined) {
      delete lockEntry[field]
    } else {
      lockEntry[field] = manifest[field]
    }
  }
}
