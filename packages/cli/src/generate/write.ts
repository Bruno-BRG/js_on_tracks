import { randomUUID } from "node:crypto"
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { type FileHandle, lstat, mkdir, open, readFile, realpath, rm, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { CliError, log } from "../output"

export const GENERATION_LOCK_RELATIVE_PATH = ".jot/generate.lock"

const LOCK_WAIT_LIMIT_MS = 120_000
const LOCK_POLL_INTERVAL_MS = 40
const LOCK_INITIALIZATION_GRACE_MS = 1_000

export interface GenerationLock {
  readonly path: string
  readonly token: string
  readonly pid: number
}

interface LockRecord {
  readonly pid: number
  readonly token: string
  readonly startedAt: number
}

/** EOL do arquivo (preservado nas edições; arquivos novos usam LF). */
export function detectEol(source: string): "\r\n" | "\n" {
  return source.includes("\r\n") ? "\r\n" : "\n"
}

/** Lê um arquivo obrigatório do app ou lança o erro didático do `hint`. */
export function readRequired(root: string, relativePath: string, hint: string): string {
  const file = join(root, relativePath)
  if (!existsSync(file)) throw new CliError(hint)
  return readFileSync(file, "utf8")
}

/**
 * Sobe do `cwd` até achar `config/app.ts` (máx. 20 níveis) — permite rodar o
 * generator de uma subpasta do app.
 */
export function findAppRoot(cwd: string): string {
  const start = resolve(cwd)
  let dir = start
  for (let level = 0; level < 20; level += 1) {
    if (existsSync(join(dir, "config", "app.ts"))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new CliError(
    `Not inside a JOT app: no config/app.ts found in ${start} or any parent folder. ` +
      "Run this from your app (or create one with `jot new myapp`).",
  )
}

/** Obtém exclusão mútua por app; lock alheio ativo nunca é removido automaticamente. */
export async function acquireGenerationLock(root: string): Promise<GenerationLock> {
  return acquireGenerationLockWithWriter(root, (handle, contents) =>
    handle.writeFile(contents, "utf8"),
  )
}

/** Internal fault-injection seam; not re-exported by the @js_on_tracks/cli package entry point. */
export async function acquireGenerationLockWithWriter(
  root: string,
  writeRecord: (handle: FileHandle, contents: string) => Promise<void>,
): Promise<GenerationLock> {
  let appRoot: string
  try {
    appRoot = await realpath(resolve(root))
  } catch {
    throw new CliError(
      `App root ${resolve(root)} does not exist. Run \`jot generate\` from an existing JOT app.`,
    )
  }
  const lockPath = join(appRoot, ...GENERATION_LOCK_RELATIVE_PATH.split("/"))
  await ensureRealStateDirectory(appRoot)
  const token = randomUUID()
  const startedWaiting = Date.now()
  let waitingMessagePrinted = false

  for (;;) {
    // Re-check immediately before opening the lock so a pre-existing junction/symlink
    // is rejected before any write can cross the app boundary.
    await ensureRealStateDirectory(appRoot)
    let handle: FileHandle | undefined
    try {
      handle = await open(lockPath, "wx")
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw new CliError(
          `Could not create the generator lock at ${lockPath}. Check directory permissions and try again.`,
        )
      }
    }
    if (handle !== undefined) {
      const record: LockRecord = { pid: process.pid, token, startedAt: Date.now() }
      try {
        await writeRecord(handle, JSON.stringify(record))
      } catch {
        await handle.close()
        throw new CliError(
          `Could not write generator lock ${lockPath}. A partial lock may remain; verify that no ` +
            `generator is running, remove that lock file, and re-run \`jot generate\`.`,
        )
      }
      await handle.close()
      return { path: lockPath, token, pid: process.pid }
    }

    const lock = await readLock(lockPath)
    if (lock === null) {
      const age = await lockAge(lockPath)
      if (age !== undefined && age >= LOCK_INITIALIZATION_GRACE_MS) {
        throw staleLockError(lockPath, "the owner information is missing or unreadable")
      }
    } else if (!isProcessAlive(lock.pid)) {
      throw staleLockError(lockPath, `its owner process ${lock.pid} is no longer running`)
    }

    if (Date.now() - startedWaiting >= LOCK_WAIT_LIMIT_MS) {
      const owner = lock === null ? "an unknown process" : `process ${lock.pid}`
      throw new CliError(
        `Timed out waiting for ${owner} to finish generating in ${appRoot}. ` +
          `PID checks cannot distinguish a reused process ID. If it has stalled, verify that no ` +
          `generator is running before removing ${lockPath}; never remove a lock with uncertain ownership.`,
      )
    }
    if (!waitingMessagePrinted) {
      log(`Waiting for another \`jot generate\` to finish in ${appRoot}.`)
      waitingMessagePrinted = true
    }
    await delay(LOCK_POLL_INTERVAL_MS)
  }
}

async function ensureRealStateDirectory(appRoot: string): Promise<void> {
  const directory = join(appRoot, ".jot")
  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(directory)
  } catch (error) {
    if (!isMissing(error)) {
      throw new CliError(
        `Could not inspect generator state directory ${directory}. Check filesystem permissions and try again.`,
      )
    }
    try {
      await mkdir(directory)
    } catch (createError) {
      if (errorCode(createError) !== "EEXIST") {
        throw new CliError(
          `Could not create ${directory} for the generator lock. Check directory permissions and try again.`,
        )
      }
    }
    try {
      info = await lstat(directory)
    } catch {
      throw new CliError(
        `Could not inspect generator state directory ${directory}. Restore it and re-run \`jot generate\`.`,
      )
    }
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new CliError(
      `Generator state directory ${directory} must be a real directory, not a symbolic link or junction. ` +
        "Replace it with a normal .jot directory, then re-run `jot generate`.",
    )
  }
}

/** Libera somente o lock que esta chamada criou (por token, não apenas por PID). */
export async function releaseGenerationLock(lock: GenerationLock): Promise<void> {
  const current = await readLock(lock.path)
  if (current?.pid !== lock.pid || current.token !== lock.token) return
  // Portable filesystems do not offer conditional unlink by file identity. A manual replacement
  // between this token check and rm is a narrow TOCTOU limitation; stale/unknown locks are never
  // removed automatically, and callers must not manually replace a lock while a generator runs.
  try {
    await rm(lock.path)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}

async function readLock(path: string): Promise<LockRecord | null> {
  let contents: string
  try {
    contents = await readFile(path, "utf8")
  } catch (error) {
    if (isMissing(error)) return null
    throw new CliError(`Could not read generator lock ${path}. Check permissions and try again.`)
  }
  try {
    const value: unknown = JSON.parse(contents)
    if (
      typeof value !== "object" ||
      value === null ||
      !Number.isInteger((value as LockRecord).pid) ||
      (value as LockRecord).pid <= 0 ||
      typeof (value as LockRecord).token !== "string" ||
      typeof (value as LockRecord).startedAt !== "number"
    ) {
      return null
    }
    return value as LockRecord
  } catch {
    return null
  }
}

async function lockAge(path: string): Promise<number | undefined> {
  try {
    return Date.now() - (await stat(path)).mtimeMs
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

/** A reused PID is conservatively treated as alive; recovery requires user verification. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) === "EPERM"
  }
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT"
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function staleLockError(path: string, reason: string): CliError {
  return new CliError(
    `The generator lock at ${path} is stale: ${reason}. Verify that no generator is running, ` +
      `then remove the lock file and re-run \`jot generate\`.`,
  )
}

export interface FileWrite {
  /** Caminho relativo ao root do app (posix). */
  readonly path: string
  readonly content: string
}

export interface WritePlan {
  readonly root: string
  readonly creates: readonly FileWrite[]
  readonly updates: readonly FileWrite[]
}

export interface CommitOptions {
  /** Test seam: called after each installed file; production callers should omit it. */
  readonly afterInstall?: (relativePath: string, installCount: number) => void
}

interface AppliedWrite {
  readonly target: string
  readonly backup: string
  installed: boolean
  backedUp: boolean
}

/**
 * Preflights every target, stages content under the app root, and rolls back installed files
 * if a later filesystem operation fails. The staging area shares a volume with targets so
 * hard-link installation and backup renames are atomic per file.
 */
export function commit(plan: WritePlan, options: CommitOptions = {}): void {
  preflightWritePlan(plan)

  const transactionId = randomUUID()
  const stagingRoot = join(plan.root, ".jot", `generate-stage-${transactionId}`)
  const files = [...plan.creates, ...plan.updates]
  const stagedFiles = files.map((_, index) => join(stagingRoot, "files", String(index)))
  const applied: AppliedWrite[] = []
  const createdDirectories: string[] = []
  let safeToRemoveStaging = false
  let committed = false

  try {
    mkdirSync(stagingRoot)
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const staged = stagedFiles[index]
      if (file === undefined || staged === undefined) continue
      mkdirSync(dirname(staged), { recursive: true })
      writeFileSync(staged, file.content, { encoding: "utf8", flag: "wx" })
    }

    const backupsRoot = join(stagingRoot, "backups")
    mkdirSync(backupsRoot)
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const staged = stagedFiles[index]
      if (file === undefined || staged === undefined) continue
      const target = join(plan.root, file.path)
      ensureParentDirectories(plan.root, dirname(file.path), createdDirectories)

      const isUpdate = index >= plan.creates.length
      const backup = join(backupsRoot, String(index))
      const operation: AppliedWrite = {
        target,
        backup,
        installed: false,
        backedUp: false,
      }
      applied.push(operation)

      if (isUpdate) {
        renameSync(target, backup)
        operation.backedUp = true
      }
      // linkSync is exclusive: an external file created after preflight is never overwritten.
      linkSync(staged, target)
      operation.installed = true
      unlinkSync(staged)
      options.afterInstall?.(file.path, index + 1)
    }
    safeToRemoveStaging = true
    committed = true
  } catch (error) {
    const rollbackErrors = rollbackWrites(applied, createdDirectories)
    safeToRemoveStaging = rollbackErrors.length === 0
    const detail = error instanceof Error ? error.message : String(error)
    if (rollbackErrors.length > 0) {
      throw new CliError(
        `Could not commit generated files because ${detail}. Automatic rollback was incomplete ` +
          `(${rollbackErrors.join("; ")}). Keep ${stagingRoot} intact, restore the listed files, ` +
          "then fix the filesystem problem and re-run `jot generate`.",
      )
    }
    throw new CliError(
      `Could not commit generated files because ${detail}. All generated changes were rolled back. ` +
        "Check file permissions and available disk space, then re-run `jot generate`.",
    )
  } finally {
    if (safeToRemoveStaging) {
      try {
        rmSync(stagingRoot, { recursive: true, force: true })
      } catch {
        const status = committed ? "Generated files are in place" : "Rollback completed"
        log(
          `${status}, but temporary staging data remains at ${stagingRoot}. Remove that directory after verification.`,
        )
      }
    }
  }
}

function preflightWritePlan(plan: WritePlan): void {
  const root = resolve(plan.root)
  let rootInfo: ReturnType<typeof lstatSync>
  try {
    rootInfo = lstatSync(root)
  } catch {
    throw new CliError(`App root ${root} is not available. Restore it and re-run \`jot generate\`.`)
  }
  if (!rootInfo.isDirectory()) {
    throw new CliError(`App root ${root} is not a directory. Fix it and re-run \`jot generate\`.`)
  }
  const jotDirectory = lstatIfPresent(join(root, ".jot"))
  if (jotDirectory === undefined || !jotDirectory.isDirectory()) {
    throw new CliError(
      `Generator staging directory "${join(root, ".jot")}" is missing or is not a directory. ` +
        "Restore it and re-run `jot generate`.",
    )
  }

  const seen = new Set<string>()
  const collisions: string[] = []
  for (const [isUpdate, file] of [
    ...plan.creates.map((entry) => [false, entry] as const),
    ...plan.updates.map((entry) => [true, entry] as const),
  ]) {
    const parts = file.path.split(/[\\/]/).filter(Boolean)
    if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
      throw new CliError(
        `Unsafe generated path "${file.path}". Use a normal JOT app directory and re-run the generator.`,
      )
    }
    const normalized = parts.join("/")
    if (seen.has(normalized)) {
      throw new CliError(
        `The generation plan contains duplicate destination "${normalized}". Fix the generator input and retry.`,
      )
    }
    seen.add(normalized)

    let current = root
    let parentsExist = true
    for (const part of parts.slice(0, -1)) {
      current = join(current, part)
      const info = lstatIfPresent(current)
      if (info === undefined) {
        parentsExist = false
        break
      }
      if (!info.isDirectory()) {
        const blocked = current.slice(root.length + 1).replaceAll("\\", "/")
        throw new CliError(
          `Cannot generate files because parent path "${blocked}" exists but is not a directory. ` +
            "Move or remove the blocking file, then re-run `jot generate`.",
        )
      }
    }
    if (!parentsExist) continue

    const target = join(root, ...parts)
    const targetInfo = lstatIfPresent(target)
    if (!isUpdate && targetInfo !== undefined) {
      collisions.push(normalized)
      continue
    }
    if (isUpdate && (targetInfo === undefined || !targetInfo.isFile())) {
      throw new CliError(
        `Cannot update "${normalized}" because it is missing or is not a regular file. ` +
          "Restore the file and re-run `jot generate`.",
      )
    }
  }
  if (collisions.length > 0) {
    throw new CliError(
      `File(s) already exist: ${collisions.join(", ")}. Remove them or pick another name.`,
    )
  }
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw new CliError(
      `Could not inspect path ${path}. Check filesystem permissions and re-run the generator.`,
    )
  }
}

