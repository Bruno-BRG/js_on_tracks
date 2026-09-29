import type { Context, ExecutionContext, Hono, MiddlewareHandler } from "hono"
import { isMultipartFormDataContentType, isUrlEncodedContentType } from "./content_type"
import { csrfForbiddenResponse } from "./csrf"
import { parseFormBody } from "./dispatch"

const OVERRIDE_METHODS: Readonly<Record<string, "PUT" | "PATCH" | "DELETE">> = {
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
}

/**
 * Respeita o campo `_method` em formulários HTML (urlencoded/multipart) para
 * PUT/PATCH/DELETE.
 *
 * O `hono/method-override` não serve: o método é repassado minúsculo no
 * re-dispatch e o router devolve 404 (verificado). Aqui o corpo é reconstruído
 * sem `_method`; no multipart, deixa o `Request` gerar um boundary novo. O
 * `POST` sem `_method` (ou com valor inválido/duplicado) segue o fluxo normal.
 */
export function methodOverride(app: Hono): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method.toUpperCase() !== "POST") return next()
    const contentType = c.req.header("content-type")
    const isUrlEncoded = isUrlEncodedContentType(contentType)
    const isMultipart = isMultipartFormDataContentType(contentType)
    if (!isUrlEncoded && !isMultipart) return next()

    let body: Record<string, unknown>
    try {
      body = await parseFormBody(c)
    } catch {
      return csrfForbiddenResponse(c)
    }
    const raw = typeof body._method === "string" ? body._method.trim().toLowerCase() : ""
    const method = OVERRIDE_METHODS[raw]
    if (method === undefined) return next()

    delete body._method
    const headers = new Headers(c.req.raw.headers)
    headers.delete("content-length")
    let requestBody: URLSearchParams | FormData
    if (isMultipart) {
      headers.delete("content-type")
      const form = new FormData()
      for (const [key, value] of Object.entries(body)) appendMultipartValue(form, key, value)
      requestBody = form
    } else {
      const form = new URLSearchParams()
      for (const [key, value] of Object.entries(body)) appendUrlEncodedValue(form, key, value)
      requestBody = form
    }
    const request = new Request(c.req.url, { method, headers, body: requestBody })
    return app.fetch(request, c.env, executionContext(c))
  }
}

function appendUrlEncodedValue(form: URLSearchParams, key: string, value: unknown): void {
  if (typeof value === "string") form.append(key, value)
  else if (Array.isArray(value)) {
    for (const item of value) if (typeof item === "string") form.append(key, item)
  }
}

function appendMultipartValue(form: FormData, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) appendMultipartValue(form, key, item)
  } else if (typeof value === "string") {
    form.append(key, value)
  } else if (typeof File !== "undefined" && value instanceof File) {
    form.append(key, value, value.name)
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
