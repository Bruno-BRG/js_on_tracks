import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { Controller } from "./controller"
import { __clearRegistries, registerControllers, registerViews } from "./registry"
import { routes } from "./routes"
import { createApp } from "./server"

const root = mkdtempSync(join(tmpdir(), "jot-render-"))
const SECRET = "test-secret-for-jot-session-tests-with-32-bytes"

function applicationLayout(props: {
  children?: unknown
  flash?: Record<string, unknown>
  title?: string
}) {
  return (
    <html lang="en">
      <head>
        <title>{props.title ?? "app"}</title>
      </head>
      <body>
        <header class="flash">{String(props.flash?.notice ?? "no-flash")}</header>
        {props.children}
      </body>
    </html>
  )
}

function adminLayout(props: { children?: unknown }) {
  return <div class="admin">{props.children}</div>
}

function postsIndex(props: { posts: string[]; flash?: Record<string, unknown> }) {
  return (
    <section>
      <h1>Posts</h1>
      <ul>
        {props.posts.map((title) => (
          <li>{title}</li>
        ))}
      </ul>
      <em>{String(props.flash?.notice ?? "no-flash")}</em>
    </section>
  )
}

test("render usa layouts/application e injeta flash na view e no layout", async () => {
  __clearRegistries()
  class PostsController extends Controller {
    async index() {
      this.flash.notice = "From controller"
      return this.render("posts/index", { posts: ["First", "Second"] })
    }
  }
  registerControllers({ Posts: PostsController })
  registerViews({ "posts/index": postsIndex, "layouts/application": applicationLayout })
  const app = createApp({
    routes: routes((r) => {
      r.get("/posts", "posts#index")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/posts")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
  assert.equal(
    await response.text(),
    '<html lang="en"><head><title>app</title></head><body>' +
      '<header class="flash">From controller</header>' +
      "<section><h1>Posts</h1><ul><li>First</li><li>Second</li></ul>" +
      "<em>From controller</em></section></body></html>",
  )
})

test("{ layout: false } devolve só a view", async () => {
  __clearRegistries()
  class PostsController extends Controller {
    async index() {
      return this.render("posts/index", { posts: [] }, { layout: false })
    }
  }
  registerControllers({ Posts: PostsController })
  registerViews({ "posts/index": postsIndex, "layouts/application": applicationLayout })
  const app = createApp({
    routes: routes((r) => {
      r.get("/posts", "posts#index")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/posts")
  assert.equal(response.status, 200)
  assert.equal(await response.text(), "<section><h1>Posts</h1><ul></ul><em>no-flash</em></section>")
})

test("status do render: options.status > this.status > 200", async () => {
  __clearRegistries()
  class PostsController extends Controller {
    async index() {
      this.status = 201
      return this.render("posts/index", { posts: [] }, { layout: false })
    }
    async edit() {
      return this.render("posts/index", { posts: [] }, { layout: false, status: 422 })
    }
  }
  registerControllers({ Posts: PostsController })
  registerViews({ "posts/index": postsIndex })
  const app = createApp({
    routes: routes((r) => {
      r.get("/posts", "posts#index")
      r.get("/posts/edit", "posts#edit")
    }),
    root,
    secret: SECRET,
  })

  assert.equal((await app.request("/posts")).status, 201)
  assert.equal((await app.request("/posts/edit")).status, 422)
})

test("layout customizado é usado quando indicado", async () => {
  __clearRegistries()
  class PostsController extends Controller {
    async index() {
      return this.render("posts/index", { posts: [] }, { layout: "layouts/admin" })
    }
  }
  registerControllers({ Posts: PostsController })
  registerViews({
    "posts/index": postsIndex,
    "layouts/application": applicationLayout,
    "layouts/admin": adminLayout,
  })
  const app = createApp({
    routes: routes((r) => {
      r.get("/posts", "posts#index")
    }),
    root,
    secret: SECRET,
  })

  assert.equal(
    await (await app.request("/posts")).text(),
    '<div class="admin"><section><h1>Posts</h1><ul></ul><em>no-flash</em></section></div>',
  )
})

test("view ausente no render vira 500 didático", async (t) => {
  t.mock.method(console, "error", () => {})
  __clearRegistries()
  class PostsController extends Controller {
    async index() {
      return this.render("posts/missing")
    }
  }
  registerControllers({ Posts: PostsController })
  const app = createApp({
    routes: routes((r) => {
      r.get("/posts", "posts#index")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/posts")
  assert.equal(response.status, 500)
  const html = unescapeQuotes(await response.text())
  assert.match(html, /View 'posts\/missing' not found/)
  assert.match(html, /app\/views\/posts\/missing\.tsx/)
  assert.match(html, /Restart `jot server`/)
})

test("layout default ausente no render vira 500 didático", async (t) => {
  t.mock.method(console, "error", () => {})
  __clearRegistries()
  class PostsController extends Controller {
    async index() {
      return this.render("posts/index", { posts: [] })
    }
  }
  registerControllers({ Posts: PostsController })
  registerViews({ "posts/index": postsIndex })
  const app = createApp({
    routes: routes((r) => {
      r.get("/posts", "posts#index")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/posts")
  assert.equal(response.status, 500)
  const html = unescapeQuotes(await response.text())
  assert.match(html, /Layout 'layouts\/application' not found/)
  assert.match(html, /app\/views\/layouts\/application\.tsx/)
})

/** O 500 escapa `'` como `&#39;`; desfaz só para facilitar a leitura das asserções. */
function unescapeQuotes(html: string): string {
  return html.replaceAll("&#39;", "'")
}
