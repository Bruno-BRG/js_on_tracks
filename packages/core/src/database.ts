/** Configuração do banco (`config/database.ts`). */
export interface DatabaseConfig {
  url: string
  /** Namespace exportado por `db/schema.ts` (opcional; o M1 não usa o API relacional). */
  schema?: Record<string, unknown>
  /** Pasta com `*.sql`; default: `db/migrate` relativo ao root do app. */
  migrationsDir?: string
  /** Loga SQL/params em dev (default: `!isProduction()`). */
  logQueries?: boolean
}

/** Valida e devolve a configuração do banco (erro didático se `url` for vazia). */
export function defineDatabase(config: DatabaseConfig): DatabaseConfig {
  const url = typeof config?.url === "string" ? config.url.trim() : ""
  if (url.length === 0) {
    throw new Error(
      `defineDatabase requires a non-empty "url" (config/database.ts). ` +
        `Example: export default defineDatabase({ url: env("DATABASE_URL", "./db/dev.sqlite") })`,
    )
  }
  return { ...config, url }
}
