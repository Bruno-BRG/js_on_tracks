import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { eq } from "drizzle-orm"
import {
  boolean,
  createDatabase,
  type Database,
  getDefaultDatabase,
  id,
  integer,
  json,
  real,
  refs,
  setDefaultDatabase,
  sqliteDriver,
  string,
  table,
  text,
  timestamps,
} from "./index"

const users = table("users", {
  id: id(),
  name: string().notNull(),
  email: string().notNull().unique(),
  active: boolean().notNull().default(true),
  ...timestamps(),
})

const posts = table("posts", {
  id: id(),
  authorId: refs(() => users, { onDelete: "cascade" }).notNull(),
  title: string().notNull(),
  body: text(),
  views: integer().notNull().default(0),
  rating: real(),
  meta: json<{ tags: string[] }>(),
  published: boolean().default(false),
  ...timestamps(),
})

const USERS_DDL = `create table users (
  id integer primary key autoincrement,
  name text not null,
  email text not null unique,
  active integer not null default 1,
  created_at integer not null,
  updated_at integer not null
)`

const POSTS_DDL = `create table posts (
  id integer primary key autoincrement,
  author_id integer not null references users(id) on delete cascade,
  title text not null,
  body text,
  views integer not null default 0,
  rating real,
  meta text,
  published integer default 0,
  created_at integer not null,
  updated_at integer not null
)`

async function createMemoryDb(): Promise<Database> {
  const db = createDatabase({ url: ":memory:", schema: { users, posts } })
  await db.exec(USERS_DDL)
  await db.exec(POSTS_DDL)
  return db
}

const at = (ms: number): Date => new Date(ms)

/**
 * O Drizzle envolve erros do SQLite em `DrizzleQueryError`; a mensagem original fica em `cause`.
 * Valida ambos para garantir que o erro real do SQLite foi preservado.
 */
async function rejectsWithCause(run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    if (!(error instanceof Error)) return false
    const text = `${error.message}\n${String(error.cause)}`
    return pattern.test(text)
  })
}

// Este teste precisa ser o primeiro do arquivo: roda antes de qualquer setDefaultDatabase.
test("getDefaultDatabase sem banco definido falha com erro didático", () => {
  assert.throws(() => getDefaultDatabase(), /no database configured/)
  assert.throws(() => getDefaultDatabase(), /setDefaultDatabase/)
})

test("setDefaultDatabase/getDefaultDatabase e limpeza ao fechar", async () => {
  const db = createDatabase({ url: ":memory:", schema: { users } })
  setDefaultDatabase(db)
  assert.equal(getDefaultDatabase(), db)
  await db.close()
  assert.throws(() => getDefaultDatabase(), /no database configured/)
})

test("CRUD completo via drizzle com chaves JS em camelCase", async () => {
  const db = await createMemoryDb()
  try {
    const [ana] = await db.drizzle
      .insert(users)
      .values({ name: "Ana", email: "ana@jot.dev", createdAt: at(1), updatedAt: at(2) })
      .returning()
    assert.ok(ana)
    assert.equal(ana.id, 1)
    assert.equal(ana.active, true) // default do schema
    assert.ok(ana.createdAt instanceof Date)
    assert.equal(ana.createdAt.getTime(), 1)

    const [post] = await db.drizzle
      .insert(posts)
      .values({
        authorId: ana.id, // chave camelCase, coluna author_id
        title: "Olá",
        meta: { tags: ["db", "jot"] },
        createdAt: at(3),
        updatedAt: at(4),
      })
      .returning()
    assert.ok(post)
    assert.equal(post.authorId, ana.id)
    assert.deepEqual(post.meta, { tags: ["db", "jot"] })
    assert.equal(post.body, null)
    assert.equal(post.views, 0) // default
    assert.equal(post.published, false) // default
    assert.equal(post.rating, null)

    const all = await db.drizzle.select().from(posts)
    assert.equal(all.length, 1)
    assert.ok(all[0])
    assert.equal(all[0].title, "Olá")

    const found = await db.drizzle.select().from(users).where(eq(users.email, "ana@jot.dev")).get()
    assert.equal(found?.name, "Ana")

    const updated = await db.drizzle
      .update(posts)
      .set({ title: "Olá 2", published: true })
      .where(eq(posts.id, post.id))
      .returning()
    assert.ok(updated[0])
    assert.equal(updated[0].title, "Olá 2")
    assert.equal(updated[0].published, true)

    const deleted = await db.drizzle.delete(posts).where(eq(posts.id, post.id)).returning()
    assert.equal(deleted.length, 1)
    assert.equal((await db.drizzle.select().from(posts)).length, 0)
  } finally {
    await db.close()
  }
})

