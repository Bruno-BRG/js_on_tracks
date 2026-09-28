#!/usr/bin/env node
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const dist = fileURLToPath(new URL("../dist/main.js", import.meta.url))

if (existsSync(dist)) {
  const { runCreateJot } = await import(dist)
  process.exitCode = await runCreateJot(process.argv.slice(2))
} else {
  const { register } = await import("tsx/esm/api")
  register()
  const { runCreateJot } = await import("../src/main.ts")
  process.exitCode = await runCreateJot(process.argv.slice(2))
}
