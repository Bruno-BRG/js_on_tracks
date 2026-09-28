import assert from "node:assert/strict"
import { test } from "node:test"
import { CliError } from "../output"
import {
  findMatchingBrace,
  insertResource as insertResourceAst,
  insertTable,
  lineOf,
  maskComments,
  maskSource,
} from "./insert"
import { buildResource } from "./parse"

const TEMPLATE_SCHEMA = [
  "// Schema do banco. Exemplo:",
  "//",
  '// import { table, id, string, text, boolean, timestamps } from "jot-framework"',
  "//",
  '// export const posts = table("posts", {',
  "//   id: id(),",
  "//   title: string().notNull(),",
  "//   body: text(),",
  "//   published: boolean().default(false),",
  "//   ...timestamps(),",
  "// })",
  "",
  "export {}",
  "",
].join("\n")

const EXPECTED_SCHEMA = [
  'import { table, id, string, text, boolean, timestamps } from "jot-framework"',
  "",
  "// Schema do banco. Exemplo:",
  "//",
  '// import { table, id, string, text, boolean, timestamps } from "jot-framework"',
  "//",
  '// export const posts = table("posts", {',
  "//   id: id(),",
  "//   title: string().notNull(),",
  "//   body: text(),",
  "//   published: boolean().default(false),",
  "//   ...timestamps(),",
  "// })",
  "",
  'export const posts = table("posts", {',
  "  id: id(),",
  "  title: string().notNull(),",
  "  body: text(),",
  "  published: boolean().default(false),",
  "  ...timestamps(),",
  "})",
  "",
].join("\n")

const POST = buildResource("post", ["title:string!", "body:text", "published:boolean"])

async function runInsertResource(source: string, resource = POST): Promise<string> {
  const eol = source.includes("\r\n") ? "\r\n" : "\n"
  const withDefaultExport = source.includes("export default routes(")
    ? source
    : source.replace(/\broutes\s*\(/, "export default routes(")
  const withRoutesImport = withDefaultExport.includes('from "jot-framework"')
    ? withDefaultExport
    : `${withDefaultExport}${withDefaultExport.endsWith(eol) ? "" : eol}import { routes } from "jot-framework"${eol}`
  return insertResourceAst(withRoutesImport, resource, process.cwd())
}

test("insertTable adds the import, drops export {} and appends the table", () => {
  assert.equal(insertTable(TEMPLATE_SCHEMA, POST), EXPECTED_SCHEMA)
})

test("insertTable merges the jot-framework import preserving the existing order", () => {
  const source = ['import { table, string } from "jot-framework"', "", "export {}", ""].join("\n")
  const result = insertTable(source, POST)
  assert.equal(
    result,
    [
      'import { table, string, id, text, boolean, timestamps } from "jot-framework"',
      "",
      'export const posts = table("posts", {',
      "  id: id(),",
      "  title: string().notNull(),",
      "  body: text(),",
      "  published: boolean().default(false),",
      "  ...timestamps(),",
      "})",
      "",
    ].join("\n"),
  )
})

test("insertTable builds the import from scratch when there is none", () => {
  const result = insertTable("export {}\n", buildResource("post", ["title:text"]))
  assert.equal(
    result,
    [
      'import { table, id, text, timestamps } from "jot-framework"',
      "",
      'export const posts = table("posts", {',
      "  id: id(),",
      "  title: text(),",
      "  ...timestamps(),",
      "})",
      "",
    ].join("\n"),
  )
})

test("insertTable preserves CRLF in the edited file", () => {
  const source = ['import { table } from "jot-framework"', "", "export {}", ""].join("\r\n")
  const result = insertTable(source, buildResource("post", ["body:text"]))
  assert.ok(result.includes("\r\n"))
  assert.ok(!/[^\r]\n/.test(result), "toda quebra de linha editada deve ser CRLF")
  assert.match(result, /\.\.\.timestamps\(\),\r\n\}\)\r\n$/)
})

test("insertTable refuses duplicates (identifier or table call) with the line", () => {
  assert.throws(
    () => insertTable('export const posts = table("posts", {})\n', POST),
    (error: unknown) =>
      error instanceof CliError &&
      error.message ===
        'db/schema.ts already defines table "posts" (line 1). Remove it or pick another name.',
  )
  assert.throws(
    () => insertTable('const posts = table("posts", {})\n', POST),
    (error: unknown) =>
      error instanceof CliError &&
      error.message ===
        'db/schema.ts already defines table "posts" (line 1). Remove it or pick another name.',
  )
})

