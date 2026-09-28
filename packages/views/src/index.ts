/**
 * `@jot/views` — runtime JSX SSR do JOT (contrato §4.3).
 *
 * Os apps usam `"jsx": "react-jsx"` + `"jsxImportSource": "@jot/views"`, então o
 * compilador importa `@jot/views/jsx-runtime` automaticamente. Por aqui saem a
 * renderização e o script do cliente:
 *
 * ```tsx
 * import { renderToString } from "@jot/views"
 *
 * const html = await renderToString(<h1>Olá</h1>)
 * ```
 */

export { CLIENT_SCRIPT } from "./client"
export { renderToString } from "./render"
export type { Component, Key, Props, RawHtml, Renderable, VNode } from "./runtime"
export { Fragment, raw } from "./runtime"
