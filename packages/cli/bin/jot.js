#!/usr/bin/env node
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const dist = fileURLToPath(new URL("../dist/cli.js", import.meta.url))

if (existsSync(dist)) {
  const { runCli } = await import(dist)
  process.exitCode = await runCli(process.argv.slice(2))
} else {
  const { register } = await import("tsx/esm/api")
  register()
  const { runCli } = await import("../src/main.ts")
  process.exitCode = await runCli(process.argv.slice(2))
}
