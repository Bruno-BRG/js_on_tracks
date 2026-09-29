import { execFileSync } from "node:child_process"

const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

export function getReleaseRange() {
  const baseSha = process.env.RELEASE_BASE_SHA
  const headSha = process.env.RELEASE_HEAD_SHA

  if (baseSha === undefined || !shaPattern.test(baseSha) || /^0+$/.test(baseSha)) {
    throw new Error(
      "RELEASE_BASE_SHA must identify the previous commit for this push; refusing to publish.",
    )
  }
  if (headSha === undefined || !shaPattern.test(headSha)) {
    throw new Error("RELEASE_HEAD_SHA must identify the pushed commit; refusing to publish.")
  }

  const checkedOutHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  if (checkedOutHead !== headSha) {
    throw new Error(`Checkout HEAD ${checkedOutHead} does not match push commit ${headSha}.`)
  }

  for (const sha of [baseSha, headSha]) {
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" })
    } catch {
      throw new Error(`Commit ${sha} is unavailable locally; refusing to publish.`)
    }
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseSha, headSha], { stdio: "ignore" })
  } catch {
    throw new Error(`Base commit ${baseSha} is not an ancestor of ${headSha}; refusing to publish.`)
  }

  return { baseSha, headSha }
}

export function readPackageManifest(sha, file) {
  try {
    return JSON.parse(execFileSync("git", ["show", `${sha}:${file}`], { encoding: "utf8" }))
  } catch {
    throw new Error(`Cannot read ${file} at commit ${sha}; refusing to publish.`)
  }
}
