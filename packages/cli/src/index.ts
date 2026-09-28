/**
 * `@jot/cli` — binário `jot`, `collect` (geração de `.jot/**`), `newProject`
 * (mesma função usada pelo `create-jot`) e os generators (`generate model|scaffold`).
 * Contrato em `docs/architecture.md` §4.6.
 */

export { assertKnownFlags, type ParsedArgv, parseArgv } from "./args"
export { assertAppRoot, assertDatabase, type CollectResult, collect } from "./collect"
export { type NewProjectOptions, type NewProjectResult, newProject } from "./commands/new"
export {
  GENERATE_USAGE,
  type GenerateKind,
  type GenerateOptions,
  type GenerateResult,
  generateResource,
  runGenerate,
} from "./generate/index"
export type { ResourceSpec } from "./generate/parse"
export { runCli } from "./main"
export { CliError, printError } from "./output"
