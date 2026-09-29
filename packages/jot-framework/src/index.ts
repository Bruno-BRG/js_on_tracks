/**
 * `jot-framework` — import único dos apps JOT.
 *
 * Re-exporta `@js_on_tracks/core`, `@js_on_tracks/db`, `@js_on_tracks/orm` e `@js_on_tracks/views` num só módulo:
 *
 * ```ts
 * import { Controller, routes, table, id, Model, presence, paths } from "jot-framework"
 * ```
 *
 * O `jsxImportSource` continua apontando para `@js_on_tracks/views` (runtime JSX).
 */

export * from "@js_on_tracks/core"
// `AnyTable` existe nos dois pacotes (db: união de tabelas Drizzle; orm: alias interno).
// No import único, vale a definição do `@js_on_tracks/db` — a que o usuário vê ao chamar `table()`.
export type { AnyTable } from "@js_on_tracks/db"
export * from "@js_on_tracks/db"
export * from "@js_on_tracks/orm"
export * from "@js_on_tracks/views"
