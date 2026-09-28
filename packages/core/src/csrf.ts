import type { Context, MiddlewareHandler } from "hono"
import { isFormContentType, isJsonContentType } from "./content_type"
import { parseFormBody } from "./dispatch"
import { Session } from "./session"
import { getRequestState } from "./state"

const CSRF_MESSAGE =
  "Request rejected because the CSRF token is missing or invalid. Add a hidden _csrf field using the csrfToken render prop, or send X-CSRF-Token with a token from this.csrfToken(). See the generated app README. Do not disable CSRF for ordinary browser forms."

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const QUALITY = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/

interface AcceptRange {
  type: string
  subtype: string
  quality: number
  typeSpecificity: number
  parameters: Map<string, string>
}

interface SplitResult {
  parts: string[]
  valid: boolean
}

/** Verifica o synchronizer token depois da sessão e do method override. */
export function csrfProtection(): MiddlewareHandler {
  return async (c, next) => {
    if (!UNSAFE_METHODS.has(c.req.method.toUpperCase())) return next()

    const session = getRequestState(c)?.session
    const verifier = session ?? new Session()
    const headerToken = c.req.header("X-CSRF-Token")
    const contentType = c.req.header("content-type")
    const isJson = isJsonContentType(contentType)
    const isForm = isFormContentType(contentType)

    let bodyTokenPresent = false
    let bodyToken: unknown
    if (isForm) {
      try {
        const body = await parseFormBody(c)
        bodyTokenPresent = Object.hasOwn(body, "_csrf")
        bodyToken = body._csrf
      } catch {
        verifier.verifyCsrfToken(undefined)
        verifier.verifyCsrfToken(headerToken)
        return csrfForbiddenResponse(c)
      }
    }

    const headerValid = verifier.verifyCsrfToken(headerToken)
    const bodyValid = verifier.verifyCsrfToken(bodyTokenPresent ? bodyToken : undefined)
    const accepted =
      headerToken !== undefined && bodyTokenPresent
        ? typeof headerToken === "string" &&
          typeof bodyToken === "string" &&
          headerToken === bodyToken &&
          headerValid &&
          bodyValid
        : headerToken !== undefined
          ? headerValid
          : bodyTokenPresent && !isJson && bodyValid

    if (!session || !accepted) return csrfForbiddenResponse(c)
    return next()
  }
}

/** Resposta genérica e não-cacheável para qualquer falha de validação CSRF. */
export function csrfForbiddenResponse(c: Context): Response {
  const accept = c.req.header("accept")
  const requestIsJson = isJsonContentType(c.req.header("content-type"))
  const useJson = negotiateJson(accept, requestIsJson)
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Accept",
  })

  if (useJson) {
    headers.set("Content-Type", "application/json; charset=utf-8")
    return new Response(JSON.stringify({ error: CSRF_MESSAGE }), { status: 403, headers })
  }

  headers.set("Content-Type", "text/html; charset=utf-8")
  return new Response(
    `<!doctype html><html lang="en"><head><title>Forbidden</title></head><body><h1>Forbidden</h1><p>${CSRF_MESSAGE}</p></body></html>`,
    { status: 403, headers },
  )
}

function negotiateJson(accept: string | undefined, requestIsJson: boolean): boolean {
  if (accept === undefined || accept.trim().length === 0) return requestIsJson

  const ranges = parseAccept(accept)
  const jsonQuality = qualityFor(ranges, "application", "json")
  const htmlQuality = qualityFor(ranges, "text", "html")
  const jsonAccepted = jsonQuality !== undefined && jsonQuality > 0
  const htmlAccepted = htmlQuality !== undefined && htmlQuality > 0

  if (jsonAccepted && !htmlAccepted) return true
  if (htmlAccepted && !jsonAccepted) return false
  if (!jsonAccepted && !htmlAccepted) return false
  if (jsonQuality !== htmlQuality) return (jsonQuality ?? 0) > (htmlQuality ?? 0)
  return requestIsJson
}