test("notNull e unique produzem erros do SQLite", async () => {
  const db = await createMemoryDb()
  try {
    await db.drizzle
      .insert(users)
      .values({ name: "Ana", email: "ana@jot.dev", createdAt: at(1), updatedAt: at(1) })

    const missingTitle = {
      authorId: 1,
      createdAt: at(1),
      updatedAt: at(1),
    } as unknown as typeof posts.$inferInsert
    await rejectsWithCause(() => db.drizzle.insert(posts).values(missingTitle), /NOT NULL/i)

    await rejectsWithCause(
      () =>
        db.drizzle
          .insert(users)
          .values({ name: "Outra", email: "ana@jot.dev", createdAt: at(1), updatedAt: at(1) }),
      /UNIQUE constraint failed/i,
    )
  } finally {
    await db.close()
  }
})

test("FK: violação bloqueada e cascade ao apagar o pai", async () => {
  const db = await createMemoryDb()
  try {
    const [ana] = await db.drizzle
      .insert(users)
      .values({ name: "Ana", email: "ana@jot.dev", createdAt: at(1), updatedAt: at(1) })
      .returning()
    assert.ok(ana)

    await rejectsWithCause(
      () =>
        db.drizzle
          .insert(posts)
          .values({ authorId: 999, title: "órfão", createdAt: at(1), updatedAt: at(1) }),
      /FOREIGN KEY constraint failed/i,
    )

    await db.drizzle
      .insert(posts)
      .values({ authorId: ana.id, title: "A", createdAt: at(1), updatedAt: at(1) })
    await db.drizzle
      .insert(posts)
      .values({ authorId: ana.id, title: "B", createdAt: at(1), updatedAt: at(1) })
    assert.equal((await db.drizzle.select().from(posts)).length, 2)

    await db.drizzle.delete(users).where(eq(users.id, ana.id))
    assert.equal((await db.drizzle.select().from(posts)).length, 0)
  } finally {
    await db.close()
  }
})

// Regressão MAJOR-01: joins com nomes de coluna repetidos (posts.id/users.id) têm de manter
// todos os valores na ordem correta — Object.values colapsaria as chaves duplicadas.
test("join com colunas de mesmo nome preserva todos os valores", async () => {
  const db = await createMemoryDb()
  try {
    const [ana] = await db.drizzle
      .insert(users)
      .values({ name: "Ana", email: "ana@jot.dev", createdAt: at(1), updatedAt: at(1) })
      .returning()
    const [bia] = await db.drizzle
      .insert(users)
      .values({ name: "Bia", email: "bia@jot.dev", createdAt: at(1), updatedAt: at(1) })
      .returning()
    assert.ok(ana)
    assert.ok(bia)

    const [post] = await db.drizzle
      .insert(posts)
      .values({ authorId: bia.id, title: "T", createdAt: at(2), updatedAt: at(2) })
      .returning()
    assert.ok(post)

    const rows = await db.drizzle
      .select()
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
    assert.equal(rows.length, 1)
    const row = rows[0]
    assert.ok(row)
    assert.equal(row.posts.id, post.id)
    assert.equal(row.posts.authorId, bia.id)
    assert.equal(row.posts.title, "T")
    assert.equal(row.users.id, bia.id)
    assert.equal(row.users.name, "Bia")
    assert.equal(row.users.email, "bia@jot.dev")
  } finally {
    await db.close()
  }
})

