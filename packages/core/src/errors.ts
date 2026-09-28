import type { Context, ErrorHandler, NotFoundHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { textResponse } from "./http"

const HTML_CONTENT_TYPE = "text/html; charset=utf-8"

const PAGE_STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: #0f1115;
  color: #e6e8ee;
}
main { width: min(52rem, 100%); }
h1 { margin: 0 0 1rem; font-size: 1.6rem; color: #ff6b6b; }
p { line-height: 1.5; }
code { color: #9ecbff; }
pre {
  overflow: auto;
  padding: 1rem;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
  background: #151922;
  font-size: 0.85rem;
  line-height: 1.45;
}
.hint { color: #b9c0cc; }
.route { color: #8b93a3; }
`

/** Opções da página 404 compartilhada por `notFoundHandler` e `renderNotFound`. */
export interface NotFoundPageOptions {
  /** Em dev, inclui método/path e a dica de reiniciar o `jot server`. */
  dev: boolean
  method?: string
  path?: string
  /** Mensagem customizada (`this.renderNotFound("...")`). */
  message?: string
}

/** Escapa texto para HTML (`& < > " '`), sem depender de internos do `@jot/views`. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Página 404 amigável (com detalhes de dev quando aplicável). */
export function notFoundPage(options: NotFoundPageOptions): string {
  const message = options.message?.trim()
  const blocks: string[] = [
    "<h1>404 — Not Found</h1>",
    `<p>${message !== undefined && message.length > 0 ? escapeHtml(message) : "The page you requested could not be found."}</p>`,
  ]
  if (options.dev) {
    if (options.method !== undefined && options.path !== undefined) {
      blocks.push(
        `<p class="route"><code>${escapeHtml(options.method)} ${escapeHtml(options.path)}</code></p>`,
      )
    }
    blocks.push(
      '<p class="hint">Check <code>config/routes.ts</code> and make sure the URL is correct. ' +
        "If you created or removed controllers or views, restart <code>jot server</code> " +
        "to regenerate the manifest.</p>",
    )
  }
  return renderPage("404 — Not Found", blocks)
}

/** Handler de 404 do Hono (rotas ausentes e assets fora de `public/`). */
export function notFoundHandler(dev: boolean): NotFoundHandler {
  return (c) =>
    textResponse(
      c,
      notFoundPage({ dev, method: c.req.method, path: c.req.path }),
      404,
      HTML_CONTENT_TYPE,
    )
}

/**
 * Handler de erro do Hono: `console.error` sempre; `HTTPException` devolve a
 * própria resposta; em dev a página traz mensagem, stack e dica; em produção é
 * genérica.
 */
export function errorHandler(dev: boolean): ErrorHandler {
  return (error, c) => {
    console.error(error)
    if (error instanceof HTTPException) return error.getResponse()
    const page = dev ? internalErrorPageDev(error, c) : internalErrorPage()
    return textResponse(c, page, 500, HTML_CONTENT_TYPE)
  }
}

function internalErrorPage(): string {
  return renderPage("500 — Internal Server Error", [
    "<h1>500 — Internal Server Error</h1>",
    "<p>Something went wrong while handling this request.</p>",
  ])
}

function internalErrorPageDev(error: Error, c: Context): string {
  const stack = error.stack ?? error.message
  return renderPage("500 — Internal Server Error", [
    "<h1>500 — Internal Server Error</h1>",
    `<p>${escapeHtml(error.message)}</p>`,
    `<p class="route"><code>${escapeHtml(c.req.method)} ${escapeHtml(c.req.path)}</code></p>`,
    `<pre>${escapeHtml(stack)}</pre>`,
    '<p class="hint">If you created or removed controllers or views, restart <code>jot server</code> ' +
      "to regenerate the manifest.</p>",
  ])
}

function renderPage(title: string, blocks: readonly string[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE.trim()}</style>
</head>
<body>
<main>
${blocks.join("\n")}
</main>
</body>
</html>
`
}
