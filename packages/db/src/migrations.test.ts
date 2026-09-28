import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { splitSqlStatements } from "./driver"
import { type Driver, sqliteDriver } from "./index"
import { assertNoDuplicateMigrations, loadMigrations, migrate, rollback } from "./migrations"

interface Fixture {
  dir: string
  cleanup(): void
}

function makeDir(files: Record<string, string>): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "jot-db-migrations-"))
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents, "utf8")
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function withDown(up: string, down: string): string {
  return `${up}\n-- jot:down\n${down}\n`
}

const MIGRATIONS: Record<string, string> = {
  "0001_users.sql": withDown(
    "create table users (id integer primary key, name text not null);\n" +
      "create index users_name_idx on users(name);",
    "drop index users_name_idx;\ndrop table users;",
  ),
  "0002_posts.sql": withDown(
    "create table posts (id integer primary key, user_id integer not null " +
      "references users(id) on delete cascade, title text not null);",
    "drop table posts;",
  ),
  "0003_seed.sql": withDown(
    "insert into users (id, name) values (1, 'Ana');",
    "delete from users where id = 1;",
  ),
}

async function tables(driver: Driver): Promise<string[]> {
  const rows = await driver.query(
    "select name from sqlite_master where type = 'table' and name in ('users', 'posts', 'docs', 'crlf') order by name",
  )
  return rows.map((row) => String(row.name))
}

test("splitSqlStatements respeita strings, identificadores e comentários", () => {
  assert.deepEqual(splitSqlStatements("create table a (x); create table b (y);"), [
    "create table a (x)",
    "create table b (y)",
  ])
  assert.deepEqual(
    splitSqlStatements("insert into t values ('a;b'); insert into t values (\"x;y\");"),
    ["insert into t values ('a;b')", 'insert into t values ("x;y")'],
  )
  assert.deepEqual(splitSqlStatements("select `a;b` from t;"), ["select `a;b` from t"])
  assert.deepEqual(splitSqlStatements("select [a;b] from t;"), ["select [a;b] from t"])
  assert.deepEqual(splitSqlStatements("insert into t values ('it''s ok');"), [
    "insert into t values ('it''s ok')",
  ])
  assert.deepEqual(splitSqlStatements("-- só comentário\n/* ; */\n  "), [])
  assert.deepEqual(
    splitSqlStatements("create table a (x);--> statement-breakpoint\ncreate index i on a(x);"),
    ["create table a (x)", "create index i on a(x)"],
  )
  assert.deepEqual(splitSqlStatements("select 1 -- comentário; com ponto e vírgula\n"), [
    "select 1",
  ])
  assert.deepEqual(splitSqlStatements("select 1; select 2"), ["select 1", "select 2"])
})

test("loadMigrations ordena por nome e separa a seção -- jot:down", (t) => {
  const fixture = makeDir({
    "0010_c.sql": "select 3;",
    "0002_b.sql": "select 2;",
    "0001_a.sql": withDown("create table a (id integer);", "drop table a;"),
    "ignore.txt": "não é migration",
  })
  t.after(fixture.cleanup)

  const migrations = loadMigrations(fixture.dir)
  assert.deepEqual(
    migrations.map((migration) => migration.name),
    ["0001_a.sql", "0002_b.sql", "0010_c.sql"],
  )
  const first = migrations[0]
  assert.ok(first)
  assert.match(first.sql, /create table a/)
  assert.doesNotMatch(first.sql, /jot:down/)
  assert.ok(first.down)
  assert.match(first.down, /drop table a/)
  assert.equal(migrations[1]?.down, null)
})

test("migration duplicada (mesmo nome ignorando caixa) falha com erro didático", (t) => {
  const fixture = makeDir({})
  t.after(fixture.cleanup)
  assert.throws(
    () => assertNoDuplicateMigrations(["0001_a.sql", "0001_A.SQL"], fixture.dir),
    /duplicate migration/,
  )
  assert.doesNotThrow(() => assertNoDuplicateMigrations(["0001_a.sql", "0002_b.sql"], fixture.dir))
})

