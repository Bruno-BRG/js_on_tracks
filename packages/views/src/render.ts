import { escapeAttribute, escapeText } from "./escape"
import {
  type Component,
  describeValue,
  Fragment,
  isRaw,
  type Props,
  RAW_MARKER,
  type VNode,
} from "./runtime"

/** Elementos HTML que não têm fechamento nem filhos (void elements). */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
])

/** Nomes de tag aceitos: letras, números, `-`, `_`, `.` e `:` (ex.: `my-widget`, `svg:path`). */
const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9:._-]*$/

/** Nomes de atributo aceitos pelo HTML5 (sem espaços, `"`, `'`, `>`, `/`, `=` nem controles). */
const ATTRIBUTE_NAME = /^[^\s"'<>/=\p{Cc}]+$/u

/** Props CSS numéricas que não recebem `px` (mesma ideia do React). */
const UNITLESS_STYLE = new Set([
  "animationIterationCount",
  "aspectRatio",
  "borderImageOutset",
  "borderImageSlice",
  "borderImageWidth",
  "columnCount",
  "columns",
  "fillOpacity",
  "flex",
  "flexGrow",
  "flexShrink",
  "floodOpacity",
  "fontWeight",
  "gridArea",
  "gridColumn",
  "gridColumnEnd",
  "gridColumnStart",
  "gridRow",
  "gridRowEnd",
  "gridRowStart",
  "lineClamp",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "scale",
  "stopOpacity",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeMiterlimit",
  "strokeOpacity",
  "strokeWidth",
  "tabSize",
  "widows",
  "zIndex",
  "zoom",
])

/** Forma aceita para `type` do VNode: objeto com método `render()`. */
interface RenderObject {
  render(props: Props): unknown
}

/**
 * Renderiza uma árvore JSX para HTML.
 *
 * Sempre assíncrono: componentes podem devolver promessas (async) em qualquer nível
 * e o resultado é aguardado recursivamente. Somente `raw()` pula o escape; todo o
 * resto (texto, atributos) é escapado exatamente uma vez.
 */
export async function renderToString(vnode: unknown): Promise<string> {
  return renderChild(vnode, new Set())
}

async function renderChild(value: unknown, seen: Set<object>): Promise<string> {
  if (isThenable(value)) {
    const awaited: unknown = await value
    return renderChild(awaited, seen)
  }
  if (value === null || value === undefined || value === false || value === true) {
    return ""
  }
  switch (typeof value) {
    case "string":
      return escapeText(value)
    case "number":
      return escapeText(String(value))
    case "bigint":
      return String(value)
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw cycleError("array")
    seen.add(value)
    try {
      let html = ""
      for (const child of value) {
        html += await renderChild(child, seen)
      }
      return html
    } finally {
      seen.delete(value)
    }
  }
  if (typeof value === "object") {
    if (isRaw(value)) return value[RAW_MARKER]
    if (isVNode(value)) return renderVNode(value, seen)
  }
  throw new TypeError(
    `renderToString received a value it cannot render: ${describeValue(value)}. ` +
      `Use JSX/VNode, an array of children, a string, a number, raw("...") ` +
      `or null/undefined/false (which are ignored).`,
  )
}

async function renderVNode(vnode: VNode, seen: Set<object>): Promise<string> {
  if (seen.has(vnode)) throw cycleError("VNode")
  seen.add(vnode)
  try {
    const { type, props } = vnode
    if (type === Fragment) return await renderChild(props.children, seen)
    if (typeof type === "string") return await renderElement(type, props, seen)
    if (typeof type === "function") {
      return await renderComponent(() => (type as Component)(props), componentName(type), seen)
    }
    if (isRenderObject(type)) {
      return await renderComponent(() => type.render(props), renderObjectName(type), seen)
    }
    throw new TypeError(
      `VNode with an invalid "type": ${describeValue(type)}. ` +
        `Use a string tag (e.g. "div"), a function component (e.g. HomeIndex), ` +
        `an object with render(), or <Fragment>.`,
    )
  } finally {
    seen.delete(vnode)
  }
}

async function renderElement(tag: string, props: Props, seen: Set<object>): Promise<string> {
  if (!TAG_NAME.test(tag)) {
    throw new TypeError(
      `Invalid tag name: ${JSON.stringify(tag)}. ` +
        `Use a valid HTML tag (e.g. "div", "my-widget", "svg:path").`,
    )
  }
  const attributes = renderAttributes(props)
  if (VOID_ELEMENTS.has(tag.toLowerCase())) {
    if (hasSignificantChildren(props.children)) {
      // Consome rejeições pendentes para nunca deixar uma promise sem handler.
      consumeRejections(props.children)
      throw new TypeError(
        `<${tag}> is a void element and must not have children (received ${describeValue(props.children)}). ` +
          `Remove the children or use a non-void element such as "div" or "span".`,
      )
    }
    return `<${tag}${attributes}>`
  }
  const children = await renderChild(props.children, seen)
  return `<${tag}${attributes}>${children}</${tag}>`
}

async function renderComponent(
  run: () => unknown,
  name: string,
  seen: Set<object>,
): Promise<string> {
  let output: unknown
  try {
    output = await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : describeValue(error)
    throw new Error(`Failed to render component ${name}: ${message}`, { cause: error })
  }
  return renderChild(output, seen)
}

function renderAttributes(props: Props): string {
  let html = ""
  let classDone = false
  for (const name of Object.keys(props)) {
    if (name === "children" || name === "key" || name === "ref") continue
    if (name.startsWith("on")) continue // SSR não tem eventos: handlers são ignorados.
    if (!ATTRIBUTE_NAME.test(name)) {
      throw new TypeError(
        `Invalid attribute name: ${JSON.stringify(name)}. ` +
          `Use a valid HTML attribute name (e.g. "class", "data-id", "aria-label").`,
      )
    }
    const value = props[name]
    if (name === "class" || name === "className") {
      if (classDone) continue
      classDone = true
      const text = classText(props.class ?? props.className)
      if (text !== null) html += ` class="${escapeAttribute(text)}"`
      continue
    }
    if (name === "style") {
      const css = styleText(value)
      if (css !== null) html += ` style="${escapeAttribute(css)}"`
      continue
    }
    if (name === "dangerouslySetInnerHTML") {
      throw new TypeError(
        `"dangerouslySetInnerHTML" is not part of @js_on_tracks/views. ` +
          `For raw HTML, use raw() inside children: <div>{raw("<b>ok</b>")}</div>.`,
      )
    }
    html += renderAttribute(name === "htmlFor" ? "for" : name, value)
  }
  return html
}

function renderAttribute(name: string, value: unknown): string {
  if (value === null || value === undefined || value === false) return ""
  if (value === true) return ` ${name}=""`
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return ` ${name}="${escapeAttribute(String(value))}"`
  }
  if (Array.isArray(value)) {
    const text = value
      .filter((part) => part !== null && part !== undefined && part !== false && part !== true)
      .map(String)
      .filter((part) => part.length > 0)
      .join(" ")
    return text.length === 0 ? "" : ` ${name}="${escapeAttribute(text)}"`
  }
  throw new TypeError(
    `Attribute "${name}" received ${describeValue(value)}; expected a string, number, ` +
      `boolean or array. Convert the value first (e.g. JSON.stringify(value)).`,
  )
}

