import assert from "node:assert/strict"
import { test } from "node:test"

import { Fragment, raw, renderToString } from "./index"
import { jsx, jsxs } from "./jsx-runtime"

/** Aguarda a promise e devolve o erro (falha se ela resolver). */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof Error, `esperava um Error, recebeu ${String(error)}`)
    return error
  }
  assert.fail("esperava que a renderização falhasse, mas ela resolveu")
}

test("renderiza elementos, atributos e children", async () => {
  const html = await renderToString(
    <main id="app">
      <h1 class="title">Olá</h1>
      <p>mundo</p>
    </main>,
  )
  assert.equal(html, `<main id="app"><h1 class="title">Olá</h1><p>mundo</p></main>`)
})

test("jsx/jsxs produzem VNode { type, props, key }", () => {
  const node = jsx("div", { id: "x" }, "k")
  assert.equal(node.type, "div")
  assert.deepEqual(node.props, { id: "x" })
  assert.equal(node.key, "k")
  assert.equal(jsx("div", null).key, null)
  assert.equal(jsxs("ul", { children: ["a"] }).type, "ul")
  assert.equal(jsx(Fragment, {}).type, Fragment)
})

test("escapa texto (XSS)", async () => {
  const payload = `<script>alert("x&y")</script>`
  assert.equal(
    await renderToString(<p>{payload}</p>),
    `<p>&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;</p>`,
  )
  assert.equal(await renderToString(<p>{"it's"}</p>), `<p>it&#39;s</p>`)
  assert.equal(await renderToString("a & b"), "a &amp; b")
})

test("escapa atributos (XSS)", async () => {
  const html = await renderToString(
    <a title={`"><img src=x onerror=alert(1)>`} href={"/?a=1&b=2"}>
      x
    </a>,
  )
  assert.equal(html, `<a title="&quot;>&lt;img src=x onerror=alert(1)>" href="/?a=1&amp;b=2">x</a>`)
  assert.ok(!html.includes("<img"), "o `<` precisava ter virado &lt;")
})

test("class e className viram class, com array filtrado", async () => {
  assert.equal(await renderToString(<div class="a" />), `<div class="a"></div>`)
  assert.equal(await renderToString(<div className="b" />), `<div class="b"></div>`)
  assert.equal(await renderToString(<div class="a" className="b" />), `<div class="a"></div>`)
  assert.equal(
    await renderToString(<div class={["btn", false, "active", null, undefined]} />),
    `<div class="btn active"></div>`,
  )
})

test("style como objeto vira CSS inline", async () => {
  assert.equal(
    await renderToString(
      <div
        style={{ color: "red", backgroundColor: "#fff", width: 10, lineHeight: 1.5, zIndex: 3 }}
      />,
    ),
    `<div style="color: red; background-color: #fff; width: 10px; line-height: 1.5; z-index: 3;"></div>`,
  )
  assert.equal(await renderToString(<div style="color: red" />), `<div style="color: red"></div>`)
  assert.equal(await renderToString(<div style={undefined} />), `<div></div>`)
})

test("booleanos: true vira atributo vazio, false/null/undefined somem", async () => {
  const html = await renderToString(
    <div hidden={true} draggable={false} title={undefined} data-x={null} data-y={0} />,
  )
  assert.equal(html, `<div hidden="" data-y="0"></div>`)
})

test("handlers on* são ignorados silenciosamente", async () => {
  const html = await renderToString(
    <button type="button" onClick={() => undefined} onclick="alert(1)">
      ok
    </button>,
  )
  assert.equal(html, `<button type="button">ok</button>`)
})

test("key/ref/children não viram atributos", async () => {
  assert.equal(await renderToString(<li key="k1">x</li>), `<li>x</li>`)
  assert.equal(await renderToString(jsx("li", { children: "x", key: "k", ref: {} })), `<li>x</li>`)
})

test("void elements não fecham nem recebem children", async () => {
  const html = await renderToString(
    <div>
      <br />
      <img src="/x.png" alt="" />
      <hr />
    </div>,
  )
  assert.equal(html, `<div><br><img src="/x.png" alt=""><hr></div>`)
  assert.equal(
    await renderToString(jsx("img", { src: "/x.png", alt: "", children: "texto" })),
    `<img src="/x.png" alt="">`,
  )
  assert.equal(
    await renderToString(<input type="text" value={0} maxLength={5} required />),
    `<input type="text" value="0" maxLength="5" required="">`,
  )
})

test("Fragment renderiza sem wrapper", async () => {
  assert.equal(
    await renderToString(
      <>
        <p>a</p>
        <p>b</p>
      </>,
    ),
    `<p>a</p><p>b</p>`,
  )
  assert.equal(await renderToString(<Fragment>{"texto"}</Fragment>), "texto")
})