function parseAccept(value: string): AcceptRange[] {
  const ranges: AcceptRange[] = []
  const entries = splitOutsideQuotes(value, ",").parts
  for (const entry of entries) {
    const split = splitOutsideQuotes(entry, ";")
    if (!split.valid) continue
    const parts = split.parts
    const mediaType = parts.shift()?.trim().toLowerCase() ?? ""
    const separator = mediaType.indexOf("/")
    if (separator <= 0 || separator === mediaType.length - 1) continue

    const type = mediaType.slice(0, separator)
    const subtype = mediaType.slice(separator + 1)
    const validType = type === "*" || TOKEN.test(type)
    const validSubtype = subtype === "*" || TOKEN.test(subtype)
    if (!validType || !validSubtype || (type === "*" && subtype !== "*")) continue

    const parameters = new Map<string, string>()
    let quality = 1
    let qualitySeen = false
    let valid = true
    for (const part of parts) {
      const parameter = part.trim()
      const equals = parameter.indexOf("=")
      if (equals < 1) {
        if (qualitySeen && TOKEN.test(parameter)) continue // Bare Accept extension.
        valid = false
        break
      }
      const name = parameter.slice(0, equals).trim().toLowerCase()
      const rawValue = parameter.slice(equals + 1).trim()
      if (!TOKEN.test(name)) {
        valid = false
        break
      }
      if (name === "q") {
        if (qualitySeen || !QUALITY.test(rawValue)) {
          valid = false
          break
        }
        quality = Number(rawValue)
        qualitySeen = true
        continue
      }
      if (qualitySeen) {
        if (parseParameterValue(rawValue) === undefined) {
          valid = false
          break
        }
        continue // Accept extensions are not representation parameters.
      }
      const parsedValue = parseParameterValue(rawValue)
      if (parsedValue === undefined || parameters.has(name)) {
        valid = false
        break
      }
      parameters.set(name, parsedValue)
    }
    if (!valid) continue

    ranges.push({
      type,
      subtype,
      quality,
      typeSpecificity: type === "*" ? 0 : subtype === "*" ? 1 : 2,
      parameters,
    })
  }
  return ranges
}

function splitOutsideQuotes(value: string, delimiter: string): SplitResult {
  const result: string[] = []
  let start = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quoted && character === "\\") {
      escaped = true
      continue
    }
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && character === delimiter) {
      result.push(value.slice(start, index))
      start = index + 1
    }
  }
  result.push(value.slice(start))
  return { parts: result, valid: !quoted && !escaped }
}

function parseParameterValue(value: string): string | undefined {
  if (value.length === 0) return undefined
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) return undefined
    let parsed = ""
    for (let index = 1; index < value.length - 1; index += 1) {
      let character = value.charAt(index)
      if (character === '"') return undefined
      if (character === "\\") {
        index += 1
        if (index >= value.length - 1) return undefined
        character = value.charAt(index)
      }
      const code = character.charCodeAt(0)
      if ((code < 0x20 && character !== "\t") || code === 0x7f) return undefined
      parsed += character
    }
    return parsed
  }
  return TOKEN.test(value) ? value : undefined
}

function qualityFor(ranges: AcceptRange[], type: string, subtype: string): number | undefined {
  const matching = ranges.filter((range) => {
    if (range.type !== "*" && range.type !== type) return false
    if (range.subtype !== "*" && range.subtype !== subtype) return false
    for (const [name, value] of range.parameters) {
      if (name !== "charset" || value.toLowerCase() !== "utf-8") return false
    }
    return true
  })
  if (matching.length === 0) return undefined

  const typeSpecificity = Math.max(...matching.map((range) => range.typeSpecificity))
  const typeMatches = matching.filter((range) => range.typeSpecificity === typeSpecificity)
  const parameterSpecificity = Math.max(...typeMatches.map((range) => range.parameters.size))
  const mostSpecific = typeMatches.filter((range) => range.parameters.size === parameterSpecificity)
  // Conflicting duplicate ranges resolve conservatively: an explicit q=0 wins.
  return Math.min(...mostSpecific.map((range) => range.quality))
}
