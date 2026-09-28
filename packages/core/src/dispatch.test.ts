import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { jsx } from "@jot/views/jsx-runtime"
import { Controller } from "./controller"
import { __clearRegistries, registerControllers, registerViews } from "./registry"
import { routes } from "./routes"
import { createApp } from "./server"

const root = mkdtempSync(join(tmpdir(), "jot-dispatch-"))
const SECRET = "test-secret"

test("index recebe query; show recebe route param", async () => {
  __clearRegistries()
  class WidgetsController extends Controller {
    index() {
      return this.json({ q: this.query.q ?? null, kind: typeof this.query.q })
    }
    show() {
      return this.json({ id: this.params.id ?? null })
    }
  }
  registerControllers({ Widgets: WidgetsController })
  const app = createApp({
    routes: routes((r) => {
      r.resource("widgets", { only: ["index", "show"] })
    }),
    root,
    secret: SECRET,
  })

  const index = await app.request("/widgets?q=hello")
  assert.equal(index.status, 200)
  assert.match(index.headers.get("content-type") ?? "", /^application\/json/)
  assert.deepEqual(await index.json(), { q: "hello", kind: "string" })

  const show = await app.request("/widgets/42")
  assert.equal(show.status, 200)
  assert.deepEqual(await show.json(), { id: "42" })
})

