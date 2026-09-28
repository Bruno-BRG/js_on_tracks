import assert from "node:assert/strict"
import { test } from "node:test"
import { assertKnownFlags, parseArgv } from "./args"
import { CliError } from "./output"

test("first non-flag token is the command", () => {
  const parsed = parseArgv(["new", "blog"])
  assert.equal(parsed.command, "new")
  assert.deepEqual(parsed.positionals, ["blog"])
  assert.deepEqual(parsed.flags, {})
  assert.equal(parsed.help, false)
  assert.equal(parsed.version, false)
})

test("flags work before and after positionals", () => {
  const before = parseArgv(["--no-install", "new", "blog"])
  assert.equal(before.command, "new")
  assert.deepEqual(before.positionals, ["blog"])
  assert.equal(before.flags["no-install"], true)

  const after = parseArgv(["new", "blog", "--no-install"])
  assert.equal(after.command, "new")
  assert.equal(after.flags["no-install"], true)
  assert.deepEqual(after.rawFlags, ["--no-install"])
})

test("--x=y becomes a string and preserves the raw flag", () => {
  const parsed = parseArgv(["server", "--port=4000"])
  assert.equal(parsed.flags.port, "4000")
  assert.deepEqual(parsed.rawFlags, ["--port=4000"])
})

test("-h/--help and -v/--version are dedicated fields", () => {
  assert.equal(parseArgv(["--help"]).help, true)
  assert.equal(parseArgv(["-h"]).help, true)
  assert.equal(parseArgv(["--version"]).version, true)
  assert.equal(parseArgv(["-v"]).version, true)
  assert.equal(parseArgv(["server", "-h"]).help, true)
  assert.equal(parseArgv(["server", "-h"]).command, "server")
})

test("-- ends flag parsing", () => {
  const parsed = parseArgv(["new", "--", "--no-install", "blog"])
  assert.equal(parsed.command, "new")
  assert.deepEqual(parsed.positionals, ["--no-install", "blog"])
  assert.equal(parsed.flags["no-install"], undefined)
})

test("assertKnownFlags rejects unknown options citing the usage", () => {
  const parsed = parseArgv(["server", "--port"])
  assert.throws(
    () => assertKnownFlags(parsed, [], "jot server"),
    (error: unknown) =>
      error instanceof CliError &&
      error.message === 'Unknown option "--port" for `jot server`. Run `jot --help`.',
  )
  assert.doesNotThrow(() =>
    assertKnownFlags(
      parseArgv(["new", "blog", "--no-install"]),
      ["no-install"],
      "jot new <name> [--no-install]",
    ),
  )
})
