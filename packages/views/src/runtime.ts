/**
 * Símbolos, tipos e helpers compartilhados pelo runtime JSX do `@jot/views`.
 *
 * Este módulo é a base comum de `jsx-runtime`, `jsx-dev-runtime`, `render` e `index`
 * e de propósito não importa nenhum outro módulo do pacote, para não criar ciclos.
 */

/**
 * Marcador do `<Fragment>` (JSX: `<>...</>`).
 *
 * É um `symbol` de verdade em runtime; o tipo inclui uma assinatura de função
 * apenas para satisfazer o checador de JSX do TypeScript, que exige que a tag
 * seja "chamável". O render compara por identidade (`type === Fragment`) e nunca
 * chama o símbolo.
 */
export const Fragment: symbol & ((props: Props) => Renderable) = Symbol.for(
  "jot.views.fragment",
) as unknown as symbol & ((props: Props) => Renderable)

/** Marcador interno do `raw()`; o HTML cru fica guardado sob esta chave. */
export const RAW_MARKER: unique symbol = Symbol.for("jot.views.raw")

/** Chave de identidade de um VNode; não é renderizada como atributo. */
export type Key = string | number | bigint | null

/** Props de um VNode: `children` é só mais uma chave. */
export interface Props {
  [name: string]: unknown
}

/** Unidade da árvore renderizável; `jsx()`/`jsxs()` produzem isto. */
export interface VNode {
  readonly type: unknown
  readonly props: Props
  readonly key: Key | null
}

/** HTML cru (não escapado) criado por `raw()`. */
export interface RawHtml {
  readonly [RAW_MARKER]: string
}

/** Tudo que `renderToString` aceita, incluindo componentes async. */
export type Renderable =
  | VNode
  | RawHtml
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  // biome-ignore lint/suspicious/noConfusingVoidType: componentes sem `return` produzem `void`, tratado como `undefined` no render.
  | void
  | readonly Renderable[]
  | Promise<unknown>

/** Componente de função; pode ser assíncrono. */
export type Component = (props: Props) => Renderable

/**
 * Marca uma string como HTML cru, pulando o escape.
 *
 * Use somente com HTML de confiança: o conteúdo é injetado exatamente como está.
 * Ex.: `<div>{raw("<strong>ok</strong>")}</div>`.
 */
export function raw(html: string): RawHtml {
  if (typeof html !== "string") {
    throw new TypeError(
      `raw() espera uma string de HTML, mas recebeu ${describeValue(html)}. ` +
        `Ex.: raw("<strong>ok</strong>").`,
    )
  }
  return { [RAW_MARKER]: html }
}

/** `true` quando o valor veio de `raw()`. */
export function isRaw(value: unknown): value is RawHtml {
  return typeof value === "object" && value !== null && RAW_MARKER in value
}

/**
 * Descreve um valor para mensagens de erro didáticas
 * (ex.: `string "x"`, `número 42`, `objeto [object Object] com chaves [a, b]`).
 */
export function describeValue(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  switch (typeof value) {
    case "string": {
      const text = value.length > 40 ? `${value.slice(0, 40)}…` : value
      return `string ${JSON.stringify(text)}`
    }
    case "number":
    case "bigint": {
      const label = typeof value === "number" ? "número" : "bigint"
      return `${label} ${String(value)}`
    }
    case "boolean":
      return `booleano ${String(value)}`
    case "function": {
      const name = (value as { name?: string }).name
      return `função ${name && name.length > 0 ? name : "(anônima)"}`
    }
    case "symbol":
      return `symbol ${String(value)}`
    default: {
      if (Array.isArray(value)) {
        return `array de ${value.length} ${value.length === 1 ? "item" : "itens"}`
      }
      const tag = Object.prototype.toString.call(value)
      const keys = Object.keys(value as Record<string, unknown>)
      if (keys.length === 0) return `objeto ${tag}`
      const shown = keys.slice(0, 5).join(", ")
      return `objeto ${tag} com chaves [${shown}${keys.length > 5 ? ", …" : ""}]`
    }
  }
}