test("POST urlencoded: body parseado e params mesclados (route > body > query)", async () => {
  __clearRegistries()
  class WidgetsController extends Controller {
    create() {
      return this.json({ params: this.params, query: this.query, body: this.body })
    }
  }
  registerControllers({ Widgets: WidgetsController })
  const app = createApp({
    routes: routes((r) => {
      r.post("/widgets/:id", "widgets#create")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/widgets/7?tag=from-query&q=1", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "id=from-body&title=Hello&tag=from-body",
  })
  assert.equal(response.status, 200)
  const data = (await response.json()) as {
    params: Record<string, string>
    query: Record<string, string>
    body: Record<string, unknown>
  }
  assert.equal(data.params.id, "7") // route param vence
  assert.equal(data.params.tag, "from-body") // body vence query
  assert.equal(data.params.title, "Hello")
  assert.equal(data.params.q, "1") // query entra no merge
  assert.deepEqual(data.query, { tag: "from-query", q: "1" })
  assert.deepEqual(data.body, { id: "from-body", title: "Hello", tag: "from-body" })
})

test("retorno undefined faz render automático da view convencional", async () => {
  __clearRegistries()
  class WidgetsController extends Controller {
    index() {}
  }
  registerControllers({ Widgets: WidgetsController })
  registerViews({
    "widgets/index": function widgetsIndex() {
      return jsx("p", { children: "auto-rendered" })
    },
    "layouts/application": function applicationLayout(props: { children?: unknown }) {
      return jsx("main", { children: props.children })
    },
  })
  const app = createApp({
    routes: routes((r) => {
      r.resource("widgets", { only: ["index"] })
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/widgets")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
  assert.equal(await response.text(), "<main><p>auto-rendered</p></main>")
})

test("_method=delete: re-dispatch para destroy e body sem _method", async () => {
  __clearRegistries()
  class WidgetsController extends Controller {
    destroy() {
      return this.json({ method: this.request.req.method, params: this.params, body: this.body })
    }
  }
  registerControllers({ Widgets: WidgetsController })
  const app = createApp({
    routes: routes((r) => {
      r.resource("widgets", { only: ["destroy"] })
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/widgets/7?from=query", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "_method=delete&title=Hello",
  })
  assert.equal(response.status, 200)
  const data = (await response.json()) as {
    method: string
    params: Record<string, string>
    body: Record<string, unknown>
  }
  assert.equal(data.method, "DELETE")
  assert.equal(data.params.id, "7")
  assert.equal(data.params.title, "Hello")
  assert.equal(data.params.from, "query")
  assert.equal("_method" in data.body, false)
  assert.deepEqual(data.body, { title: "Hello" })
})

test("_method=patch (minúsculo) faz re-dispatch para update, sem 404", async () => {
  __clearRegistries()
  class WidgetsController extends Controller {
    update() {
      return this.json({ method: this.request.req.method, body: this.body })
    }
  }
  registerControllers({ Widgets: WidgetsController })
  const app = createApp({
    routes: routes((r) => {
      r.resource("widgets", { only: ["update"] })
    }),
    root,
    secret: SECRET,
  })

  const patch = await app.request("/widgets/1", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "_method=patch&title=Edited",
  })
  assert.equal(patch.status, 200)
  assert.deepEqual(await patch.json(), { method: "PATCH", body: { title: "Edited" } })

  const put = await app.request("/widgets/1", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "_method=PUT&title=Edited",
  })
  assert.equal(put.status, 200)
  assert.deepEqual(await put.json(), { method: "PUT", body: { title: "Edited" } })
})

test("json aceita status customizado", async () => {
  __clearRegistries()
  class WidgetsController extends Controller {
    create() {
      return this.json({ ok: true }, { status: 201 })
    }
  }
  registerControllers({ Widgets: WidgetsController })
  const app = createApp({
    routes: routes((r) => {
      r.post("/widgets", "widgets#create")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/widgets", { method: "POST" })
  assert.equal(response.status, 201)
  assert.equal(response.headers.get("content-type"), "application/json")
  assert.deepEqual(await response.json(), { ok: true })
})

test("_method inválido segue POST normal", async () => {
  __clearRegistries()
  class WidgetsController extends Controller {
    create() {
      return this.json({ ok: true })
    }
  }
  registerControllers({ Widgets: WidgetsController })
  const app = createApp({
    routes: routes((r) => {
      r.post("/widgets", "widgets#create")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/widgets", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "_method=teleport&title=x",
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
})

test("body multipart: strings em params, File fica só no body", async () => {
  __clearRegistries()
  class WidgetsController extends Controller {
    create() {
      const logo = this.body.logo
      return this.json({
        params: this.params,
        title: this.body.title,
        logoIsFile: logo instanceof File,
        logoName: logo instanceof File ? logo.name : null,
      })
    }
  }
  registerControllers({ Widgets: WidgetsController })
  const app = createApp({
    routes: routes((r) => {
      r.post("/widgets", "widgets#create")
    }),
    root,
    secret: SECRET,
  })

  const form = new FormData()
  form.set("title", "Hello")
  form.set("logo", new File(["x"], "logo.txt", { type: "text/plain" }))
  const response = await app.request("/widgets", { method: "POST", body: form })
  assert.equal(response.status, 200)
  const data = (await response.json()) as {
    params: Record<string, string>
    title: string
    logoIsFile: boolean
    logoName: string | null
  }
  assert.equal(data.params.title, "Hello")
  assert.equal("logo" in data.params, false)
  assert.equal(data.title, "Hello")
  assert.equal(data.logoIsFile, true)
  assert.equal(data.logoName, "logo.txt")
})

test("body JSON: valores preservados no body; params só com strings", async () => {
  __clearRegistries()
  class WidgetsController extends Controller {
    create() {
      return this.json({ params: this.params, body: this.body })
    }
  }
  registerControllers({ Widgets: WidgetsController })
  const app = createApp({
    routes: routes((r) => {
      r.post("/widgets", "widgets#create")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/widgets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Hi", count: 3 }),
  })
  assert.equal(response.status, 200)
  const data = (await response.json()) as {
    params: Record<string, string>
    body: Record<string, unknown>
  }
  assert.equal(data.body.count, 3)
  assert.equal(data.params.title, "Hi")
  assert.equal("count" in data.params, false)
})

test("body JSON inválido vira {}", async () => {
  __clearRegistries()
  class WidgetsController extends Controller {
    create() {
      return this.json({ body: this.body })
    }
  }
  registerControllers({ Widgets: WidgetsController })
  const app = createApp({
    routes: routes((r) => {
      r.post("/widgets", "widgets#create")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/widgets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { body: {} })
})

test("retorno não suportado vira 500 didático", async (t) => {
  t.mock.method(console, "error", () => {})
  __clearRegistries()
  class WidgetsController extends Controller {
    index(): unknown {
      return "plain text"
    }
  }
  registerControllers({ Widgets: WidgetsController })
  registerViews({
    "widgets/index": function widgetsIndex() {
      return jsx("p", { children: "unused" })
    },
  })
  const app = createApp({
    routes: routes((r) => {
      r.get("/widgets", "widgets#index")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/widgets")
  assert.equal(response.status, 500)
  const html = await response.text()
  assert.match(html, /returned an unsupported value/)
  assert.match(html, /this\.render/)
  assert.match(html, /this\.redirectTo/)
})

test("controller não registrado é erro didático no boot", () => {
  __clearRegistries()
  assert.throws(
    () =>
      createApp({
        routes: routes((r) => {
          r.get("/ghosts", "ghosts#index")
        }),
        root,
        secret: SECRET,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Controller 'Ghosts' not found/)
      assert.match(error.message, /app\/controllers\/ghosts_controller\.ts/)
      assert.match(error.message, /Restart `jot server`/)
      return true
    },
  )
})

test("view ausente para render automático é erro didático no boot", () => {
  __clearRegistries()
  class GhostsController extends Controller {
    index() {}
  }
  registerControllers({ Ghosts: GhostsController })
  assert.throws(
    () =>
      createApp({
        routes: routes((r) => {
          r.get("/ghosts", "ghosts#index")
        }),
        root,
        secret: SECRET,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /View 'ghosts\/index' not found/)
      assert.match(error.message, /app\/views\/ghosts\/index\.tsx/)
      assert.match(error.message, /Restart `jot server`/)
      return true
    },
  )
})

test("controller parcial (como o fixture do e2e) sobe; action ausente é 500 didático", async (t) => {
  t.mock.method(console, "error", () => {})
  __clearRegistries()
  class PostsController extends Controller {
    index() {
      return this.json({ posts: [] })
    }
  }
  registerControllers({ Posts: PostsController })
  const app = createApp({
    routes: routes((r) => {
      r.resource("posts")
    }),
    root,
    secret: SECRET,
  })

  const ok = await app.request("/posts")
  assert.equal(ok.status, 200)

  const missing = await app.request("/posts/1")
  assert.equal(missing.status, 500)
  const html = unescapeQuotes(await missing.text())
  assert.match(html, /Action 'show' is not defined in controller 'Posts'/)
  assert.match(html, /app\/controllers\/posts_controller\.ts/)
  assert.match(html, /config\/routes\.ts/)
})

test("rota não encontrada devolve 404 amigável", async () => {
  __clearRegistries()
  const app = createApp({ routes: routes(() => {}), root, secret: SECRET })
  const response = await app.request("/does-not-exist")
  assert.equal(response.status, 404)
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
  const html = await response.text()
  assert.match(html, /404 — Not Found/)
  assert.match(html, /The page you requested could not be found\./)
  assert.match(html, /config\/routes\.ts/)
})

test("renderNotFound devolve 404 com a página amigável e mensagem customizada", async () => {
  __clearRegistries()
  class PostsController extends Controller {
    show() {
      return this.renderNotFound("Post not found.")
    }
  }
  registerControllers({ Posts: PostsController })
  const app = createApp({
    routes: routes((r) => {
      r.get("/posts/:id", "posts#show")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/posts/99999")
  assert.equal(response.status, 404)
  const html = unescapeQuotes(await response.text())
  assert.match(html, /404 — Not Found/)
  assert.match(html, /Post not found\./)
})

/** O 500 escapa `'` como `&#39;`; desfaz só para facilitar a leitura das asserções. */
function unescapeQuotes(html: string): string {
  return html.replaceAll("&#39;", "'")
}
