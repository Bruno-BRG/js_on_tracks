import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { jsx } from "@jot/views/jsx-runtime"
import { type AppConfig, defineApp } from "./app"
import { Controller } from "./controller"
import { __clearRegistries, registerControllers, registerViews } from "./registry"
import { routes } from "./routes"
import { createApp } from "./server"

const root = mkdtempSync(join(tmpdir(), "jot-csrf-"))
const SECRET = "csrf-test-secret-that-is-at-least-32-utf8-bytes"
const MESSAGE =
  "Request rejected because the CSRF token is missing or invalid. Add a hidden _csrf field using the csrfToken render prop, or send X-CSRF-Token with a token from this.csrfToken(). See the generated app README. Do not disable CSRF for ordinary browser forms."

interface CsrfFixtures {
  app: ReturnType<typeof createApp>
  calls: { create: number; update: number; destroy: number; postItem: number; webhook: number }
}

function buildCsrfApp(options: { app?: AppConfig; exemptWebhook?: boolean } = {}): CsrfFixtures {
  __clearRegistries()
  const calls = { create: 0, update: 0, destroy: 0, postItem: 0, webhook: 0 }

  class WidgetsController extends Controller {
    form() {
      return this.render("widgets/form", { csrfToken: "user-supplied-token" }, { layout: false })
    }
    redirect() {
      return this.redirectTo("/csrf/form", { flash: { notice: "Saved." } })
    }
    token() {
      return this.json({ token: this.csrfToken() })
    }
    create() {
      calls.create += 1
      return this.json(this.responseData())
    }
    update() {
      calls.update += 1
      return this.json(this.responseData())
    }
    destroy() {
      calls.destroy += 1
      return this.json(this.responseData())
    }
    postItem() {
      calls.postItem += 1
      return this.json(this.responseData())
    }
    webhook() {
      calls.webhook += 1
      return this.json(this.responseData())
    }
    private responseData(): Record<string, unknown> {
      const logo = this.body.logo
      return {
        method: this.request.req.method,
        body: this.body,
        params: this.params,
        logoName: typeof File !== "undefined" && logo instanceof File ? logo.name : null,
        requestContentType: this.request.req.header("content-type") ?? null,
      }
    }
  }

  registerControllers({ Widgets: WidgetsController })
  registerViews({
    "widgets/form": function widgetsForm(props: {
      csrfToken: string
      flash?: Record<string, unknown>
    }) {
      return jsx("form", {
        children: [
          jsx("input", {
            type: "hidden",
            name: "_csrf",
            value: props.csrfToken,
          }),
          props.flash?.notice ? jsx("p", { children: props.flash.notice }) : null,
        ],
      })
    },
  })

  const routeTable = routes((r) => {
    r.get("/csrf/form", "widgets#form")
    r.get("/csrf/token", "widgets#token")
    r.post("/csrf/redirect", "widgets#redirect")
    r.post("/widgets", "widgets#create")
    r.post("/widgets/:id", "widgets#postItem")
    r.put("/widgets/:id", "widgets#update")
    r.patch("/widgets/:id", "widgets#update")
    r.delete("/widgets/:id", "widgets#destroy")
    r.post(
      "/webhooks/provider",
      "widgets#webhook",
      options.exemptWebhook
        ? { csrf: { exempt: true, reason: "Verify the provider signature before processing" } }
        : undefined,
    )
  })
  return {
    app: createApp({ app: options.app, routes: routeTable, root, secret: SECRET }),
    calls,
  }
}

async function getToken(
  app: ReturnType<typeof createApp>,
): Promise<{ token: string; cookie: string }> {
  const response = await app.request("/csrf/token")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  const { token } = (await response.json()) as { token: string }
  const setCookie = response.headers.getSetCookie().at(0)
  assert.ok(setCookie)
  assert.match(setCookie, /^jot_session=/)
  const cookie = setCookie.split(";").at(0)
  assert.ok(cookie)
  return { token, cookie }
}

