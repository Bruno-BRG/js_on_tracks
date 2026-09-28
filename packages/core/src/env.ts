import { existsSync } from "node:fs"
import path from "node:path"

/**
 * `.env` do app. O carregamento acontece já no import deste módulo porque os
 * `config/*.ts` do app (avaliados antes de `start()`) usam `env(...)` — ex.:
 * `defineDatabase({ url: env("DATABASE_URL", "./db/dev.sqlite") })`.
 */

/** Arquivos já carregados nesta execução (idempotência). */
const loadedFiles = new Set<string>()

// Efeito de import: carrega o `.env` do diretório de execução, se existir.
loadDotEnv()

/**
 * Carrega `<dir>/.env` (default: cwd) com o builtin `process.loadEnvFile`, que
 * não sobrescreve variáveis já definidas no processo. Devolve `true` quando o
 * arquivo existe e foi carregado; `false` quando não existe (ou já foi lido).
 */
export function loadDotEnv(dir?: string): boolean {
  const file = path.resolve(dir ?? process.cwd(), ".env")
  if (loadedFiles.has(file)) return false
  if (!existsSync(file)) return false
  try {
    process.loadEnvFile(file)
    loadedFiles.add(file)
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to load ${file}: ${detail}. Fix the .env file (each line must be KEY=value) or delete it.`,
      { cause: error },
    )
  }
}

/**
 * Lê uma variável de ambiente; sem a variável e sem fallback, erro didático.
 */
export function env(name: string, fallback?: string): string {
  const value = process.env[name]
  if (value !== undefined) return value
  if (fallback !== undefined) return fallback
  throw new Error(
    `Environment variable "${name}" is not defined. Set it in .env (e.g. ${name}=value) ` +
      `or in the process environment.`,
  )
}

/** `true` quando `NODE_ENV=production` (dev é o default). */
export function isProduction(): boolean {
  return (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production"
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
  )
}
