import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { Controller } from "./controller"
import { __clearRegistries, registerControllers, registerViews } from "./registry"
import { routes } from "./routes"
import { createApp } from "./server"
import { resolveSecret, SESSION_COOKIE, Session } from "./session"

const root = mkdtempSync(join(tmpdir(), "jot-session-"))
const SECRET = "test-secret-for-jot-session-tests-with-32-bytes"

function createSessionTestApp(options: Parameters<typeof createApp>[0]) {
  return createApp({
    ...options,
    app: {
      name: "session-tests",
      csrf: {
        enabled: false,
        reason:
          "This suite tests session and flash behavior; default-on CSRF is tested separately.",
      },
    },
  })
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.getSetCookie().at(0)
  assert.ok(setCookie, "expected a Set-Cookie header")
  const cookie = setCookie.split(";").at(0)
  assert.ok(cookie)
  return cookie
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

test("Session treats __proto__ as an own key, not a prototype mutation", () => {
  const fromConstructor = new Session(
    JSON.parse('{"__proto__":{"elevated":true}}') as Record<string, unknown>,
  )
  assert.deepEqual(fromConstructor.get("__proto__"), { elevated: true })
  assert.equal(fromConstructor.get("elevated"), undefined)
  assert.equal(fromConstructor.has("__proto__"), true)
  assert.equal(fromConstructor.has("elevated"), false)
  assert.equal(fromConstructor.get("toString"), undefined)
  assert.equal(fromConstructor.has("toString"), false)

  const snapshot = fromConstructor.all()
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype)
  assert.equal(Object.hasOwn(snapshot, "__proto__"), true)
  assert.deepEqual(Object.getOwnPropertyDescriptor(snapshot, "__proto__")?.value, {
    elevated: true,
  })

  const session = new Session()
  session.set("__proto__", { elevated: true })
  assert.deepEqual(session.get("__proto__"), { elevated: true })
  assert.equal(session.get("elevated"), undefined)
  assert.equal(session.has("__proto__"), true)
  assert.equal(session.has("elevated"), false)
  session.delete("__proto__")
  assert.equal(session.get("__proto__"), undefined)
  assert.equal(session.has("__proto__"), false)
})

test("Session mantém o token CSRF privado, canonical e rotaciona só explicitamente", () => {
  const original = Buffer.alloc(32, 7).toString("base64url")
  const session = new Session({ user: "ada", __jot_csrf: original })
  assert.equal(session.dirty, false)
  assert.equal(session.csrfToken(), original)
  assert.equal(session.verifyCsrfToken(original), true)
  assert.equal(session.verifyCsrfToken("bad-token"), false)
  assert.equal(session.verifyCsrfToken(undefined), false)
  assert.equal(session.get("__jot_csrf"), undefined)
  assert.equal(session.has("__jot_csrf"), false)
  assert.deepEqual(session.all(), { user: "ada" })
  assert.throws(() => session.set("__jot_csrf", "user-value"), /reserved.*csrfToken/)
  assert.throws(() => session.delete("__jot_csrf"), /reserved.*rotateCsrfToken/)

  const fresh = new Session()
  assert.equal(fresh.verifyCsrfToken("not-a-token"), false)
  assert.equal(fresh.dirty, false, "verification must never create a token")
  const token = fresh.csrfToken()
  assert.match(token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(Buffer.from(token, "base64url").length, 32)
  assert.equal(fresh.dirty, true)
  assert.equal(fresh.csrfToken(), token)
  const rotated = fresh.rotateCsrfToken()
  assert.notEqual(rotated, token)
  assert.equal(fresh.verifyCsrfToken(rotated), true)
})

test("resolveSecret rejeita segredos com menos de 32 bytes UTF-8", () => {
  assert.throws(() => resolveSecret("short-secret"), /at least 32 UTF-8 bytes/)
  assert.equal(resolveSecret(SECRET).secret, SECRET)
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
  const app = createSessionTestApp({
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
  const attributes = login.headers.getSetCookie().at(0)
  assert.ok(attributes)
  assert.match(attributes, new RegExp(`^${SESSION_COOKIE}=`))
  assert.match(attributes, /HttpOnly/)
  assert.match(attributes, /SameSite=Lax/)
  assert.doesNotMatch(attributes, /Secure/)

  const me = await app.request("/me", { headers: { cookie: sessionCookie(login) } })
  assert.deepEqual(await me.json(), { user: "ada" })
})

test("signed session cookie round-trips __proto__ as an own data key", async () => {
  __clearRegistries()
  class SessionsController extends Controller {
    store() {
      this.session.set("__proto__", { elevated: true })
      return this.json({
        elevated: this.session.get("elevated") ?? null,
        hasProto: this.session.has("__proto__"),
        hasElevated: this.session.has("elevated"),
      })
    }
    inspect() {
      return this.json({
        value: this.session.get("__proto__"),
        elevated: this.session.get("elevated") ?? null,
        hasProto: this.session.has("__proto__"),
        hasElevated: this.session.has("elevated"),
      })
    }
  }
  registerControllers({ Sessions: SessionsController })
  const app = createSessionTestApp({
    routes: routes((r) => {
      r.post("/session/prototype", "sessions#store")
      r.get("/session/prototype", "sessions#inspect")
    }),
    root,
    secret: SECRET,
  })

  const stored = await app.request("/session/prototype", { method: "POST" })
  assert.equal(stored.status, 200)
  assert.deepEqual(await stored.json(), {
    elevated: null,
    hasProto: true,
    hasElevated: false,
  })

  const restored = await app.request("/session/prototype", {
    headers: { cookie: sessionCookie(stored) },
  })
  assert.equal(restored.status, 200)
  assert.deepEqual(await restored.json(), {
    value: { elevated: true },
    elevated: null,
    hasProto: true,
    hasElevated: false,
  })
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
  const app = createSessionTestApp({
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
  // Flash is consumed, but the newly-created synchronizer token keeps the session alive.
  const cleared = first.headers.getSetCookie()
  assert.equal(cleared.length, 1)
  const clearedCookie = cleared.at(0)
  assert.ok(clearedCookie)
  assert.match(clearedCookie, new RegExp(`^${SESSION_COOKIE}=`))
  assert.match(clearedCookie, /Max-Age=604800/)
  const cookie = clearedCookie.split(";").at(0)
  assert.ok(cookie)

  const second = await app.request("/posts", {
    headers: { cookie },
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
  const app = createSessionTestApp({
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
    assert.match(String(warn.mock.calls[0]?.arguments[0]), /JOT_SECRET is not set/)
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousEnv
    if (previousSecret === undefined) delete process.env.JOT_SECRET
    else process.env.JOT_SECRET = previousSecret
  }
})
