/**
 * `@jot/cli` — binário `jot`, `collect` (geração de `.jot/**`) e `newProject`
 * (mesma função usada pelo `create-jot`). Contrato em `docs/architecture.md` §4.6.
 */

export { assertKnownFlags, type ParsedArgv, parseArgv } from "./args"
export { assertAppRoot, assertDatabase, type CollectResult, collect } from "./collect"
export { type NewProjectOptions, type NewProjectResult, newProject } from "./commands/new"
export { runCli } from "./main"
export { CliError, printError } from "./output"
