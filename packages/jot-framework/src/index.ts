/**
 * `jot-framework` — import único dos apps JOT.
 *
 * Re-exporta `@jot/core`, `@jot/db`, `@jot/orm` e `@jot/views` num só módulo:
 *
 * ```ts
 * import { Controller, routes, table, id, Model, presence, paths } from "jot-framework"
 * ```
 *
 * O `jsxImportSource` continua apontando para `@jot/views` (runtime JSX).
 */

export * from "@jot/core"
// `AnyTable` existe nos dois pacotes (db: união de tabelas Drizzle; orm: alias interno).
// No import único, vale a definição do `@jot/db` — a que o usuário vê ao chamar `table()`.
export type { AnyTable } from "@jot/db"
export * from "@jot/db"
export * from "@jot/orm"
export * from "@jot/views"