test("insertTable ignores table names inside comments and strings", () => {
  const commented = '// export const posts = table("posts", {})\n\nexport {}\n'
  assert.match(insertTable(commented, POST), /export const posts = table\("posts"/)
  const stringy = "const docs = 'table(\"posts\")'\n\nexport {}\n"
  assert.match(insertTable(stringy, POST), /export const posts/)
})

test("insertResource inserts before the closing brace with the block indent", async () => {
  const source = [
    'import { routes } from "jot-framework"',
    "",
    "export default routes((r) => {",
    '  r.root("home#index")',
    "})",
    "",
  ].join("\n")
  assert.equal(
    await runInsertResource(source),
    [
      'import { routes } from "jot-framework"',
      "",
      "export default routes((r) => {",
      '  r.root("home#index")',
      '  r.resource("posts")',
      "})",
      "",
    ].join("\n"),
  )
})

test("insertResource supports arrow variants and differently named builder parameters", async () => {
  const arrow = 'routes(r => {\n  r.root("home#index")\n})\n'
  assert.match(
    await runInsertResource(arrow),
    /r\.root\("home#index"\)\n {2}r\.resource\("posts"\)\n\}\)/,
  )

  const router = 'routes((router) => {\n\trouter.root("home#index")\n})\n'
  assert.match(
    await runInsertResource(router),
    /router\.root\("home#index"\)\n\trouter\.resource\("posts"\)\n\}\)/,
  )
})

test("insertResource expands an empty builder block", async () => {
  const result = await runInsertResource("routes((r) => {})\n")
  assert.equal(
    result,
    'export default routes((r) => {\n  r.resource("posts")\n})\nimport { routes } from "jot-framework"\n',
  )
})

test("insertResource preserves CRLF", async () => {
  const source = 'routes((r) => {\r\n  r.root("home#index")\r\n})\r\n'
  const result = await runInsertResource(source)
  assert.ok(result.includes('\r\n  r.resource("posts")\r\n'))
  assert.ok(!/[^\r]\n/.test(result))
})

test("insertResource refuses duplicate resources, paths, and routes with the line", async () => {
  await assert.rejects(
    runInsertResource('routes((r) => {\n  r.resource("posts")\n})\n'),
    (error: unknown) =>
      error instanceof CliError &&
      error.message ===
        'config/routes.ts already has r.resource("posts") (line 2). Remove it first.',
  )
  await assert.rejects(
    runInsertResource('routes((r) => {\n  r.get("/:slug", "pages#show")\n})\n'),
    (error: unknown) => error instanceof CliError && error.message.includes("/:slug"),
  )
  await assert.rejects(
    runInsertResource('routes((r) => {\n  r.get("/posts", "posts#index")\n})\n'),
    (error: unknown) =>
      error instanceof CliError &&
      error.message ===
        'config/routes.ts already mentions "/posts" (line 2). Remove the conflicting route or add r.resource("posts") manually.',
  )
  await assert.rejects(
    runInsertResource('routes((router) => {\n  router.resource("posts")\n})\n'),
    (error: unknown) =>
      error instanceof CliError &&
      error.message ===
        'config/routes.ts already has router.resource("posts") (line 2). Remove it first.',
  )
})

test("insertResource ignores documented route examples and string contents", async () => {
  const source = [
    "const example = 'r.resource(\\\"posts\\\")'",
    'const pathExample = "GET /posts/:id"',
    "routes((r) => {",
    '  r.get("/about", "pages#about")',
    "})",
    "",
  ].join("\n")
  assert.match(await runInsertResource(source), /r\.resource\("posts"\)/)
})

test("insertResource detects generated helper collisions with root and aliases", async () => {
  const rootResource = buildResource("root", [])
  await assert.rejects(
    runInsertResource('routes((r) => {\n  r.root("home#index")\n})\n', rootResource),
    (error: unknown) =>
      error instanceof CliError &&
      error.message.includes('route helper "root"') &&
      error.message.includes('r.resource("roots")'),
  )

  const customAlias = [
    "routes((router) => {",
    '  router.get("/about", "pages#show", { as: "post" })',
    "})",
    "",
  ].join("\n")
  await assert.rejects(
    runInsertResource(customAlias),
    (error: unknown) =>
      error instanceof CliError &&
      error.message.includes('route helper "post"') &&
      error.message.includes("line 2"),
  )

  for (const helper of ["posts", "newPost", "post", "editPost"]) {
    const aliasRoute = `routes((r) => {\n  r.get("/custom-${helper}", "pages#show", { as: "${helper}" })\n})\n`
    await assert.rejects(
      runInsertResource(aliasRoute),
      (error: unknown) =>
        error instanceof CliError && error.message.includes(`route helper "${helper}"`),
      helper,
    )
  }

  const constantAlias = [
    'const generatedHelper = "post"',
    "routes((r) => {",
    '  r.get("/custom", "pages#show", { as: generatedHelper })',
    "})",
    "",
  ].join("\n")
  await assert.rejects(
    runInsertResource(constantAlias),
    (error: unknown) => error instanceof CliError && error.message.includes('route helper "post"'),
  )
  await assert.rejects(
    runInsertResource(
      'routes((r) => {\n  r.get("/custom", "pages#show", { as: getCustomHelper() })\n})\n',
    ),
    (error: unknown) => error instanceof CliError && error.message.includes("dynamic route helper"),
  )
})

