import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { boolean, createDatabase, id, string, table, text, timestamps } from "@js_on_tracks/db"
import { Model, presence, type RecordOf } from "@js_on_tracks/orm"
import { CLIENT_SCRIPT } from "@js_on_tracks/views"
import { defineApp } from "./app"
import { Controller } from "./controller"
import { paths } from "./paths"
import { __clearRegistries, registerControllers, registerViews } from "./registry"
import { routes } from "./routes"
import { start } from "./server"

/** Recria o fluxo dourado do e2e (arquitetura §6) sem CLI: db → migrate → start → requests. */

const posts = table("posts", {
  id: id(),
  title: string().notNull(),
  body: text(),
  published: boolean().default(false),
  ...timestamps(),
})

class Post extends Model<typeof posts> {
  static readonly table = posts
  static validations = { title: [presence()] }
}

/** Instância do model com os campos da linha (mesma convenção do contrato §4.2). */
type PostRecord = RecordOf<typeof Post>

function applicationLayout(props: { children?: unknown }) {
  return (
    <html lang="en">
      <head>
        <title>blog</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <main>{props.children}</main>
        <script src="/_jot/jot.js"></script>
      </body>
    </html>
  )
}

function homeIndex(props: { framework: string }) {
  return <h1>Hello from {props.framework}</h1>
}

function postsIndexView(props: { posts: PostRecord[] }) {
  return (
    <ul class="posts">
      {props.posts.map((post) => (
        <li>
          <a href={`/posts/${post.id}`}>{post.title}</a>
        </li>
      ))}
    </ul>
  )
}

function postsNewView(props: { post: PostRecord; csrfToken: string }) {
  const titleErrors = props.post.errors.title
  return (
    <form method="post" action="/posts">
      <input type="hidden" name="_csrf" value={props.csrfToken} />
      <input name="title" value={props.post.title ?? ""} />
      {titleErrors && titleErrors.length > 0 ? <p class="error">{titleErrors.join(", ")}</p> : null}
      <button type="submit">Create</button>
    </form>
  )
}

function postsShowView(props: { post: PostRecord }) {
  return (
    <article>
      <h1>{props.post.title}</h1>
      <p>{props.post.body}</p>
    </article>
  )
}

class HomeController extends Controller {
  index() {
    return this.render("home/index", { framework: "JOT" })
  }
}

class PostsController extends Controller {
  async index() {
    return this.render("posts/index", { posts: await Post.all() })
  }

  new() {
    return this.render("posts/new", { post: Post.new({}) })
  }

  async create() {
    const post = Post.new({
      title: String(this.params.title ?? ""),
      body: String(this.params.body ?? ""),
    })
    if (await post.save()) {
      return this.redirectTo(paths.post(post.id), { flash: { notice: "Post created." } })
    }
    return this.render("posts/new", { post }, { status: 422 })
  }

  async show() {
    const post = await Post.find(String(this.params.id))
    if (!post) return this.renderNotFound()
    return this.render("posts/show", { post })
  }
}

const MIGRATION = [
  "create table if not exists posts (",
  "  id integer primary key autoincrement,",
  "  title text not null,",
  "  body text,",
  "  published integer not null default 0,",
  "  created_at integer,",
  "  updated_at integer",
  ");",
  "",
  "insert into posts (title, body, published, created_at, updated_at)",
  "values ('First post', 'Hello from the JOT end-to-end test.', 1, 1750000000000, 1750000000000);",
  "",
  "-- jot:down",
  "drop table if exists posts;",
  "",
].join("\n")

class CookieJar {
  cookie: string | undefined
  csrfToken: string | undefined

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.cookie !== undefined) headers.set("cookie", this.cookie)
    const response = await fetch(url, { ...init, headers })
    for (const setCookie of response.headers.getSetCookie()) {
      this.cookie = setCookie.split(";")[0]
    }
    return response
  }
}

