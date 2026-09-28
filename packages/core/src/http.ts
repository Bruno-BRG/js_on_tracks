import type { Context } from "hono"

/**
 * Ajudantes de status/resposta compartilhados pelos módulos internos.
 *
 * O pacote `hono` não exporta `hono/utils/http-status` como subpath, então os
 * tipos são espelhados aqui (união idêntica, sem `any`) e as respostas recebem o
 * `content-type` explicitamente.
 */

/** União idêntica à `StatusCode` do Hono. */
export type StatusCode =
  | -1
  | 100
  | 101
  | 102
  | 103
  | 200
  | 201
  | 202
  | 203
  | 204
  | 205
  | 206
  | 207
  | 208
  | 226
  | 300
  | 301
  | 302
  | 303
  | 304
  | 305
  | 306
  | 307
  | 308
  | 400
  | 401
  | 402
  | 403
  | 404
  | 405
  | 406
  | 407
  | 408
  | 409
  | 410
  | 411
  | 412
  | 413
  | 414
  | 415
  | 416
  | 417
  | 418
  | 421
  | 422
  | 423
  | 424
  | 425
  | 426
  | 428
  | 429
  | 431
  | 451
  | 500
  | 501
  | 502
  | 503
  | 504
  | 505
  | 506
  | 507
  | 508
  | 510
  | 511

/** Status aceitos em `redirectTo` (3xx). */
export type RedirectStatusCode = 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308

/** Converte um status numérico da API pública, com erro didático se inválido. */
export function toStatusCode(status: number): StatusCode {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error(
      `Invalid HTTP status ${String(status)}; expected an integer between 100 and 599.`,
    )
  }
  return status as StatusCode
}

/** Converte um status de redirect (3xx), com erro didático se inválido. */
export function toRedirectStatusCode(status: number): RedirectStatusCode {
  const code = toStatusCode(status)
  if (code < 300 || code > 308 || code === 304) {
    throw new Error(
      `Invalid redirect status ${String(status)}; expected a status between 300 and 308 (e.g. 303).`,
    )
  }
  return code as RedirectStatusCode
}

/** Resposta textual (`string` ou vazio para HEAD) com `content-type` explícito. */
export function textResponse(
  c: Context,
  body: string | null,
  status: StatusCode,
  contentType: string,
): Response {
  const response = c.newResponse(body, status)
  response.headers.set("content-type", contentType)
  return response
}

/** Resposta binária (assets) com `content-type` explícito. */
export function bytesResponse(
  c: Context,
  body: Uint8Array,
  status: StatusCode,
  contentType: string,
): Response {
  const response = c.newResponse(body as Uint8Array<ArrayBuffer>, status)
  response.headers.set("content-type", contentType)
  return response
}
