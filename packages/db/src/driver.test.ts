import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { sqliteDriver } from "./index"

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "jot-db-driver-"))
}

test("query/run em :memory: com conversão de boolean, Date e undefined", async () => {
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await driver.run("create table events (flag integer, happened_at integer, note text)")
    await driver.run("insert into events (flag, happened_at, note) values (?, ?, ?)", [
      true,
      new Date(1700000000000),
      undefined,
    ])
    await driver.run("insert into events (flag, happened_at, note) values (?, ?, ?)", [
      false,
      new Date(1),
      "ok",
    ])

    const rows = await driver.query(
      "select flag, happened_at, note from events order by happened_at desc",
    )
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [
        { flag: 1, happened_at: 1700000000000, note: null },
        { flag: 0, happened_at: 1, note: "ok" },
      ],
    )
  } finally {
    await driver.close()
  }
})

test("pragma foreign_keys fica ativo", async () => {
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    const rows = await driver.query("pragma foreign_keys")
    assert.deepEqual({ ...rows[0] }, { foreign_keys: 1 })

    await driver.run("create table parents (id integer primary key)")
    await driver.run(
      "create table children (id integer primary key, parent_id integer references parents(id))",
    )
    await assert.rejects(
      () => driver.run("insert into children (parent_id) values (?)", [99]),
      /foreign key/i,
    )
  } finally {
    await driver.close()
  }
})

test("valores não suportados falham com erro didático", async () => {
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    await driver.run("create table t (value)")
    await assert.rejects(
      () => driver.run("insert into t (value) values (?)", [{ a: 1 }]),
      /cannot store a value of type Object in SQLite/,
    )
    await assert.rejects(
      () => driver.run("insert into t (value) values (?)", [[1, 2]]),
      /value of type array/,
    )
  } finally {
    await driver.close()
  }
})

test("exec aceita múltiplos statements; query/run recusam com erro didático", async () => {
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    const exec = driver.exec
    assert.ok(exec, "sqliteDriver deve expor exec para SQL multi-statement")
    await exec("create table a (x); create table b (y)")
    const rows = await driver.query(
      "select name from sqlite_master where type = 'table' order by name",
    )
    assert.deepEqual(
      rows.map((row) => row.name),
      ["a", "b"],
    )

    // DatabaseSync.prepare() compilaria só o primeiro statement e ignoraria o resto em silêncio.
    await assert.rejects(
      () => driver.run("create table c (x); create table d (y)"),
      /run\(\) accepts one statement at a time; use exec\(\)/,
    )
    await assert.rejects(
      () => driver.query("select 1; select 2"),
      /query\(\) accepts one statement at a time; use exec\(\)/,
    )
    const tables = await driver.query(
      "select name from sqlite_master where type = 'table' order by name",
    )
    assert.deepEqual(
      tables.map((row) => row.name),
      ["a", "b"],
    )
  } finally {
    await driver.close()
  }
})

test(":memory: aceita também file::memory: e close é idempotente", async () => {
  const driver = sqliteDriver({ file: "file::memory:" })
  const exec = driver.exec
  assert.ok(exec)
  await exec("create table only_memory (x)")
  await driver.close()
  await driver.close()
})

test("caminho relativo é resolvido a partir do diretório atual", async () => {
  const dir = tempDir()
  const previous = process.cwd()
  try {
    process.chdir(dir)
    const driver = sqliteDriver({ file: join(".", "data", "dev.sqlite") })
    try {
      await driver.run("create table t (x)")
    } finally {
      await driver.close()
    }
    assert.equal(existsSync(join(dir, "data", "dev.sqlite")), true)
  } finally {
    process.chdir(previous)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("arquivo: cria diretórios, usa WAL e persiste", async () => {
  const dir = tempDir()
  const file = join(dir, "nested", "deep", "dev.sqlite")
  try {
    const driver = sqliteDriver({ file })
    try {
      assert.equal(existsSync(file), true)
      const journal = await driver.query("pragma journal_mode")
      assert.deepEqual({ ...journal[0] }, { journal_mode: "wal" })

      await driver.run("create table notes (body text)")
      await driver.run("insert into notes (body) values (?)", ["persistido"])
    } finally {
      await driver.close()
    }

    const reopened = sqliteDriver({ file })
    try {
      const rows = await reopened.query("select body from notes")
      assert.deepEqual(
        rows.map((row) => row.body),
        ["persistido"],
      )
    } finally {
      await reopened.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("url file:// aceita URLs absolutas", async () => {
  const dir = tempDir()
  const file = join(dir, "url.sqlite")
  try {
    const driver = sqliteDriver({ file: pathToFileURL(file).href })
    try {
      await driver.run("create table t (x)")
    } finally {
      await driver.close()
    }
    assert.equal(existsSync(file), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("url vazia falha com erro didático", () => {
  assert.throws(() => sqliteDriver({ file: "  " }), /database url is empty/)
})

test("queryArrays devolve linhas posicionais e query segue devolvendo objetos", async () => {
  const driver = sqliteDriver({ file: ":memory:" })
  try {
    const queryArrays = driver.queryArrays
    assert.ok(queryArrays, "sqliteDriver deve expor queryArrays (setReturnArrays)")

    // Nomes repetidos: a leitura posicional preserva todos os valores, na ordem das colunas.
    assert.deepEqual(await queryArrays("select 1 as id, 2 as uid, 3 as id"), [[1, 2, 3]])
    assert.deepEqual(await queryArrays("select ? as a, ? as b, ? as a", ["x", 7, "x"]), [
      ["x", 7, "x"],
    ])

    // O contrato §4.1 continua: query() devolve objetos indexados pelo nome da coluna.
    const objects = await driver.query("select 1 as id, 2 as uid, 3 as id")
    assert.deepEqual({ ...objects[0] }, { id: 3, uid: 2 })

    await assert.rejects(
      () => queryArrays("select 1; select 2"),
      /queryArrays\(\) accepts one statement at a time; use exec\(\)/,
    )
  } finally {
    await driver.close()
  }
})

test("resolveSqliteFile lida com formas de URL de borda", async () => {
  // file::memory: com query string → :memory:
  const memory = sqliteDriver({ file: "file::memory:?cache=shared" })
  await memory.run("create table m (x)")
  await memory.close()

  // file: relativo com percent-encoding é decodificado.
  const dir = tempDir()
  const spaced = join(dir, "db x", "dev.sqlite")
  try {
    const driver = sqliteDriver({ file: `file:${spaced.replace(/ /g, "%20")}` })
    try {
      await driver.run("create table t (x)")
    } finally {
      await driver.close()
    }
    assert.equal(existsSync(spaced), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  assert.throws(
    () => sqliteDriver({ file: "file://server/share/dev.sqlite" }),
    /unsupported host "server"/,
  )
  assert.throws(() => sqliteDriver({ file: "file://./x.sqlite" }), /unsupported host "\."/)
})