test("join continua correto com logQueries ligado (queryArrays é encaminhado)", async (t) => {
  const debug = t.mock.method(console, "debug", () => {})
  const db = createDatabase({ url: ":memory:", schema: { users, posts }, logQueries: true })
  try {
    await db.exec(USERS_DDL)
    await db.exec(POSTS_DDL)

    const [bia] = await db.drizzle
      .insert(users)
      .values({ name: "Bia", email: "bia@jot.dev", createdAt: at(1), updatedAt: at(1) })
      .returning()
    assert.ok(bia)
    const [post] = await db.drizzle
      .insert(posts)
      .values({ authorId: bia.id, title: "T", createdAt: at(2), updatedAt: at(2) })
      .returning()
    assert.ok(post)

    const rows = await db.drizzle
      .select()
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
    assert.equal(rows[0]?.posts.title, "T")
    assert.equal(rows[0]?.users.id, bia.id)
    assert.equal(rows[0]?.users.name, "Bia")
    assert.ok(debug.mock.calls.length > 0, "logQueries deveria registrar as queries")
  } finally {
    await db.close()
  }
})

test("db.exec: select, params, DDL e múltiplos statements", async () => {
  const db = await createMemoryDb()
  try {
    const simple = await db.exec("select 1 as value")
    assert.deepEqual({ ...simple[0] }, { value: 1 })

    const withParams = await db.exec("select ? as name, ? as flag", ["jot", true])
    assert.deepEqual({ ...withParams[0] }, { name: "jot", flag: 1 })

    const ddl = await db.exec("create table extra (id integer)")
    assert.deepEqual(ddl, [])

    await db.exec("create table m1 (x); create table m2 (y)")
    const tables = await db.exec(
      "select name from sqlite_master where type = 'table' and name in ('m1', 'm2') order by name",
    )
    assert.deepEqual(
      tables.map((row) => row.name),
      ["m1", "m2"],
    )
  } finally {
    await db.close()
  }
})

test("migrate/rollback via createDatabase com migrationsDir", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "jot-db-migrate-"))
  const migrationsDir = join(dir, "migrate")
  mkdirSync(migrationsDir, { recursive: true })
  writeFileSync(
    join(migrationsDir, "0001_users.sql"),
    `create table users (id integer primary key autoincrement, name text not null);\n-- jot:down\ndrop table users;\n`,
    "utf8",
  )
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const db = createDatabase({ url: ":memory:", schema: { users }, migrationsDir })
  try {
    const applied = await db.migrate()
    assert.deepEqual(applied, ["0001_users.sql"])
    await db.exec("insert into users (name) values (?)", ["Ana"])
    assert.deepEqual(await db.migrate(), [])

    const undone = await db.rollback()
    assert.deepEqual(undone, ["0001_users.sql"])
    const tables = await db.exec(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'",
    )
    assert.deepEqual(
      tables.map((row) => row.name),
      ["jot_migrations"],
    )
  } finally {
    await db.close()
  }
})

test("logQueries loga SQL, params e duração via console.debug", async (t) => {
  const debug = t.mock.method(console, "debug", () => {})
  const db = createDatabase({ url: ":memory:", schema: { users }, logQueries: true })
  try {
    await db.exec(USERS_DDL)
    await db.exec("select * from users where name = ?", ["Ana"])

    const messages = debug.mock.calls.map((call) => String(call.arguments[0]))
    assert.ok(messages.length >= 2, `esperava logs, veio: ${messages.join(" | ")}`)
    assert.ok(
      messages.some(
        (message) =>
          message.includes("select * from users where name = ?") &&
          message.includes("Ana") &&
          /\(\d+(\.\d+)?ms\)/.test(message),
      ),
      `faltou log da query com params e duração: ${messages.join(" | ")}`,
    )
  } finally {
    await db.close()
  }
})

test("url postgres falha com erro didático", () => {
  assert.throws(
    () => createDatabase({ url: "postgres://localhost:5432/blog", schema: { users } }),
    /Postgres support arrives in M3; use SQLite for now/,
  )
  assert.throws(
    () => createDatabase({ url: "POSTGRESQL://localhost/blog", schema: { users } }),
    /Postgres support arrives in M3/,
  )
})

