/**
 * Runtime JSX automático de produção do `@jot/views`.
 *
 * Com `"jsx": "react-jsx"` + `"jsxImportSource": "@jot/views"` no tsconfig, o
 * TypeScript/esbuild chamam `jsx`/`jsxs` e resolvem `<></>` para `Fragment`.
 */

import { Fragment, type Key, type Props, type Renderable, type VNode } from "./runtime"

export { Fragment }

/**
 * Cria um VNode `{ type, props, key }`.
 *
 * `children` vive em `props.children` (valor único ou array). Não há validação
 * aqui: o `type` é validado no `renderToString`, que tem o contexto para explicar
 * o erro.
 */
export function jsx(type: unknown, props: Props | null, key?: Key | null): VNode {
  return { type, props: props ?? {}, key: key ?? null }
}

/** Igual a `jsx`; existe porque o compilador chama `jsxs` quando os children são estáticos. */
export const jsxs = jsx

export declare namespace JSX {
  /** O que uma expressão JSX produz. */
  type Element = Renderable

  /** O que aceita ser usado como tag: tag HTML, componente de função ou `Fragment`. */
  type ElementType = string | ((props: never) => Renderable) | typeof Fragment

  /** Marca `children` como o slot de conteúdo. */
  interface ElementChildrenAttribute {
    children: unknown
  }

  /** `key` é aceito em qualquer elemento (e não vira atributo). */
  interface IntrinsicAttributes {
    key?: Key
  }

  /** Qualquer tag é aceita; os valores são validados/escapados no render. */
  interface IntrinsicElements {
    [tag: string]: Props
  }
}
