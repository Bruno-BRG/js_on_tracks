// Acesso ao banco global setado pelo `@js_on_tracks/core` (`setDefaultDatabase`) — contrato §4.2.

import { getDefaultDatabase } from "@js_on_tracks/db"
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy"
import { OrmError } from "./errors"

/** Tipo do Drizzle usado pelo ORM (mesma instância que `Database.drizzle` do `@js_on_tracks/db`). */
export type Drizzle = SqliteRemoteDatabase<Record<string, unknown>>

/**
 * Devolve a instância Drizzle do banco global. Erro didático quando nenhum banco foi
 * configurado (`config/database.ts` ou `setDefaultDatabase(db)`).
 */
export function drizzle(): Drizzle {
  try {
    // O `@js_on_tracks/db` lança o próprio erro quando não há banco; traduzimos para o erro do ORM
    // (mensagem em inglês, conforme o contrato).
    return getDefaultDatabase().drizzle as unknown as Drizzle
  } catch {
    throw new OrmError(
      "no database configured;",
      "set config/database.ts (export default defineDatabase({ url: ... })) or call setDefaultDatabase(db) before using a Model.",
    )
  }
}