function ensureParentDirectories(root: string, relativeParent: string, created: string[]): void {
  let current = root
  for (const part of relativeParent.split(/[\\/]/).filter(Boolean)) {
    current = join(current, part)
    const existing = lstatIfPresent(current)
    if (existing !== undefined) {
      if (!existing.isDirectory()) {
        throw new Error(`parent path ${current} is not a directory`)
      }
      continue
    }
    mkdirSync(current)
    created.push(current)
  }
}

function rollbackWrites(
  applied: readonly AppliedWrite[],
  createdDirectories: readonly string[],
): string[] {
  const failures: string[] = []
  for (const operation of [...applied].reverse()) {
    if (operation.installed) {
      try {
        unlinkSync(operation.target)
      } catch (error) {
        if (!isMissing(error))
          failures.push(`could not remove ${operation.target}: ${errorMessage(error)}`)
      }
    }
    if (operation.backedUp) {
      try {
        renameSync(operation.backup, operation.target)
      } catch (error) {
        failures.push(
          `could not restore ${operation.target} from ${operation.backup}: ${errorMessage(error)}`,
        )
      }
    }
  }
  for (const directory of [...createdDirectories].reverse()) {
    try {
      rmdirSync(directory)
    } catch (error) {
      if (errorCode(error) !== "ENOENT" && errorCode(error) !== "ENOTEMPTY") {
        failures.push(`could not remove new directory ${directory}: ${errorMessage(error)}`)
      }
    }
  }
  return failures
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