test("pasta de migrations inexistente falha com erro didático", async () => {
  const missing = join(
    tmpdir(),
    `jot-db-nao-existe-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await assert.rejects(() => migrate(driver, missing), /migrations directory not found/)
  } finally {
    await driver.close()
  }
})

test("migration vazia falha com erro didático e não registra nada", async (t) => {
  const fixture = makeDir({ "0001_empty.sql": "-- nada aqui\n\n/* nem isto */\n" })
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await assert.rejects(() => migrate(driver, fixture.dir), /is empty: no SQL found/)
    assert.deepEqual(await driver.query("select name from jot_migrations"), [])
  } finally {
    await driver.close()
  }
})

test("migrate aplica em ordem, registra e é idempotente", async (t) => {
  const fixture = makeDir(MIGRATIONS)
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    const applied = await migrate(driver, fixture.dir)
    assert.deepEqual(applied, ["0001_users.sql", "0002_posts.sql", "0003_seed.sql"])

    const registered = await driver.query("select name, applied_at from jot_migrations order by id")
    assert.deepEqual(
      registered.map((row) => row.name),
      ["0001_users.sql", "0002_posts.sql", "0003_seed.sql"],
    )
    for (const row of registered) assert.equal(typeof row.applied_at, "number")

    assert.deepEqual(await tables(driver), ["posts", "users"])
    assert.deepEqual(
      (await driver.query("select name from users")).map((row) => row.name),
      ["Ana"],
    )

    assert.deepEqual(await migrate(driver, fixture.dir), [])
    assert.equal((await driver.query("select name from jot_migrations")).length, 3)
    assert.deepEqual(
      (await driver.query("select name from users")).map((row) => row.name),
      ["Ana"],
    )
  } finally {
    await driver.close()
  }
})

test("seed com FK respeita a ordem das migrations", async (t) => {
  const fixture = makeDir(MIGRATIONS)
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await migrate(driver, fixture.dir)

    // A migration 0003 insere em users (criada em 0001); a FK de posts aponta para users.
    const seed = await driver.query("select id, name from users order by id")
    assert.deepEqual(
      seed.map((row) => ({ ...row })),
      [{ id: 1, name: "Ana" }],
    )

    await driver.run("insert into posts (user_id, title) values (?, ?)", [1, "do seed"])
    const posts = await driver.query("select user_id, title from posts")
    assert.deepEqual(
      posts.map((row) => ({ ...row })),
      [{ user_id: 1, title: "do seed" }],
    )

    await driver.run("delete from users where id = ?", [1])
    assert.deepEqual(await driver.query("select id from posts"), [])
  } finally {
    await driver.close()
  }
})

test("rollback(1) desfaz a última migration usando -- jot:down", async (t) => {
  const fixture = makeDir(MIGRATIONS)
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await migrate(driver, fixture.dir)

    const undone = await rollback(driver, fixture.dir)
    assert.deepEqual(undone, ["0003_seed.sql"])
    assert.deepEqual(await driver.query("select * from users"), [])
    assert.deepEqual(await tables(driver), ["posts", "users"])
    assert.deepEqual(
      (await driver.query("select name from jot_migrations order by id")).map((row) => row.name),
      ["0001_users.sql", "0002_posts.sql"],
    )
  } finally {
    await driver.close()
  }
})

test("rollback(2) desfaz em ordem inversa", async (t) => {
  const fixture = makeDir(MIGRATIONS)
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await migrate(driver, fixture.dir)

    const undone = await rollback(driver, fixture.dir, 2)
    assert.deepEqual(undone, ["0003_seed.sql", "0002_posts.sql"])
    assert.deepEqual(await tables(driver), ["users"])
    assert.deepEqual(
      (await driver.query("select name from jot_migrations order by id")).map((row) => row.name),
      ["0001_users.sql"],
    )
  } finally {
    await driver.close()
  }
})

test("rollback sem -- jot:down falha com erro didático e não altera nada", async (t) => {
  const fixture = makeDir({
    "0001_users.sql": withDown("create table users (id integer primary key);", "drop table users;"),
    "0002_posts.sql": "create table posts (id integer primary key);",
  })
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await migrate(driver, fixture.dir)
    await assert.rejects(
      () => rollback(driver, fixture.dir),
      /does not define -- jot:down; add the section or edit the database manually/,
    )
    assert.deepEqual(await tables(driver), ["posts", "users"])
    assert.equal((await driver.query("select name from jot_migrations")).length, 2)
  } finally {
    await driver.close()
  }
})

test("rollback com seção -- jot:down vazia falha com erro didático", async (t) => {
  const fixture = makeDir({
    "0001_docs.sql": "create table docs (id integer primary key);\n-- jot:down\n\n",
  })
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await migrate(driver, fixture.dir)
    await assert.rejects(
      () => rollback(driver, fixture.dir),
      /the -- jot:down section of migration "0001_docs.sql" is empty/,
    )
    assert.deepEqual(await tables(driver), ["docs"])
  } finally {
    await driver.close()
  }
})

test("rollback valida quantidade: nada aplicado, steps maior e steps inválido", async (t) => {
  const fixture = makeDir(MIGRATIONS)
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await assert.rejects(() => rollback(driver, fixture.dir), /no applied migrations to roll back/)

    await migrate(driver, fixture.dir)
    await assert.rejects(() => rollback(driver, fixture.dir, 4), /only 3 are applied/)
    await assert.rejects(() => rollback(driver, fixture.dir, 0), /integer number of migrations/)
    await assert.rejects(() => rollback(driver, fixture.dir, 1.5), /integer number of migrations/)
  } finally {
    await driver.close()
  }
})

test("rollback de migration cujo arquivo sumiu falha com erro didático", async (t) => {
  const fixture = makeDir({
    "0001_users.sql": withDown("create table users (id integer primary key);", "drop table users;"),
  })
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await migrate(driver, fixture.dir)
    rmSync(join(fixture.dir, "0001_users.sql"))
    await assert.rejects(
      () => rollback(driver, fixture.dir),
      /registered in jot_migrations does not exist in/,
    )
  } finally {
    await driver.close()
  }
})

test("driver sem exec aplica statement a statement (fallback documentado)", async (t) => {
  const fixture = makeDir({
    "0001_multi.sql": withDown(
      "create table users (id integer primary key);\ncreate index users_id_idx on users(id);",
      "drop index users_id_idx;\ndrop table users;",
    ),
  })
  t.after(fixture.cleanup)

  const raw = sqliteDriver({ file: ":memory:" })
  const minimal: Driver = {
    query: (sql, params) => raw.query(sql, params),
    run: (sql, params) => raw.run(sql, params),
    close: () => raw.close(),
  }

  try {
    assert.deepEqual(await migrate(minimal, fixture.dir), ["0001_multi.sql"])
    const indexes = await raw.query(
      "select name from sqlite_master where type = 'index' and name = 'users_id_idx'",
    )
    assert.equal(indexes.length, 1)

    assert.deepEqual(await rollback(minimal, fixture.dir), ["0001_multi.sql"])
    assert.deepEqual(await tables(raw), [])
  } finally {
    await minimal.close()
  }
})

test("migrations com CRLF funcionam", async (t) => {
  const fixture = makeDir({
    "0001_crlf.sql":
      "create table crlf (id integer primary key);\r\n-- jot:down\r\ndrop table crlf;\r\n",
  })
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    assert.deepEqual(await migrate(driver, fixture.dir), ["0001_crlf.sql"])
    assert.deepEqual(await tables(driver), ["crlf"])
    assert.deepEqual(await rollback(driver, fixture.dir), ["0001_crlf.sql"])
    assert.deepEqual(await tables(driver), [])
  } finally {
    await driver.close()
  }
})

test("registro duplicado em jot_migrations vira erro didático (e a transação desfaz)", async (t) => {
  const fixture = makeDir({
    "0001_self.sql": withDown(
      "insert into jot_migrations (name, applied_at) values ('0001_self.sql', 0);",
      "delete from jot_migrations where name = '0001_self.sql';",
    ),
  })
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await assert.rejects(() => migrate(driver, fixture.dir), /duplicate migration/)
    assert.deepEqual(await driver.query("select name from jot_migrations"), [])
  } finally {
    await driver.close()
  }
})

// Regressão MINOR-01: o marcador dentro de string multilinha não pode ser tratado como seção.
test("-- jot:down dentro de string multilinha não vira marcador", async (t) => {
  const fixture = makeDir({
    "0001_notes.sql":
      "create table notes (id integer primary key, body text);\n" +
      "insert into notes (id, body) values (1, 'line1\n-- jot:down\nline3');\n" +
      "-- jot:down\ndrop table notes;\n",
  })
  t.after(fixture.cleanup)
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    const parsed = loadMigrations(fixture.dir)[0]
    assert.ok(parsed)
    assert.match(parsed.sql, /line3'/)
    assert.equal(parsed.down, "drop table notes;\n")

    assert.deepEqual(await migrate(driver, fixture.dir), ["0001_notes.sql"])
    const rows = await driver.query("select body from notes")
    assert.deepEqual(
      rows.map((row) => row.body),
      ["line1\n-- jot:down\nline3"],
    )
    assert.deepEqual(await rollback(driver, fixture.dir), ["0001_notes.sql"])
    assert.deepEqual(await tables(driver), [])
  } finally {
    await driver.close()
  }
})

// Regressão MINOR-02: entrada `*.sql` que é diretório não pode estourar EISDIR cru.
test("entrada *.sql que é diretório falha com erro didático", async (t) => {
  const fixture = makeDir({})
  t.after(fixture.cleanup)
  mkdirSync(join(fixture.dir, "weird.sql"))

  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await assert.rejects(() => migrate(driver, fixture.dir), /is a directory, not a migration file/)
  } finally {
    await driver.close()
  }
})

test("mensagens de erro das migrations estão em inglês (sem acentos)", async (t) => {
  const messages: string[] = []
  const capture = async (run: () => Promise<unknown>): Promise<void> => {
    try {
      await run()
    } catch (error) {
      messages.push((error as Error).message)
    }
  }

  const missing = join(
    tmpdir(),
    `jot-db-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await capture(() => migrate(driver, missing))
    await capture(() => rollback(driver, missing))

    const empty = makeDir({ "0001_empty.sql": "-- nothing\n" })
    t.after(empty.cleanup)
    await capture(() => migrate(driver, empty.dir))

    const noDown = makeDir({ "0001_plain.sql": "create table a (id integer primary key);" })
    t.after(noDown.cleanup)
    await migrate(driver, noDown.dir)
    await capture(() => rollback(driver, noDown.dir))
    await capture(() => rollback(driver, noDown.dir, 0))
    await capture(() => rollback(driver, noDown.dir, 5))

    try {
      assertNoDuplicateMigrations(["0001_a.sql", "0001_A.sql"], noDown.dir)
    } catch (error) {
      messages.push((error as Error).message)
    }
  } finally {
    await driver.close()
  }

  assert.ok(messages.length >= 6, `esperava 6+ mensagens, veio: ${messages.join(" | ")}`)
  for (const message of messages) {
    assert.match(message, /^[\x20-\x7E]+$/, `mensagem com caracteres não-ASCII: ${message}`)
  }
})