test("componentes async, inclusive aninhados", async () => {
  async function Title({ text }: { text: string }) {
    await Promise.resolve()
    return <h1>{text}</h1>
  }

  async function Page() {
    return (
      <section>
        <Title text="async & aninhado" />
        {Promise.resolve(<footer>fim</footer>)}
      </section>
    )
  }

  assert.equal(
    await renderToString(<Page />),
    `<section><h1>async &amp; aninhado</h1><footer>fim</footer></section>`,
  )
})

test("objeto com render() funciona como type", async () => {
  const view = {
    render(props: { name: string }) {
      return <p>{props.name}</p>
    },
  }
  assert.equal(await renderToString(jsx(view, { name: "ok" })), "<p>ok</p>")
})

test("raw() injeta HTML cru", async () => {
  assert.equal(
    await renderToString(<div>{raw("<b>cru & sem escape</b>")}</div>),
    `<div><b>cru & sem escape</b></div>`,
  )
  assert.equal(await renderToString(raw("<hr>")), "<hr>")
  assert.throws(() => raw(42 as never), /raw\(\) espera uma string/)
})

test("children variados: array, número, null, false", async () => {
  assert.equal(
    await renderToString(<div>{["a", 1, null, undefined, false, true]}</div>),
    "<div>a1</div>",
  )
  assert.equal(
    await renderToString(<ul>{[<li key="1">a</li>, null, 2, false]}</ul>),
    `<ul><li>a</li>2</ul>`,
  )
  assert.equal(await renderToString(42), "42")
  assert.equal(await renderToString(null), "")
  assert.equal(await renderToString(undefined), "")
  assert.equal(await renderToString(false), "")
})

test("type inválido gera erro didático", async () => {
  const number = await rejection(renderToString(jsx(42, {})))
  assert.ok(number instanceof TypeError)
  assert.match(number.message, /"type" inválido/)
  assert.match(number.message, /número 42/)
  assert.match(number.message, /HomeIndex/)

  const nothing = await rejection(renderToString(jsx(null, {})))
  assert.match(nothing.message, /null/)

  const object = await rejection(renderToString(jsx({ foo: 1 }, {})))
  assert.match(object.message, /objeto/)
  assert.match(object.message, /render\(\)/)

  const child = await rejection(renderToString({ hello: "world" }))
  assert.match(child.message, /não renderizável/)
  assert.match(child.message, /raw\("/)
})

test("erro dentro de componente preserva a causa", async () => {
  function Broken() {
    throw new Error("falha interna")
  }
  const error = await rejection(renderToString(<Broken />))
  assert.match(error.message, /componente Broken/)
  assert.match(error.message, /falha interna/)
  assert.ok(error.cause instanceof Error)
  assert.equal((error.cause as Error).message, "falha interna")
})

test("rejeição de componente async preserva a causa", async () => {
  async function AsyncBroken(): Promise<never> {
    throw new Error("rejeitou depois do await")
  }
  const error = await rejection(renderToString(<AsyncBroken />))
  assert.match(error.message, /componente AsyncBroken/)
  assert.ok(error.cause instanceof Error)
  assert.equal((error.cause as Error).message, "rejeitou depois do await")
})

test("atributo com objeto é erro didático; style inválido também", async () => {
  const attribute = await rejection(renderToString(<div data-config={{ a: 1 }} />))
  assert.match(attribute.message, /atributo "data-config"/)
  assert.match(attribute.message, /JSON\.stringify/)

  const style = await rejection(renderToString(<div style={42 as never} />))
  assert.match(style.message, /"style" espera um objeto/)
})

test("dangerouslySetInnerHTML aponta para raw()", async () => {
  const error = await rejection(
    renderToString(<div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />),
  )
  assert.match(error.message, /dangerouslySetInnerHTML/)
  assert.match(error.message, /raw\(/)
})

test("detecta VNode cíclico", async () => {
  const node = jsx("div", {})
  node.props.children = node
  const error = await rejection(renderToString(node))
  assert.match(error.message, /cíclico/i)
})

test("nome de tag inválido é rejeitado", async () => {
  const error = await rejection(renderToString(jsx("div>", {})))
  assert.match(error.message, /Nome de tag inválido/)
})

test("nome de atributo inválido é rejeitado", async () => {
  const props = { 'x" onmouseover="alert(1)': "y" }
  const error = await rejection(renderToString(jsx("div", props)))
  assert.match(error.message, /Nome de atributo inválido/)
})