function formRequest(
  cookie: string | undefined,
  fields: Record<string, string>,
  extras: { headers?: Record<string, string>; path?: string } = {},
): RequestInit & { url: string } {
  const headers = new Headers(extras.headers)
  headers.set("content-type", "application/x-www-form-urlencoded")
  if (cookie !== undefined) headers.set("cookie", cookie)
  return {
    url: extras.path ?? "/widgets",
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  }
}

test("GET render/API emits stable session token, cookie, and private no-store responses", async () => {
  const { app } = buildCsrfApp()
  const form = await app.request("/csrf/form")
  assert.equal(form.status, 200)
  assert.equal(form.headers.get("cache-control"), "private, no-store")
  const html = await form.text()
  const match = /name="_csrf" value="([A-Za-z0-9_-]{43})"/.exec(html)
  assert.ok(match, "render should inject and HTML-escape csrfToken")
  assert.doesNotMatch(html, /user-supplied-token/)
  const formCookie = form.headers.getSetCookie().at(0)
  assert.ok(formCookie)
  assert.match(formCookie, /^jot_session=/)
  assert.match(formCookie, /Path=\//)
  assert.match(formCookie, /HttpOnly/)
  assert.match(formCookie, /SameSite=Lax/)
  assert.match(formCookie, /Max-Age=604800/)

  const firstToken = match[1]
  const formCookieValue = formCookie.split(";").at(0)
  assert.ok(formCookieValue)
  const api = await app.request("/csrf/token", { headers: { cookie: formCookieValue } })
  const apiJson = (await api.json()) as { token: string }
  assert.equal(apiJson.token, firstToken)
  assert.equal(api.headers.get("cache-control"), "private, no-store")
})

test("production session cookie remains Secure", async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = "production"
  try {
    const { app } = buildCsrfApp()
    const response = await app.request("/csrf/form")
    assert.equal(response.status, 200)
    assert.match(response.headers.getSetCookie()[0] ?? "", /Secure/)
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
})

test("303 preserves the synchronizer token and flash is consumed on the next render", async () => {
  const { app } = buildCsrfApp()
  const initial = await app.request("/csrf/form")
  const initialHtml = await initial.text()
  const token = /name="_csrf" value="([A-Za-z0-9_-]{43})"/.exec(initialHtml)?.[1]
  const initialCookie = initial.headers.getSetCookie()[0]?.split(";")[0]
  assert.ok(token)
  assert.ok(initialCookie)

  const redirected = await app.request(
    "/csrf/redirect",
    formRequest(initialCookie, { _csrf: token, title: "created" }),
  )
  assert.equal(redirected.status, 303)
  assert.equal(redirected.headers.get("location"), "/csrf/form")
  const redirectCookie = redirected.headers.getSetCookie()[0]?.split(";")[0]
  assert.ok(redirectCookie, "redirect should persist flash without dropping the CSRF token")

  const rendered = await app.request("/csrf/form", { headers: { cookie: redirectCookie } })
  const renderedHtml = await rendered.text()
  assert.match(renderedHtml, /<p>Saved\.<\/p>/)
  assert.match(renderedHtml, new RegExp(`name="_csrf" value="${token}"`))
  const consumedCookie = rendered.headers.getSetCookie()[0]?.split(";")[0]
  assert.ok(consumedCookie)

  const tokenAfterRender = await app.request("/csrf/token", { headers: { cookie: consumedCookie } })
  assert.deepEqual(await tokenAfterRender.json(), { token })
})

test("default-on CSRF rejects missing, malformed, duplicate, conflicting, or unsigned tokens identically", async () => {
  const { app, calls } = buildCsrfApp()
  const { token, cookie } = await getToken(app)
  const wrong = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`
  const attempts: Array<{ init: RequestInit; secret?: string }> = [
    { init: formRequest(cookie, { title: "missing" }) },
    {
      init: formRequest(cookie, { _csrf: "malformed-secret-value", title: "bad" }),
      secret: "malformed-secret-value",
    },
    { init: formRequest(cookie, { _csrf: wrong, title: "wrong" }), secret: wrong },
    {
      init: formRequest(
        cookie,
        { _csrf: token, title: "conflict" },
        { headers: { "X-CSRF-Token": wrong } },
      ),
      secret: wrong,
    },
    {
      init: formRequest(cookie, { title: "duplicate" }),
      secret: token,
    },
    { init: formRequest(undefined, { _csrf: token, title: "no cookie" }), secret: token },
    {
      init: formRequest("jot_session=tampered", { _csrf: token, title: "tampered" }),
      secret: token,
    },
    {
      init: formRequest("jot_session=malformed", { _csrf: token, title: "malformed cookie" }),
      secret: token,
    },
  ]
  // Create a repeated _csrf field separately; duplicate values must not collapse to one token.
  const duplicate = formRequest(cookie, { title: "duplicate" })
  duplicate.body = new URLSearchParams([
    ["_csrf", token],
    ["_csrf", token],
    ["title", "duplicate"],
  ])
  const duplicateAttempt = attempts.at(4)
  assert.ok(duplicateAttempt)
  duplicateAttempt.init = duplicate

  let publicBody: string | undefined
  for (const attempt of attempts) {
    const response = await app.request("/widgets", attempt.init)
    assert.equal(response.status, 403)
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("x-content-type-options"), "nosniff")
    assert.equal(response.headers.get("vary"), "Accept")
    assert.equal(response.headers.getSetCookie().length, 0)
    const body = await response.text()
    assert.match(body, new RegExp(MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.doesNotMatch(body, new RegExp(attempt.secret ?? "__never_match__"))
    if (publicBody === undefined) publicBody = body
    else assert.equal(body, publicBody)
  }
  assert.equal(calls.create, 0)

  const queryOnly = await app.request(
    `/widgets?_csrf=${encodeURIComponent(token)}`,
    formRequest(cookie, { title: "query token is not accepted" }),
  )
  assert.equal(queryOnly.status, 403)

  const fileField = new FormData()
  fileField.set("_csrf", new File([token], "csrf.txt", { type: "text/plain" }))
  const fileToken = await app.request("/widgets", {
    method: "POST",
    headers: { cookie },
    body: fileField,
  })
  assert.equal(fileToken.status, 403)
  assert.equal(fileToken.headers.getSetCookie().length, 0)
  assert.equal(calls.create, 0)
})

test("valid form/header tokens pass; _csrf is removed from controller body and params", async () => {
  const { app, calls } = buildCsrfApp()
  const { token, cookie } = await getToken(app)

  const form = formRequest(cookie, { _csrf: token, title: "hello" })
  const response = await app.request("/widgets?_csrf=query-value", form)
  assert.equal(response.status, 200)
  const formData = (await response.json()) as {
    body: Record<string, unknown>
    params: Record<string, string>
  }
  assert.deepEqual(formData.body, { title: "hello" })
  assert.equal("_csrf" in formData.body, false)
  assert.equal("_csrf" in formData.params, false)

  const header = await app.request("/widgets", {
    method: "POST",
    headers: { cookie, "X-CSRF-Token": token, "content-type": "application/json" },
    body: JSON.stringify({ title: "json" }),
  })
  assert.equal(header.status, 200)
  const headerData = (await header.json()) as { body: Record<string, unknown> }
  assert.deepEqual(headerData.body, { title: "json" })

  const matchingHeaderAndField = await app.request(
    "/widgets",
    formRequest(
      cookie,
      { _csrf: token, title: "matching" },
      { headers: { "X-CSRF-Token": token } },
    ),
  )
  assert.equal(matchingHeaderAndField.status, 200)
  assert.equal(calls.create, 3)
})

test("Content-Type classification uses the exact media type, not parameter values", async () => {
  const { app } = buildCsrfApp()
  const { token, cookie } = await getToken(app)

  const urlEncoded = await app.request("/widgets", {
    method: "POST",
    headers: {
      cookie,
      "content-type": 'application/x-www-form-urlencoded; profile="application/json"',
    },
    body: new URLSearchParams({ _csrf: token, title: "urlencoded" }),
  })
  assert.equal(urlEncoded.status, 200)
  assert.deepEqual(((await urlEncoded.json()) as { body: Record<string, unknown> }).body, {
    title: "urlencoded",
  })

  const boundary = "----application/json-boundary"
  const multipartBody = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="_csrf"',
    "",
    token,
    `--${boundary}`,
    'Content-Disposition: form-data; name="title"',
    "",
    "multipart",
    `--${boundary}--`,
    "",
  ].join("\r\n")
  const multipart = await app.request("/widgets", {
    method: "POST",
    headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
    body: multipartBody,
  })
  assert.equal(multipart.status, 200)
  assert.deepEqual(((await multipart.json()) as { body: Record<string, unknown> }).body, {
    title: "multipart",
  })

  const structuredJson = await app.request("/widgets", {
    method: "POST",
    headers: {
      cookie,
      "X-CSRF-Token": token,
      "content-type": 'application/problem+json; profile="application/json"',
    },
    body: JSON.stringify({ title: "structured JSON" }),
  })
  assert.equal(structuredJson.status, 200)
  assert.deepEqual(((await structuredJson.json()) as { body: Record<string, unknown> }).body, {
    title: "structured JSON",
  })

  const jsonp = await app.request("/widgets", {
    method: "POST",
    headers: { cookie, "X-CSRF-Token": token, "content-type": "application/jsonp" },
    body: JSON.stringify({ title: "not JSON" }),
  })
  assert.equal(jsonp.status, 200)
  assert.deepEqual(((await jsonp.json()) as { body: Record<string, unknown> }).body, {})
})

test("JSON requires X-CSRF-Token and 403 negotiates generic JSON without reflecting inputs", async () => {
  const { app, calls } = buildCsrfApp()
  const { token, cookie } = await getToken(app)
  const response = await app.request("/widgets", {
    method: "POST",
    headers: { cookie, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ _csrf: token, title: "not accepted from JSON" }),
  })
  assert.equal(response.status, 403)
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("x-content-type-options"), "nosniff")
  assert.equal(response.headers.get("vary"), "Accept")
  const data = (await response.json()) as { error: string }
  assert.equal(data.error, MESSAGE)
  assert.doesNotMatch(data.error, new RegExp(token))
  assert.equal(calls.create, 0)
})

test("403 Accept negotiation honors quality values, exact media types, wildcards, and safe fallback", async () => {
  const { app } = buildCsrfApp()
  const html = "text/html; charset=utf-8"
  const json = "application/json; charset=utf-8"
  const cases: Array<{
    name: string
    headers?: Record<string, string>
    expected: string
  }> = [
    {
      name: "an explicitly refused JSON range falls back to acceptable HTML",
      headers: { accept: "application/json;q=0, text/html" },
      expected: html,
    },
    {
      name: "a more specific q=0 range overrides a positive wildcard",
      headers: { accept: "application/json;q=0, */*;q=1" },
      expected: html,
    },
    {
      name: "the higher-quality JSON representation is selected",
      headers: { accept: "text/html;q=0.3, application/json;q=0.8" },
      expected: json,
    },
    {
      name: "the higher-quality HTML representation is selected",
      headers: { accept: "text/html;q=0.8, application/json;q=0.2" },
      expected: html,
    },
    {
      name: "application wildcard matches JSON",
      headers: { accept: "application/*" },
      expected: json,
    },
    {
      name: "global wildcard uses JSON Content-Type as the deterministic tie-breaker",
      headers: { accept: "*/*", "content-type": "application/json" },
      expected: json,
    },
    {
      name: "application/jsonp is not an exact JSON media-type match",
      headers: { accept: "application/jsonp", "content-type": "application/json" },
      expected: html,
    },
    {
      name: "absent Accept preserves the JSON request Content-Type fallback",
      headers: { "content-type": "application/json" },
      expected: json,
    },
    {
      name: "no acceptable representation deterministically falls back to generic HTML",
      headers: { accept: "image/png", "content-type": "application/json" },
      expected: html,
    },
    {
      name: "malformed quoted extensions invalidate their Accept range",
      headers: { accept: 'application/json;q=1;foo="unterminated' },
      expected: html,
    },
    {
      name: "a malformed later range does not discard an earlier valid JSON range",
      headers: { accept: 'application/json;q=1, text/html;q=0;foo="unterminated' },
      expected: json,
    },
  ]

  for (const scenario of cases) {
    const response = await app.request("/widgets", {
      method: "POST",
      headers: scenario.headers,
    })
    assert.equal(response.status, 403, scenario.name)
    assert.equal(response.headers.get("content-type"), scenario.expected, scenario.name)
    assert.equal(response.headers.get("cache-control"), "no-store", scenario.name)
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", scenario.name)
    assert.equal(response.headers.get("vary"), "Accept", scenario.name)
  }
})

test("malformed multipart parsing fails closed with the generic 403", async () => {
  const { app, calls } = buildCsrfApp()
  const response = await app.request("/widgets", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "multipart/form-data; boundary=missing",
    },
    body: "not a multipart body",
  })
  assert.equal(response.status, 403)
  assert.equal(((await response.json()) as { error: string }).error, MESSAGE)
  assert.equal(calls.create, 0)
})

test("effective _method is protected and multipart reconstruction preserves Files and boundary", async () => {
  const { app, calls } = buildCsrfApp()
  const { token, cookie } = await getToken(app)

  const missing = formRequest(cookie, { _method: "put", title: "no token" }, { path: "/widgets/7" })
  const rejected = await app.request("/widgets/7", missing)
  assert.equal(rejected.status, 403)
  assert.equal(calls.update, 0)

  const tunneled = await app.request(
    "/widgets/7",
    formRequest(
      cookie,
      { _method: "put", _csrf: token, title: "tunneled" },
      { path: "/widgets/7" },
    ),
  )
  assert.equal(tunneled.status, 200)
  const tunneledData = (await tunneled.json()) as {
    method: string
    body: Record<string, unknown>
  }
  assert.equal(tunneledData.method, "PUT")
  assert.deepEqual(tunneledData.body, { title: "tunneled" })
  assert.equal("_csrf" in tunneledData.body, false)

  const repeatedFields = new URLSearchParams()
  repeatedFields.append("_method", "patch")
  repeatedFields.append("_csrf", token)
  repeatedFields.append("tag", "one")
  repeatedFields.append("tag", "two")
  const repeatedResponse = await app.request("/widgets/7", {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: repeatedFields,
  })
  assert.equal(repeatedResponse.status, 200)
  const repeatedData = (await repeatedResponse.json()) as {
    body: Record<string, unknown>
  }
  assert.deepEqual(repeatedData.body.tag, ["one", "two"])

  const multipart = new FormData()
  multipart.set("_method", "put")
  multipart.set("_csrf", token)
  multipart.set("title", "multipart")
  multipart.append("tag", "one")
  multipart.append("tag", "two")
  multipart.set("logo", new File(["image"], "logo.txt", { type: "text/plain" }))
  const uploaded = await app.request("/widgets/7", {
    method: "POST",
    headers: { cookie },
    body: multipart,
  })
  assert.equal(uploaded.status, 200)
  const uploadedData = (await uploaded.json()) as {
    method: string
    body: Record<string, unknown>
    params: Record<string, string>
    logoName: string | null
    requestContentType: string | null
  }
  assert.equal(uploadedData.method, "PUT")
  assert.equal(uploadedData.logoName, "logo.txt")
  assert.match(uploadedData.requestContentType ?? "", /^multipart\/form-data; boundary=/)
  assert.equal("_csrf" in uploadedData.body, false)
  assert.equal("_method" in uploadedData.body, false)
  assert.deepEqual(uploadedData.body.tag, ["one", "two"])
  assert.equal("_csrf" in uploadedData.params, false)
  assert.equal(calls.update, 3)

  const duplicateMethod = new URLSearchParams()
  duplicateMethod.append("_method", "put")
  duplicateMethod.append("_method", "delete")
  duplicateMethod.append("_csrf", token)
  duplicateMethod.append("title", "not overridden")
  const ordinaryPost = await app.request("/widgets/7", {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: duplicateMethod,
  })
  assert.equal(ordinaryPost.status, 200)
  const ordinaryData = (await ordinaryPost.json()) as {
    method: string
    body: Record<string, unknown>
  }
  assert.equal(ordinaryData.method, "POST")
  assert.deepEqual(ordinaryData.body._method, ["put", "delete"])
  assert.equal(calls.postItem, 1)
})

test("direct PUT/PATCH/DELETE and safe methods follow the policy", async () => {
  const { app, calls } = buildCsrfApp()
  const { token, cookie } = await getToken(app)
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const response = await app.request("/widgets/9", {
      method,
      headers: { cookie, "X-CSRF-Token": token },
    })
    assert.equal(response.status, 200, method)
  }
  assert.equal(calls.update, 2)
  assert.equal(calls.destroy, 1)
  for (const method of ["HEAD", "OPTIONS"]) {
    const response = await app.request("/widgets", { method })
    assert.notEqual(response.status, 403, method)
  }
})

test("global opt-out and route exemptions require reasons and emit boot warnings", async (t) => {
  const warning = t.mock.method(console, "warn", () => {})
  const reason = "Bearer-authenticated API; no cookie authentication"
  const previousNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = "production"
  let globallyOff: CsrfFixtures
  try {
    globallyOff = buildCsrfApp({
      app: defineApp({ name: "stateless-api", csrf: { enabled: false, reason } }),
    })
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
  const globallyAllowed = await globallyOff.app.request("/widgets", { method: "POST" })
  assert.equal(globallyAllowed.status, 200)
  assert.ok(warning.mock.calls.some((call) => String(call.arguments[0]).includes(reason)))
  assert.throws(
    () => defineApp({ name: "bad-api", csrf: { enabled: false, reason: "  " } }),
    /requires a non-empty reason/,
  )
  assert.throws(
    () =>
      buildCsrfApp({
        app: { name: "bad-runtime-api", csrf: { enabled: false, reason: "  " } } as AppConfig,
      }),
    /requires a non-empty reason/,
  )

  warning.mock.resetCalls()
  const routeApp = buildCsrfApp({ exemptWebhook: true })
  const webhook = await routeApp.app.request("/webhooks/provider", { method: "POST" })
  assert.equal(webhook.status, 200)
  const ordinary = await routeApp.app.request("/widgets", { method: "POST" })
  assert.equal(ordinary.status, 403)
  assert.ok(
    warning.mock.calls.some((call) =>
      String(call.arguments[0]).includes("Verify the provider signature"),
    ),
  )

  const previous = process.env.JOT_CSRF
  process.env.JOT_CSRF = "0"
  try {
    const defaultApp = buildCsrfApp()
    assert.equal((await defaultApp.app.request("/widgets", { method: "POST" })).status, 403)
  } finally {
    if (previous === undefined) delete process.env.JOT_CSRF
    else process.env.JOT_CSRF = previous
  }
})
