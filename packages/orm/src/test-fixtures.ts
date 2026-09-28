// Fixtures dos testes do ORM: tabela `posts` + banco SQLite `:memory:` do `@jot/db`.
//
// O banco só é criado quando `useTestDatabase()` é chamado — assim o primeiro teste de
// `orm.test.ts` consegue verificar o erro didático de "nenhum banco configurado" antes de
// o default ser setado. Este módulo não é re-exportado pelo `index.ts`.

import {
  boolean,
  createDatabase,
  type Database,
  id,
  setDefaultDatabase,
  string,
  table,
  text,
  timestamps,
} from "@jot/db"

export const posts = table("posts", {
  id: id(),
  title: string().notNull(),
  body: text(),
  published: boolean().default(false),
  ...timestamps(),
})

const POSTS_DDL = `create table posts (
  id integer primary key autoincrement,
  title text not null,
  body text,
  published integer default 0,
  created_at integer not null,
  updated_at integer not null
)`

let database: Database | undefined

/** Cria (uma vez) o banco `:memory:` com o schema do teste e o define como default. */
export async function useTestDatabase(): Promise<Database> {
  if (database !== undefined) return database
  const created = createDatabase({ url: ":memory:", schema: { posts } })
  await created.exec(POSTS_DDL)
  setDefaultDatabase(created)
  database = created
  return created
}

/** Fecha o banco do teste (remove o default) — chamado no `after()` do arquivo. */
export async function closeTestDatabase(): Promise<void> {
  if (database === undefined) return
  await database.close()
  database = undefined
}