function classText(value: unknown): string | null {
  if (value === null || value === undefined || value === false || value === true) return null
  if (Array.isArray(value)) {
    const parts = value
      .filter((part) => part !== null && part !== undefined && part !== false && part !== true)
      .map(String)
      .filter((part) => part.length > 0)
    return parts.length === 0 ? null : parts.join(" ")
  }
  return String(value)
}

function styleText(value: unknown): string | null {
  if (value === null || value === undefined || value === false) return null
  if (typeof value === "string") return value
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `The "style" attribute expects an object (e.g. style={{ color: "red" }}) or a CSS string, ` +
        `but received ${describeValue(value)}.`,
    )
  }
  let css = ""
  for (const [property, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined || raw === false) continue
    css += `${css.length > 0 ? " " : ""}${cssProperty(property)}: ${cssValue(property, raw)};`
  }
  return css.length === 0 ? null : css
}

function cssProperty(property: string): string {
  if (property.startsWith("--")) return property
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function cssValue(property: string, value: unknown): string {
  if (typeof value === "number") {
    if (value === 0 || property.startsWith("--") || UNITLESS_STYLE.has(property)) {
      return String(value)
    }
    return `${value}px`
  }
  if (typeof value === "string" || typeof value === "bigint") return String(value)
  throw new TypeError(
    `style.${property} received ${describeValue(value)}; expected a string or a number.`,
  )
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false
  return typeof (value as { then?: unknown }).then === "function"
}

function isVNode(value: object): value is VNode {
  return "type" in value && "props" in value
}

function isRenderObject(value: unknown): value is RenderObject {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { render?: unknown }).render === "function"
  )
}

function componentName(component: { name?: string }): string {
  const name = component.name
  return name && name.length > 0 ? name : "(anonymous)"
}

function renderObjectName(value: RenderObject): string {
  const ctor = value.constructor as { name?: string } | undefined
  const name = ctor?.name
  return name && name !== "Object" ? `instance of ${name}` : "object with render()"
}

/** `true` quando há conteúdo real em `children` (ignora null/undefined/false/array vazio/string vazia). */
function hasSignificantChildren(children: unknown): boolean {
  if (children === null || children === undefined || children === false || children === true) {
    return false
  }
  if (typeof children === "string") return children.length > 0
  if (Array.isArray(children)) return children.some((child) => hasSignificantChildren(child))
  return true
}

/** Anexa handlers a promessas já criadas na árvore, para não deixar rejeições pendentes. */
function consumeRejections(value: unknown): void {
  if (isThenable(value)) {
    value.then(undefined, () => undefined)
    return
  }
  if (Array.isArray(value)) {
    for (const child of value) consumeRejections(child)
  }
}

/** Erro didático para ciclos em VNodes e arrays. */
function cycleError(kind: "VNode" | "array"): Error {
  return new Error(
    `Cyclic render detected: the same ${kind} is rendered inside itself. ` +
      `Check the "children" of the component or the array you passed.`,
  )
}
