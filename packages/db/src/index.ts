// @jot/db — schema DSL, Driver SQLite (node:sqlite), createDatabase e migrations.
// Contrato completo em docs/architecture.md §4.1.

export {
  createDatabase,
  type Database,
  type DatabaseOptions,
  getDefaultDatabase,
  setDefaultDatabase,
} from "./database"

export { type Driver, type SqliteDriverOptions, sqliteDriver } from "./driver"
export {
  type AnyColumnDescriptor,
  type AnyTable,
  boolean,
  type ColumnData,
  type ColumnDescriptor,
  id,
  integer,
  json,
  type ReferenceAction,
  type RefsOptions,
  real,
  refs,
  string,
  type Table,
  table,
  text,
  timestamps,
} from "./schema"
