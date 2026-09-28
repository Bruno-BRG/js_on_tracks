import type { Context, ExecutionContext, Hono, MiddlewareHandler } from "hono"

const OVERRIDE_METHODS: Readonly<Record<string, "PUT" | "PATCH" | "DELETE">> = {
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
}

/**
 * Respeita o campo `_method` em formulários HTML (POST urlencoded) para
 * PUT/PATCH/DELETE.
 *
 * O `hono/method-override` não serve: o método é repassado minúsculo no
 * re-dispatch e o router devolve 404 (verificado). Aqui o corpo é reconstruído
 * sem `_method` e o `content-length` é removido para o undici recalcular; o
 * `POST` sem `_method` (ou com valor inválido) segue o fluxo normal.
 */
export function methodOverride(app: Hono): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method.toUpperCase() !== "POST") return next()
    const contentType = (c.req.header("content-type") ?? "").toLowerCase()
    if (!contentType.startsWith("application/x-www-form-urlencoded")) return next()

    let body: Record<string, unknown>
    try {
      body = { ...(await c.req.parseBody()) }
    } catch {
      return next()
    }
    const raw = typeof body._method === "string" ? body._method.trim().toLowerCase() : ""
    const method = OVERRIDE_METHODS[raw]
    if (method === undefined) return next()

    delete body._method
    const headers = new Headers(c.req.raw.headers)
    headers.delete("content-length")
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") form.set(key, value)
    }
    const request = new Request(c.req.url, { method, headers, body: form })
    return app.fetch(request, c.env, executionContext(c))
  }
}

/** `c.executionCtx` lança quando não há ExecutionContext (ex.: testes). */
function executionContext(c: Context): ExecutionContext | undefined {
  try {
    return c.executionCtx
  } catch {
    return undefined
  }
}
