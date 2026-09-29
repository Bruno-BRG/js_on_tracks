import assert from "node:assert/strict"
import { test } from "node:test"
import { paths } from "./paths"
import { type ActionRef, type ResourceAction, routes } from "./routes"

test("r.root define GET / e o helper paths.root()", () => {
  const table = routes((r) => {
    r.root("home#index")
  })
  assert.equal(table.definitions.length, 1)
  assert.deepEqual(
    { ...table.definitions[0] },
    {
      method: "GET",
      path: "/",
      controller: "home",
      controllerKey: "Home",
      action: "index",
      as: "root",
    },
  )
  assert.equal(paths.root(), "/")
})

test("as custom define o helper", () => {
  const table = routes((r) => {
    r.get("/about", "pages#about", { as: "about" })
  })
  assert.equal(table.definitions.length, 1)
  const definition = table.definitions.at(0)
  assert.ok(definition)
  assert.equal(definition.controllerKey, "Pages")
  assert.equal(paths.about(), "/about")
})

test("r.resource('posts') expande 8 definições (7 actions) na ordem certa", () => {
  const table = routes((r) => {
    r.resource("posts")
  })
  assert.equal(table.definitions.length, 8)
  assert.deepEqual(
    table.definitions.map((definition) => `${definition.method} ${definition.path}`),
    [
      "GET /posts",
      "GET /posts/new",
      "POST /posts",
      "GET /posts/:id",
      "GET /posts/:id/edit",
      "PUT /posts/:id",
      "PATCH /posts/:id",
      "DELETE /posts/:id",
    ],
  )
  assert.deepEqual(
    [...new Set(table.definitions.map((definition) => definition.action))],
    ["index", "new", "create", "show", "edit", "update", "destroy"],
  )
  for (const definition of table.definitions) {
    assert.equal(definition.controller, "posts")
    assert.equal(definition.controllerKey, "Posts")
  }
})

test("helpers do resource: paths.posts/newPost/post/editPost; sem helpers em create/update/destroy", () => {
  routes((r) => {
    r.resource("posts")
  })
  assert.equal(paths.posts(), "/posts")
  assert.equal(paths.newPost(), "/posts/new")
  assert.equal(paths.post(3), "/posts/3")
  assert.equal(paths.post({ id: 9 }), "/posts/9")
  assert.equal(paths.editPost(4), "/posts/4/edit")
  assert.equal("createPost" in paths, false)
  assert.equal("updatePost" in paths, false)
  assert.equal("destroyPost" in paths, false)
})

test("helpers codificam valores e aceitam múltiplos params", () => {
  routes((r) => {
    r.resource("posts")
    r.get("/teams/:teamId/members/:memberId", "members#show", { as: "teamMember" })
  })
  assert.equal(paths.post("a b"), "/posts/a%20b")
  assert.equal(paths.teamMember({ teamId: 1, memberId: 2 }), "/teams/1/members/2")
  assert.equal(paths.teamMember({ teamId: "a/b", memberId: "x y" }), "/teams/a%2Fb/members/x%20y")
})

test("helper com param faltando lança erro didático", () => {
  routes((r) => {
    r.resource("posts")
  })
  assert.throws(
    () => paths.post(),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /paths\.post\(\) is missing the parameter "id"/)
      assert.match(error.message, /paths\.post\(1\)/)
      return true
    },
  )
  assert.throws(() => paths.post({}), /is missing the parameter "id"/)
})

test("helper com múltiplos params exige objeto", () => {
  routes((r) => {
    r.get("/teams/:teamId/members/:memberId", "members#show", { as: "teamMember" })
  })
  assert.throws(() => paths.teamMember(1), /a single value is not enough/)
  assert.throws(() => paths.teamMember({ teamId: 1 }), /is missing the parameter "memberId"/)
  assert.throws(
    () => paths.teamMember({ teamId: 1, memberId: {} as unknown as number }),
    /expected a string or number for "memberId"/,
  )
})