test("insertResource resolves const resources and static or computed helper keys", async () => {
  const existingResource = [
    'const existingResource = "posts";',
    "routes((r) => {",
    "  r.resource(existingResource)",
    "})",
    "",
  ].join("\n")
  await assert.rejects(
    runInsertResource(existingResource),
    (error: unknown) =>
      error instanceof CliError &&
      error.message.includes('already has r.resource("posts")') &&
      error.message.includes("line 3"),
  )

  for (const key of ['"as"', "'as'", '["as"]']) {
    const source = `routes((r) => {\n  r.get("/custom", "pages#show", { ${key}: "post" })\n})\n`
    await assert.rejects(
      runInsertResource(source),
      (error: unknown) =>
        error instanceof CliError &&
        error.message.includes('route helper "post"') &&
        error.message.includes("line 2"),
      key,
    )
  }

  const distinctConstResource = [
    'const existingResource = "comments";',
    "routes((r) => {",
    "  r.resource(existingResource)",
    "})",
    "",
  ].join("\n")
  assert.match(await runInsertResource(distinctConstResource), /r\.resource\("posts"\)/)
})

test("AST route preflight distinguishes regex literals from division expressions", async () => {
  const documentary = [
    'const example = /r.resource("posts")/;',
    "routes((router) => {",
    '  router.root("home#index")',
    "})",
    "",
  ].join("\n")
  assert.match(await runInsertResource(documentary), /router\.resource\("posts"\)/)

  const division = [
    "let i = 0",
    "export default routes((r) => {",
    '  i++ / (r.resource("posts") as unknown as number)',
    "})",
    "",
  ].join("\n")
  await assert.rejects(
    runInsertResource(division),
    (error: unknown) =>
      error instanceof CliError && /Cannot safely analyze config\/routes\.ts/.test(error.message),
  )
})

test("insertResource fails closed for dynamic routes, templates, computed methods, and wrappers", async () => {
  const rejected = [
    "routes((r) => {\n  r.resource(getResource())\n})\n",
    'routes((r) => {\n  r.get("/" + section, "pages#index")\n})\n',
    'const existingResource = "posts" + suffix;\nroutes((r) => {\n  r.resource(existingResource)\n})\n',
    'const method = "resource";\nroutes((r) => {\n  r[method]("posts")\n})\n',
    "routes((r) => {\n  const doc = `$" + '{r.resource("posts")}`\n})\n',
    'import { addRoutes } from "./route-helpers";\nroutes((r) => {\n  addRoutes(r)\n})\n',
    'routes((r) => {\n  const existingResource = "comments";\n  function add(existingResource: string) { r.resource(existingResource) }\n  add("posts")\n})\n',
    'routes((r) => {\n  const addResource = r.resource\n  addResource("posts")\n})\n',
  ]
  for (const source of rejected) {
    await assert.rejects(
      runInsertResource(source),
      (error: unknown) =>
        error instanceof CliError &&
        /Cannot safely analyze config\/routes\.ts|dynamic resource name|dynamic route path/.test(
          error.message,
        ) &&
        /Simplify|Use a string literal/.test(error.message),
      source,
    )
  }
})

test("insertResource requires an unambiguous routes callback", async () => {
  await assert.rejects(
    runInsertResource("export default routes([])\n"),
    (error: unknown) =>
      error instanceof CliError && /Cannot safely analyze config\/routes\.ts/.test(error.message),
  )
})
test("masking/brace helpers keep offsets", () => {
  const source = 'const a = "text { }"\n// r.resource("posts")\nr.resource("note")\n'
  assert.equal(maskSource(source).length, source.length)
  assert.equal(maskComments(source).length, source.length)
  assert.ok(!maskSource(source).includes("{"))
  assert.match(maskComments(source), /r\.resource\("note"\)/)
  assert.ok(!maskComments(source).includes('r.resource("posts")'))
  assert.equal(lineOf(source, source.indexOf('r.resource("note")')), 3)
  assert.equal(lineOf(source, 0), 1)
  assert.equal(findMatchingBrace("a { b { c } d } e", 2), 14)
})
