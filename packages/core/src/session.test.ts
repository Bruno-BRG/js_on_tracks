import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { Controller } from "./controller"
import { __clearRegistries, registerControllers, registerViews } from "./registry"
import { routes } from "./routes"
import { createApp } from "./server"
import { SESSION_COOKIE, Session } from "./session"

const root = mkdtempSync(join(tmpdir(), "jot-session-"))
const SECRET = "test-secret"

function sessionCookie(response: Response): string {
  const setCookie = response.headers.getSetCookie()
  assert.ok(setCookie.length > 0, "expected a Set-Cookie header")
  return setCookie[0]!.split(";")[0]!
}

test("Session: get/set/has/delete/dirty e cópia em all()", () => {
  const session = new Session({ user: "ada" })
  assert.equal(session.get("user"), "ada")
  assert.equal(session.has("user"), true)
  assert.equal(session.dirty, false)

  session.set("role", "admin")
  assert.equal(session.dirty, true)
  assert.deepEqual(session.all(), { user: "ada", role: "admin" })

  const copy = session.all()
  copy.user = "mutated"
  assert.equal(session.get("user"), "ada")

  const fresh = new Session()
  fresh.delete("absent")
  assert.equal(fresh.dirty, false)
  fresh.delete("user")
  assert.equal(fresh.dirty, false)
  fresh.set("x", 1)
  fresh.delete("x")
  assert.equal(fresh.dirty, true)
})

test("set na sessão emite Set-Cookie assinado (HttpOnly/SameSite=Lax) e o reuso recupera", async () => {
  __clearRegistries()
  class SessionsController extends Controller {
    login() {
      this.session.set("user", this.params.user ?? "ada")
      return this.redirectTo("/")
    }
    me() {
      return this.json({ user: this.session.get("user") ?? null })
    }
  }
  registerControllers({ Sessions: SessionsController })
  const app = createApp({
    routes: routes((r) => {
      r.post("/login", "sessions#login")
      r.get("/me", "sessions#me")
    }),
    root,
    secret: SECRET,
  })

  const login = await app.request("/login", { method: "POST" })
  assert.equal(login.status, 303)
  assert.equal(login.headers.get("location"), "/")
  const attributes = login.headers.getSetCookie()[0]!
  assert.match(attributes, new RegExp(`^${SESSION_COOKIE}=`))
  assert.match(attributes, /HttpOnly/)
  assert.match(attributes, /SameSite=Lax/)
  assert.doesNotMatch(attributes, /Secure/)

  const me = await app.request("/me", { headers: { cookie: sessionCookie(login) } })
  assert.deepEqual(await me.json(), { user: "ada" })
})

test("request sem mutação não emite Set-Cookie", async () => {
  __clearRegistries()
  class SessionsController extends Controller {
    me() {
      return this.json({ user: this.session.get("user") ?? null })
    }
  }
  registerControllers({ Sessions: SessionsController })
  const app = createApp({
    routes: routes((r) => {
      r.get("/me", "sessions#me")
    }),
    root,
    secret: SECRET,
  })

  const response = await app.request("/me")
  assert.deepEqual(await response.json(), { user: null })
  assert.equal(response.headers.getSetCookie().length, 0)
})

test("cookie adulterado/malformado vira sessão vazia (nunca 500)", async () => {
  __clearRegistries()
  class SessionsController extends Controller {
    me() {
      return this.json({ user: this.session.get("user") ?? null })
    }
  }
  registerControllers({ Sessions: SessionsController })
  const app = createApp({
    routes: routes((r) => {
      r.get("/me", "sessions#me")
    }),
    root,
    secret: SECRET,
  })

  const cookies = [
    `${SESSION_COOKIE}=eyJ1c2VyIjoiYWRhIn0.deadbeef`,
    `${SESSION_COOKIE}=not-a-cookie`,
    `${SESSION_COOKIE}=.`,
    `${SESSION_COOKIE}=eyJ1c2VyIjoiYWRhIn0.`,
  ]
  for (const cookie of cookies) {
    const response = await app.request("/me", { headers: { cookie } })
    assert.equal(response.status, 200, cookie)
    assert.deepEqual(await response.json(), { user: null }, cookie)
  }
})

test("flash sobrevive ao 303 e é consumido no primeiro render", async () => {
  __clearRegistries()
  class PostsController extends Controller {
    create() {
      return this.redirectTo("/posts", { flash: { notice: "Post created." } })
    }
    index() {
      return this.render("posts/index", {}, { layout: false })
    }
  }
  registerControllers({ Posts: PostsController })
  registerViews({
    "posts/index": function postsIndex(props: { flash?: Record<string, unknown> }) {
      return `flash:${String(props.flash?.notice ?? "none")}`
    },
  })
  const app = createApp({
    routes: routes((r) => {
      r.post("/posts", "posts#create")
      r.get("/posts", "posts#index")
    }),
    root,
    secret: SECRET,
  })

  const created = await app.request("/posts", { method: "POST" })
  assert.equal(created.status, 303)

  const first = await app.request("/posts", { headers: { cookie: sessionCookie(created) } })
  assert.equal(await first.text(), "flash:Post created.")
  // flash consumido: a sessão é reescrita vazia (cookie expirado)
  const cleared = first.headers.getSetCookie()
  assert.equal(cleared.length, 1)
  assert.match(cleared[0]!, new RegExp(`^${SESSION_COOKIE}=`))

  const second = await app.request("/posts", {
    headers: { cookie: cleared[0]!.split(";")[0]! },
  })
  assert.equal(await second.text(), "flash:none")
})

test("flash também chega ao render automático (sem options)", async () => {
  __clearRegistries()
  class PostsController extends Controller {
    create() {
      return this.redirectTo("/posts", { flash: { notice: "Created" } })
    }
    index() {}
  }
  registerControllers({ Posts: PostsController })
  registerViews({
    "posts/index": function postsIndex(props: { flash?: Record<string, unknown> }) {
      return `flash:${String(props.flash?.notice ?? "none")}`
    },
    "layouts/application": function applicationLayout(props: { children?: unknown }) {
      return props.children
    },
  })
  const app = createApp({
    routes: routes((r) => {
      r.post("/posts", "posts#create")
      r.get("/posts", "posts#index")
    }),
    root,
    secret: SECRET,
  })

  const created = await app.request("/posts", { method: "POST" })
  const rendered = await app.request("/posts", { headers: { cookie: sessionCookie(created) } })
  assert.equal(await rendered.text(), "flash:Created")
})

test("produção sem JOT_SECRET é erro; dev sem segredo avisa e segue", (t) => {
  const previousEnv = process.env.NODE_ENV
  const previousSecret = process.env.JOT_SECRET
  try {
    delete process.env.JOT_SECRET
    process.env.NODE_ENV = "production"
    assert.throws(
      () => createApp({ routes: routes(() => {}), root }),
      /JOT_SECRET is required in production/,
    )

    process.env.NODE_ENV = "development"
    const warn = t.mock.method(console, "warn", () => {})
    createApp({ routes: routes(() => {}), root })
    assert.equal(warn.mock.calls.length, 1)
    assert.match(String(warn.mock.calls[0]!.arguments[0]), /JOT_SECRET is not set/)
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousEnv
    if (previousSecret === undefined) delete process.env.JOT_SECRET
    else process.env.JOT_SECRET = previousSecret
  }
})
