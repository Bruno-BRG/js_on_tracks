import assert from "node:assert/strict"
import { test } from "node:test"
import {
  assertUniqueIdents,
  camelCase,
  controllerIdent,
  controllerKey,
  pascalCase,
  viewIdent,
  viewKey,
} from "./naming"
import { CliError } from "./output"

test("controller keys follow the folder + PascalCase convention", () => {
  assert.equal(controllerKey("home_controller.ts"), "Home")
  assert.equal(controllerKey("admin/posts_controller.ts"), "Admin/Posts")
  assert.equal(controllerKey("admin/sub/posts_controller.ts"), "Admin/Sub/Posts")
})

test("view keys are the relative path without extension", () => {
  assert.equal(viewKey("posts/index.tsx"), "posts/index")
  assert.equal(viewKey("layouts/application.tsx"), "layouts/application")
})

test("import idents", () => {
  assert.equal(viewIdent("posts/index"), "postsIndex")
  assert.equal(viewIdent("layouts/application"), "layoutsApplication")
  assert.equal(controllerIdent("Admin/Posts"), "AdminPostsController")
  assert.equal(controllerIdent("Home"), "HomeController")
})

test("pascalCase/camelCase normalize separators", () => {
  assert.equal(pascalCase("home_controller"), "HomeController")
  assert.equal(pascalCase("blog-posts"), "BlogPosts")
  assert.equal(camelCase("admin/posts_index"), "adminPostsIndex")
})

test("colliding import names throw a didactic error", () => {
  assert.throws(
    () =>
      assertUniqueIdents([
        { file: "app/views/a.tsx", ident: "aIndex" },
        { file: "app/views/b.tsx", ident: "aIndex" },
      ]),
    (error: unknown) =>
      error instanceof CliError &&
      error.message ===
        'Generated import name collision between "app/views/a.tsx" and "app/views/b.tsx". Rename one of them.',
  )
  assert.doesNotThrow(() =>
    assertUniqueIdents([
      { file: "app/views/a.tsx", ident: "aIndex" },
      { file: "app/views/b.tsx", ident: "bIndex" },
    ]),
  )
})