test("fluxo dourado: migrate → start → home/posts/create/404/static", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "jot-golden-"))
  mkdirSync(path.join(root, "db", "migrate"), { recursive: true })
  mkdirSync(path.join(root, "public"), { recursive: true })
  writeFileSync(path.join(root, "db", "migrate", "0001_create_posts.sql"), MIGRATION, "utf8")
  writeFileSync(path.join(root, "public", "styles.css"), "body { color: #333 }", "utf8")

  // `jot db:migrate`
  const database = createDatabase({
    url: path.join(root, "db", "dev.sqlite"),
    schema: { posts },
    migrationsDir: path.join(root, "db", "migrate"),
    logQueries: false,
  })
  assert.deepEqual(await database.migrate(), ["0001_create_posts.sql"])
  await database.close()

  __clearRegistries()
  registerControllers({ Home: HomeController, Posts: PostsController })
  registerViews({
    "home/index": homeIndex,
    "posts/index": postsIndexView,
    "posts/new": postsNewView,
    "posts/show": postsShowView,
    "layouts/application": applicationLayout,
  })

  const log = t.mock.method(console, "log", () => {})
  const handle = await start({
    app: defineApp({ name: "blog" }),
    routes: routes((r) => {
      r.root("home#index")
      r.resource("posts")
    }),
    database: {
      url: path.join(root, "db", "dev.sqlite"),
      migrationsDir: path.join(root, "db", "migrate"),
      logQueries: false,
    },
    root,
    port: 0,
    secret: "e2e-secret-for-jot-session-tests-with-32-bytes",
  })

  try {
    const listening = log.mock.calls
      .map((call) => String(call.arguments[0]))
      .filter((line) => line.includes("JOT listening on"))
    assert.deepEqual(listening, [`JOT listening on http://localhost:${handle.port}`])

    const base = handle.url
    const jar = new CookieJar()

    const home = await jar.request(`${base}/`)
    assert.equal(home.status, 200)
    const homeHtml = await home.text()
    assert.match(homeHtml, /Hello from JOT/)
    assert.match(homeHtml, /<html lang="en">/)
    assert.match(homeHtml, /_jot\/jot\.js/)

    const list = await jar.request(`${base}/posts`)
    assert.equal(list.status, 200)
    assert.match(await list.text(), /First post/)

    const form = await jar.request(`${base}/posts/new`)
    assert.equal(form.status, 200)
    const formHtml = await form.text()
    const tokenMatch = /name="_csrf" value="([A-Za-z0-9_-]{43})"/.exec(formHtml)
    assert.ok(tokenMatch, "rendered form should include the synchronizer token")
    jar.csrfToken = tokenMatch[1]
    assert.ok(jar.cookie?.startsWith("jot_session="))
    assert.equal(form.headers.get("cache-control"), "private, no-store")

    const rejected = await jar.request(`${base}/posts`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "title=Rejected+post&body=missing+token",
      redirect: "manual",
    })
    assert.equal(rejected.status, 403)
    assert.equal(rejected.headers.getSetCookie().length, 0)

    const created = await postForm(jar, `${base}/posts`, {
      title: "Second post",
      body: "More content",
    })
    assert.equal(created.status, 303)
    const location = created.headers.get("location")
    assert.equal(location, "/posts/2")

    const show = await jar.request(`${base}${location}`)
    assert.equal(show.status, 200)
    assert.match(await show.text(), /Second post/)

    const missing = await jar.request(`${base}/posts/99999`)
    assert.equal(missing.status, 404)
    assert.match(await missing.text(), /404 — Not Found/)

    const invalid = await postForm(jar, `${base}/posts`, { title: "" })
    assert.equal(invalid.status, 422)
    const invalidHtml = await invalid.text()
    assert.match(invalidHtml, /class="error"/)
    assert.match(invalidHtml, /can(&#39;|')t be blank/)

    const css = await jar.request(`${base}/styles.css`)
    assert.equal(css.status, 200)
    assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8")

    const jot = await jar.request(`${base}/_jot/jot.js`)
    assert.equal(jot.status, 200)
    assert.equal(await jot.text(), CLIENT_SCRIPT)
  } finally {
    await handle.close()
  }
})

function postForm(jar: CookieJar, url: string, fields: Record<string, string>): Promise<Response> {
  assert.ok(jar.csrfToken, "GET a rendered form before posting")
  return jar.request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, _csrf: jar.csrfToken }),
    redirect: "manual",
  })
}
