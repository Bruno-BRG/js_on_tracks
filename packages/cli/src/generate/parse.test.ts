import assert from "node:assert/strict"
import { test } from "node:test"
import { CliError } from "../output"
import { FIELD_TYPES, parseField } from "./fields"
import { pluralize, resourceNames, singularize, snakeCase } from "./naming"
import { buildResource } from "./parse"

const VALID_TYPES = FIELD_TYPES.join(", ")

test("resource names accept singular, plural and PascalCase", () => {
  for (const raw of ["post", "Post", "posts", "Posts"]) {
    const names = resourceNames(raw)
    assert.equal(names.table, "posts", raw)
    assert.equal(names.singular, "post", raw)
    assert.equal(names.singularIdent, "Post", raw)
    assert.equal(names.pluralIdent, "Posts", raw)
    assert.equal(names.controllerFile, "posts_controller.ts", raw)
    assert.equal(names.controllerClass, "PostsController", raw)
    assert.equal(names.viewsDir, "posts", raw)
    assert.equal(names.helper, "post", raw)
    assert.equal(names.helperPlural, "posts", raw)
  }

  const blog = resourceNames("blog_post")
  assert.equal(blog.table, "blog_posts")
  assert.equal(blog.singular, "blog_post")
  assert.equal(blog.singularFile, "blog_post")
  assert.equal(blog.singularIdent, "BlogPost")
  assert.equal(blog.controllerFile, "blog_posts_controller.ts")
  assert.equal(blog.helper, "blogPost")
  assert.equal(blog.helperPlural, "blogPosts")

  const buses = resourceNames("buses")
  assert.equal(buses.table, "buses")
  assert.equal(buses.singular, "bus")
})

test("pluralize/singularize mirror the core rules", () => {
  assert.equal(pluralize("post"), "posts")
  assert.equal(pluralize("story"), "stories")
  assert.equal(pluralize("box"), "boxes")
  assert.equal(singularize("posts"), "post")
  assert.equal(singularize("stories"), "story")
  assert.equal(singularize("boxes"), "box")
  assert.equal(snakeCase("BlogPost"), "blog_post")
  assert.equal(snakeCase("Posts"), "posts")
})

test("invalid names fail with the namespaced hint", () => {
  for (const raw of ["9posts", "admin/posts", "post-name", "__post"]) {
    assert.throws(
      () => buildResource(raw, []),
      (error: unknown) =>
        error instanceof CliError &&
        error.message ===
          `Invalid name "${raw}". Use letters, numbers and underscores, e.g. "post" or "blog_post". ` +
            "Namespaced generators (admin/posts) are not supported yet.",
    )
  }
})

test("field matrix normalizes names, columns and nullability", () => {
  const title = parseField("title:string!")
  assert.deepEqual(
    {
      name: title.name,
      column: title.column,
      label: title.label,
      type: title.type,
      notNull: title.notNull,
    },
    { name: "title", column: "title", label: "Title", type: "string", notNull: true },
  )

  const author = parseField("author_id:integer")
  assert.equal(author.name, "authorId")
  assert.equal(author.column, "author_id")
  assert.equal(author.label, "Author id")
  assert.equal(author.notNull, false)

  assert.equal(parseField("body:text").type, "text")
  assert.equal(parseField("score:real").type, "real")
  assert.equal(parseField("price:decimal").type, "decimal")
  assert.equal(parseField("meta:json").type, "json")
  assert.equal(parseField("published:boolean!").notNull, true)
})

test("field errors are didactic", () => {
  assert.throws(
    () => parseField("title"),
    (error: unknown) =>
      error instanceof CliError &&
      error.message ===
        `Invalid field "title". Use \`name:type\`, for example \`title:string!\`. Valid types: ${VALID_TYPES}.`,
  )
  assert.throws(
    () => parseField("title:strng"),
    (error: unknown) =>
      error instanceof CliError &&
      error.message ===
        `Invalid field "title:strng". Unknown type "strng". Valid types: ${VALID_TYPES}.`,
  )
  assert.throws(
    () => parseField("1x:string"),
    (error: unknown) =>
      error instanceof CliError &&
      error.message ===
        'Invalid field name "1x". Use letters, numbers and underscores (e.g. "title" or "author_id").',
  )
  assert.throws(
    () => parseField("id:integer"),
    (error: unknown) =>
      error instanceof CliError &&
      error.message ===
        'Field "id" is reserved: `id()` already declares the primary key for every table.',
  )
  for (const reserved of ["created_at", "updated_at", "createdAt"]) {
    assert.throws(
      () => parseField(`${reserved}:string`),
      (error: unknown) =>
        error instanceof CliError &&
        error.message ===
          `Field "${reserved}" is reserved: \`timestamps()\` already adds createdAt/updatedAt.`,
    )
  }
  for (const alias of ["createdAT", "updatedAT"]) {
    assert.throws(
      () => parseField(`${alias}:integer`),
      (error: unknown) => error instanceof CliError && error.message.includes("timestamps()"),
    )
  }
  assert.throws(
    () => parseField("Id:string"),
    (error: unknown) => error instanceof CliError && error.message.includes("id()"),
  )
})

test("fields cannot shadow Model/Object members or reserved bindings", () => {
  for (const name of [
    "constructor",
    "errors",
    "isValid",
    "save",
    "update",
    "destroy",
    "then",
    "toString",
    "hasOwnProperty",
    "await",
    "class",
    "default",
  ]) {
    assert.throws(
      () => buildResource("post", [`${name}:string!`]),
      (error: unknown) =>
        error instanceof CliError &&
        (error.message.includes("@jot/orm Model API") ||
          error.message.includes("reserved by JavaScript/TypeScript")),
      name,
    )
  }
})

test("resource bindings reject ECMAScript strict and ESM reserved words", () => {
  for (const name of ["class", "await", "new", "default", "interface", "eval", "yield"]) {
    assert.throws(
      () => buildResource(name, []),
      (error: unknown) =>
        error instanceof CliError &&
        error.message.includes("generated binding") &&
        error.message.includes("reserved by JavaScript/TypeScript"),
      name,
    )
  }
  // The raw name is not itself a binding; generated identifiers are what matter.
  assert.equal(buildResource("async", []).names.table, "asyncs")
})

test("duplicate fields (including snake→camel collisions) fail", () => {
  assert.throws(
    () => buildResource("post", ["title:string", "title:string!"]),
    (error: unknown) =>
      error instanceof CliError &&
      error.message === 'Duplicate field "title". Remove one of the declarations.',
  )
  assert.throws(
    () => buildResource("post", ["author_id:string", "authorId:integer"]),
    (error: unknown) =>
      error instanceof CliError &&
      error.message === 'Duplicate field "authorId". Remove one of the declarations.',
  )
  assert.throws(
    () => buildResource("post", ["fooBar:string", "fooBAR:integer"]),
    (error: unknown) =>
      error instanceof CliError &&
      error.message ===
        'Fields "fooBar" and "fooBAR" both map to SQL column "foo_bar". Rename one before generating.',
  )
})

test("buildResource keeps field order and allows zero fields", () => {
  const resource = buildResource("post", ["title:string!", "body:text"])
  assert.deepEqual(
    resource.fields.map((field) => field.name),
    ["title", "body"],
  )
  assert.deepEqual(buildResource("post", []).fields, [])
})
