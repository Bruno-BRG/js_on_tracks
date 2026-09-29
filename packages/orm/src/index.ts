// API pública do `@js_on_tracks/orm` (contrato §4.2).
//
// `database.ts`, `query.ts` e `test-fixtures.ts` são internos: o acesso ao banco é sempre
// pelo `getDefaultDatabase()` do `@js_on_tracks/db`, setado pelo `@js_on_tracks/core` no boot.

export type { SQL } from "drizzle-orm"
// Operadores aceitos nos callbacks de `where`/`count` (re-export da dependência declarada).
export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  like,
  lt,
  lte,
  ne,
  not,
  or,
} from "drizzle-orm"
export { OrmError } from "./errors"
export { Model } from "./model"
export type {
  AnyTable,
  ColumnName,
  Errors,
  Input,
  InstanceOf,
  ModelClass,
  OrderTerm,
  QueryOptions,
  RecordOf,
  Row,
  TableOf,
  WhereInput,
  WhereObject,
} from "./types"
export {
  type FormatValidation,
  format,
  type MaxLengthValidation,
  type MinLengthValidation,
  maxLength,
  minLength,
  type PresenceValidation,
  presence,
  type Validation,
  type Validations,
} from "./validations"
