import { assertKnownFlags, type ParsedArgv } from "../args"
import { assertAppRoot, collect } from "../collect"
import { NODE_FLAGS, resolveTsx, runChild } from "../spawn"

/** Implementa `jot routes`: gera `.jot/routes-script.ts` e imprime a tabela de rotas. */
export async function runRoutes(parsed: ParsedArgv): Promise<number> {
  assertKnownFlags(parsed, [], "jot routes")
  const root = process.cwd()
  assertAppRoot(root)
  collect(root)
  resolveTsx(root)
  return runChild(process.execPath, [...NODE_FLAGS, ".jot/routes-script.ts"], { cwd: root })
}
