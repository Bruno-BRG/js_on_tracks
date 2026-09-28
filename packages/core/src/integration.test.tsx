import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { boolean, createDatabase, id, string, table, text, timestamps } from "@jot/db"
import { Model, presence, type RecordOf } from "@jot/orm"
import { CLIENT_SCRIPT } from "@jot/views"
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

function postsNewView(props: { post: PostRecord }) {
  const titleErrors = props.post.errors.title
  return (
    <form method="post" action="/posts">
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
    secret: "e2e-secret",
  })

  try {
    const listening = log.mock.calls
      .map((call) => String(call.arguments[0]))
      .filter((line) => line.includes("JOT listening on"))
    assert.deepEqual(listening, [`JOT listening on http://localhost:${handle.port}`])

    const base = handle.url

    const home = await fetch(`${base}/`)
    assert.equal(home.status, 200)
    const homeHtml = await home.text()
    assert.match(homeHtml, /Hello from JOT/)
    assert.match(homeHtml, /<html lang="en">/)
    assert.match(homeHtml, /_jot\/jot\.js/)

    const list = await fetch(`${base}/posts`)
    assert.equal(list.status, 200)
    assert.match(await list.text(), /First post/)

    const created = await fetch(`${base}/posts`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "title=Second+post&body=More+content",
      redirect: "manual",
    })
    assert.equal(created.status, 303)
    const location = created.headers.get("location")
    assert.equal(location, "/posts/2")
    const cookie = created.headers.getSetCookie()[0]?.split(";")[0]
    assert.ok(cookie, "expected a session cookie on the redirect")

    const show = await fetch(`${base}${location}`, { headers: { cookie } })
    assert.equal(show.status, 200)
    assert.match(await show.text(), /Second post/)

    const missing = await fetch(`${base}/posts/99999`)
    assert.equal(missing.status, 404)
    assert.match(await missing.text(), /404 — Not Found/)

    const invalid = await fetch(`${base}/posts`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "title=",
    })
    assert.equal(invalid.status, 422)
    const invalidHtml = await invalid.text()
    assert.match(invalidHtml, /class="error"/)
    assert.match(invalidHtml, /can(&#39;|')t be blank/)

    const css = await fetch(`${base}/styles.css`)
    assert.equal(css.status, 200)
    assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8")

    const jot = await fetch(`${base}/_jot/jot.js`)
    assert.equal(jot.status, 200)
    assert.equal(await jot.text(), CLIENT_SCRIPT)
  } finally {
    await handle.close()
  }
})
