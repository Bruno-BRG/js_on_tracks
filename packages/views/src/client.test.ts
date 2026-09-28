import assert from "node:assert/strict"
import { test } from "node:test"

import { CLIENT_SCRIPT } from "./client"

/** `FormData` falso: registra o form recebido e um campo, sem depender de DOM. */
class FakeFormData extends FormData {
  readonly jotForm: unknown

  constructor(form: unknown) {
    super()
    this.jotForm = form
    this.set("title", "fake")
  }
}

interface FakeElement {
  innerHTML: string
  outerHTML: string
}

interface SubmitEventLike {
  type: string
  target: unknown
  submitter: { name: string; value: string } | null
  preventDefault(): void
}

interface FetchCall {
  url: string
  init: RequestInit
}

interface HarnessOptions {
  attrs?: Record<string, string>
  action?: string
  target?: FakeElement | null
  confirm?: boolean
  response?: () => Promise<Response>
}

/** Executa o CLIENT_SCRIPT num DOM mínimo e devolve as superfícies observáveis. */
function createHarness(options: HarnessOptions = {}) {
  const attrs = options.attrs ?? {}
  const listeners: Array<(event: SubmitEventLike) => void> = []
  const dispatched: string[] = []
  const fetchCalls: FetchCall[] = []
  const warnings: string[] = []
  const target = options.target ?? null
  let nativeSubmits = 0

  const form = {
    tagName: "FORM",
    action: options.action ?? "http://localhost/posts",
    getAttribute: (name: string): string | null => attrs[name] ?? null,
    querySelector: (_selector: string): unknown =>
      attrs._method ? { value: attrs._method } : null,
    submit: (): void => {
      nativeSubmits += 1
    },
  }

  const documentStub = {
    addEventListener: (type: string, listener: (event: SubmitEventLike) => void): void => {
      if (type === "submit") listeners.push(listener)
    },
    dispatchEvent: (event: { type: string }): boolean => {
      dispatched.push(event.type)
      return true
    },
    querySelector: (_selector: string): unknown => (attrs["jot-target"] ? target : null),
  }

  const windowStub = {
    location: { href: "http://localhost/posts/new" },
    confirm: (): boolean => options.confirm ?? true,
  }

  const fetchStub = (url: string, init: RequestInit): Promise<Response> => {
    fetchCalls.push({ url, init })
    if (options.response) return options.response()
    return Promise.resolve(new Response("<p>ok</p>", { headers: { "content-type": "text/html" } }))
  }

  const run = new Function(
    "document",
    "window",
    "fetch",
    "FormData",
    "CustomEvent",
    "console",
    CLIENT_SCRIPT,
  )
  run(documentStub, windowStub, fetchStub, FakeFormData, CustomEvent, {
    warn: (message: string): void => {
      warnings.push(message)
    },
  })

  function submit(): boolean {
    let prevented = false
    const event: SubmitEventLike = {
      type: "submit",
      target: form,
      submitter: null,
      preventDefault: (): void => {
        prevented = true
      },
    }
    for (const listener of listeners) listener(event)
    return prevented
  }

  return {
    form,
    target,
    submit,
    fetchCalls,
    dispatched,
    warnings,
    nativeSubmits: (): number => nativeSubmits,
  }
}

/** Deixa a cadeia de promises do fetch terminar. */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test("CLIENT_SCRIPT tem sintaxe válida e não usa imports", () => {
  assert.equal(typeof CLIENT_SCRIPT, "string")
  assert.doesNotThrow(() => new Function(CLIENT_SCRIPT))
  assert.ok(!CLIENT_SCRIPT.includes("require("))
})

test("intercepta o submit, faz fetch e aplica innerHTML", async () => {
  const element: FakeElement = { innerHTML: "", outerHTML: "" }
  const harness = createHarness({
    attrs: { "jot-method": "post", "jot-target": "#list" },
    target: element,
  })

  assert.equal(harness.submit(), true)
  await flush()

  assert.equal(harness.fetchCalls.length, 1)
  const call = harness.fetchCalls[0]
  assert.equal(call.url, "http://localhost/posts")
  assert.equal(call.init.method, "POST")
  assert.equal(call.init.credentials, "same-origin")
  const body = call.init.body
  assert.ok(body instanceof FakeFormData)
  assert.equal(body.jotForm, harness.form)
  assert.equal(body.get("title"), "fake")
  assert.equal(element.innerHTML, "<p>ok</p>")
  assert.deepEqual(harness.dispatched, ["jot:load"])
  assert.equal(harness.nativeSubmits(), 0)
})

test("usa o campo oculto _method quando não há jot-method", async () => {
  const harness = createHarness({
    attrs: { _method: "put", "jot-target": "#row" },
    target: { innerHTML: "", outerHTML: "" },
  })

  harness.submit()
  await flush()

  assert.equal(harness.fetchCalls.length, 1)
  assert.equal(harness.fetchCalls[0].init.method, "PUT")
})

test("jot-swap=outerHTML troca o elemento inteiro", async () => {
  const element: FakeElement = { innerHTML: "", outerHTML: "" }
  const harness = createHarness({
    attrs: { "jot-method": "patch", "jot-target": "#row", "jot-swap": "outerHTML" },
    target: element,
  })

  harness.submit()
  await flush()

  assert.equal(element.outerHTML, "<p>ok</p>")
  assert.equal(element.innerHTML, "")
  assert.deepEqual(harness.dispatched, ["jot:load"])
})

test("sem jot-target cai no comportamento nativo", () => {
  const harness = createHarness({ attrs: { "jot-method": "post" } })

  assert.equal(harness.submit(), false)
  assert.equal(harness.fetchCalls.length, 0)
})

test("jot-target sem elemento alvo cai no comportamento nativo", () => {
  const harness = createHarness({ attrs: { "jot-method": "post", "jot-target": "#missing" } })

  assert.equal(harness.submit(), false)
  assert.equal(harness.fetchCalls.length, 0)
})

test("jot-confirm=false cancela sem enviar", () => {
  const harness = createHarness({
    attrs: { "jot-method": "delete", "jot-target": "#row", "jot-confirm": "Certeza?" },
    confirm: false,
    target: { innerHTML: "", outerHTML: "" },
  })

  assert.equal(harness.submit(), true)
  assert.equal(harness.fetchCalls.length, 0)
  assert.deepEqual(harness.dispatched, [])
})

test("erro de rede cai no envio nativo", async () => {
  const harness = createHarness({
    attrs: { "jot-method": "post", "jot-target": "#list" },
    target: { innerHTML: "", outerHTML: "" },
    response: () => Promise.reject(new Error("offline")),
  })

  assert.equal(harness.submit(), true)
  await flush()

  assert.equal(harness.nativeSubmits(), 1)
  assert.deepEqual(harness.dispatched, [])
  assert.ok(harness.warnings.some((message) => message.includes("offline")))
})

test("resposta não-HTML não é injetada no alvo", async () => {
  const element: FakeElement = { innerHTML: "", outerHTML: "" }
  const harness = createHarness({
    attrs: { "jot-method": "post", "jot-target": "#list" },
    target: element,
    response: () =>
      Promise.resolve(new Response("{}", { headers: { "content-type": "application/json" } })),
  })

  harness.submit()
  await flush()

  assert.equal(element.innerHTML, "")
  assert.deepEqual(harness.dispatched, [])
})