test("resource com only filtra por action (update inclui PUT+PATCH)", () => {
  const table = routes((r) => {
    r.resource("posts", { only: ["index", "show"] })
  })
  assert.deepEqual(
    table.definitions.map((definition) => `${definition.method} ${definition.path}`),
    ["GET /posts", "GET /posts/:id"],
  )
  assert.equal(paths.posts(), "/posts")
  assert.equal(paths.post(1), "/posts/1")
  assert.equal("newPost" in paths, false)
})

test("resource com except remove actions", () => {
  const table = routes((r) => {
    r.resource("posts", { except: ["destroy"] })
  })
  assert.equal(table.definitions.length, 7)
  assert.equal(
    table.definitions.some((definition) => definition.method === "DELETE"),
    false,
  )
})

test("CSRF exemption de resource só é propagada para métodos mutáveis", () => {
  const reason = "Verify the provider signature"
  const table = routes((r) => {
    r.resource("posts", {
      only: ["index", "create", "update", "destroy"],
      csrf: { exempt: true, reason },
    })
  })
  assert.deepEqual(
    table.definitions.map((definition) => [definition.method, definition.csrf?.reason ?? null]),
    [
      ["GET", null],
      ["POST", reason],
      ["PUT", reason],
      ["PATCH", reason],
      ["DELETE", reason],
    ],
  )
})

test("CSRF exemption exige explicitamente uma razão não vazia", () => {
  assert.throws(
    () =>
      routes((r) => {
        r.post("/webhook", "webhooks#create", { csrf: { exempt: true, reason: "  " } })
      }),
    /requires a non-empty reason/,
  )
})

test("resource com only e except juntos é erro", () => {
  assert.throws(
    () =>
      routes((r) => {
        r.resource("posts", { only: ["index"], except: ["destroy"] })
      }),
    /cannot use "only" and "except" together/,
  )
})

test("resource com action desconhecida é erro", () => {
  assert.throws(
    () =>
      routes((r) => {
        r.resource("posts", { only: ["nope" as unknown as ResourceAction] })
      }),
    /Unknown resource action "nope"/,
  )
})

test("resource namespaced gera helpers CamelCase", () => {
  const table = routes((r) => {
    r.resource("admin/posts")
  })
  const definition = table.definitions.at(0)
  assert.ok(definition)
  assert.equal(definition.controller, "admin/posts")
  assert.equal(definition.controllerKey, "Admin/Posts")
  assert.equal(definition.path, "/admin/posts")
  assert.equal(paths.adminPosts(), "/admin/posts")
  assert.equal(paths.newAdminPost(), "/admin/posts/new")
  assert.equal(paths.adminPost(5), "/admin/posts/5")
  assert.equal(paths.editAdminPost(5), "/admin/posts/5/edit")
})

test("rotas duplicadas (METHOD path) são erro didático", () => {
  assert.throws(
    () =>
      routes((r) => {
        r.get("/x", "a#b")
        r.get("/x", "c#d")
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Duplicate route GET \/x/)
      assert.match(error.message, /config\/routes\.ts/)
      return true
    },
  )
})

test("helpers duplicados são erro didático", () => {
  assert.throws(
    () =>
      routes((r) => {
        r.get("/x", "a#b", { as: "dup" })
        r.get("/y", "c#d", { as: "dup" })
      }),
    /Duplicate route helper "paths\.dup"/,
  )
})

test("targets e paths inválidos são erro didático", () => {
  assert.throws(
    () => routes((r) => r.get("/x", "index" as ActionRef)),
    /Invalid route target "index"/,
  )
  assert.throws(() => routes((r) => r.get("posts", "a#b")), /Paths must start with "\/"/)
  assert.throws(() => routes((r) => r.resource("")), /needs a resource name/)
  assert.throws(() => routes((r) => r.resource("posts!")), /Invalid resource name/)
})

test("paths é um Proxy didático para helpers inexistentes", () => {
  routes((r) => {
    r.root("home#index")
  })
  assert.throws(
    () => paths.doesNotExist(),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Route helper "paths\.doesNotExist" is not defined/)
      assert.match(error.message, /config\/routes\.ts/)
      assert.match(error.message, /jot server/)
      return true
    },
  )
})