test("url vazia falha com erro didático", () => {
  assert.throws(() => createDatabase({ url: "", schema: { users } }), /database url is empty/)
})

test("arquivo em pasta temporária (mkdtemp): cria diretórios e persiste", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jot-db-file-"))
  const file = join(dir, "nested", "dev.sqlite")
  try {
    const first = createDatabase({ url: file, schema: { users } })
    try {
      await first.exec(USERS_DDL)
      await first.exec(
        "insert into users (name, email, active, created_at, updated_at) values (?, ?, ?, ?, ?)",
        ["Ana", "ana@jot.dev", true, 1, 2],
      )
    } finally {
      await first.close()
    }
    assert.equal(existsSync(file), true)

    // Reabre usando a forma file:///... (URL absoluta).
    const second = createDatabase({ url: pathToFileURL(file).href, schema: { users } })
    try {
      const rows = await second.drizzle.select().from(users)
      assert.equal(rows.length, 1)
      assert.ok(rows[0])
      assert.equal(rows[0].name, "Ana")
      assert.equal(rows[0].active, true)
      assert.equal(rows[0].createdAt.getTime(), 1)
    } finally {
      await second.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("migrationsDir default aponta para db/migrate do diretório atual", async () => {
  const db = createDatabase({ url: ":memory:", schema: { users } })
  try {
    assert.equal(db.root, process.cwd())
    assert.equal(db.migrationsDir, join(process.cwd(), "db", "migrate"))
  } finally {
    await db.close()
  }
})

test("root ancora o migrationsDir default", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jot-db-root-"))
  try {
    const db = createDatabase({ url: ":memory:", schema: { users }, root: dir })
    try {
      assert.equal(db.root, dir)
      assert.equal(db.migrationsDir, join(dir, "db", "migrate"))
    } finally {
      await db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("logQueries com logParams=false omite os valores", async (t) => {
  const debug = t.mock.method(console, "debug", () => {})
  const db = createDatabase({
    url: ":memory:",
    schema: { users },
    logQueries: true,
    logParams: false,
  })
  try {
    await db.exec(USERS_DDL)
    await db.exec("select * from users where name = ?", ["Ana"])
    const messages = debug.mock.calls.map((call) => String(call.arguments[0]))
    assert.ok(
      messages.some((message) => message.includes("[omitted]")),
      `faltou o placeholder de params omitidos: ${messages.join(" | ")}`,
    )
    assert.ok(
      !messages.some((message) => message.includes("Ana")),
      `params não deveriam aparecer no log: ${messages.join(" | ")}`,
    )
  } finally {
    await db.close()
  }
})

test("mensagens ao usuário estão em inglês (sem acentos)", async () => {
  const messages: string[] = []
  const capture = (run: () => unknown): void => {
    try {
      run()
    } catch (error) {
      messages.push((error as Error).message)
    }
  }
  const captureAsync = async (run: () => Promise<unknown>): Promise<void> => {
    try {
      await run()
    } catch (error) {
      messages.push((error as Error).message)
    }
  }

  capture(() => createDatabase({ url: "postgres://localhost/blog", schema: { users } }))
  capture(() => createDatabase({ url: "   ", schema: { users } }))
  capture(() => sqliteDriver({ file: "" }))
  capture(() => sqliteDriver({ file: "file://server/share/dev.sqlite" }))

  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await driver.run("create table t (value)")
    await captureAsync(() => driver.run("insert into t (value) values (?)", [{ a: 1 }]))
    await captureAsync(() => driver.run("select 1; select 2"))
  } finally {
    await driver.close()
  }

  assert.ok(messages.length >= 6, `esperava 6+ mensagens, veio: ${messages.join(" | ")}`)
  for (const message of messages) {
    assert.match(message, /^[\x20-\x7E]+$/, `mensagem com caracteres não-ASCII: ${message}`)
  }
})
