import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { MiddlewareHandler } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import pc from "picocolors"
import { isProduction } from "./env"
import { setRequestState } from "./state"

/** Nome do cookie de sessão. */
export const SESSION_COOKIE = "jot_session"

const SESSION_MAX_AGE_SECONDS = 604800 // 7 dias
const CSRF_SESSION_KEY = "__jot_csrf"
const SESSION_SERIALIZER: unique symbol = Symbol("serialize JOT session")
const DUMMY_CSRF_TOKEN = Buffer.alloc(32)

/**
 * Sessão por cookie assinado (HMAC-SHA256, `node:crypto`).
 *
 * O valor vive no contexto do controller; mutações marcam `dirty` e o middleware
 * só escreve o `Set-Cookie` no fim da request quando houve mudança.
 */
export class Session {
  #data: Record<string, unknown>
  #dirty = false
  #csrfToken: string | undefined

  constructor(data: Record<string, unknown> = {}) {
    this.#data = copySessionData(data)
    const token = this.#data[CSRF_SESSION_KEY]
    delete this.#data[CSRF_SESSION_KEY]
    if (isCanonicalCsrfToken(token)) this.#csrfToken = token
  }

  get(key: string): unknown {
    if (key === CSRF_SESSION_KEY) return undefined
    return this.#data[key]
  }

  set(key: string, value: unknown): void {
    assertNotReserved(key)
    this.#data[key] = value
    this.#dirty = true
  }

  has(key: string): boolean {
    if (key === CSRF_SESSION_KEY) return false
    return Object.hasOwn(this.#data, key)
  }

  delete(key: string): void {
    assertNotReserved(key)
    if (!Object.hasOwn(this.#data, key)) return
    delete this.#data[key]
    this.#dirty = true
  }

  /** Cópia dos dados da sessão. */
  all(): Record<string, unknown> {
    return { ...this.#data }
  }

  /** Token synchronizer estável da sessão; cria e persiste se necessário. */
  csrfToken(): string {
    if (this.#csrfToken === undefined) {
      this.#csrfToken = randomBytes(32).toString("base64url")
      this.#dirty = true
    }
    return this.#csrfToken
  }

  /** Valida sem criar token; toda entrada executa uma comparação de 32 bytes. */
  verifyCsrfToken(candidate: unknown): boolean {
    const candidateValid = isCanonicalCsrfToken(candidate)
    const storedValid = isCanonicalCsrfToken(this.#csrfToken)
    const provided = candidateValid
      ? Buffer.from(candidate as string, "base64url")
      : DUMMY_CSRF_TOKEN
    const expected = storedValid
      ? Buffer.from(this.#csrfToken as string, "base64url")
      : DUMMY_CSRF_TOKEN
    const matches = timingSafeEqual(provided, expected)
    return candidateValid && storedValid && matches
  }

  /** Substitui explicitamente o token (por exemplo, depois de autenticar/sair). */
  rotateCsrfToken(): string {
    this.#csrfToken = randomBytes(32).toString("base64url")
    this.#dirty = true
    return this.#csrfToken
  }

  /** Serializador privado: o token nunca aparece em `all()`/dados públicos. */
  [SESSION_SERIALIZER](): Record<string, unknown> {
    const data = { ...this.#data }
    if (this.#csrfToken !== undefined) data[CSRF_SESSION_KEY] = this.#csrfToken
    return data
  }

  /** `true` quando a sessão mudou e precisa ser reescrita no cookie. */
  get dirty(): boolean {
    return this.#dirty
  }
}

function assertNotReserved(key: string): void {
  if (key === CSRF_SESSION_KEY) {
    throw new Error(
      "Session key `__jot_csrf` is reserved; use `csrfToken()` or `rotateCsrfToken()`.",
    )
  }
}

function isCanonicalCsrfToken(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false
  const decoded = Buffer.from(value, "base64url")
  return decoded.length === 32 && decoded.toString("base64url") === value
}

function copySessionData(data: Record<string, unknown> = {}): Record<string, unknown> {
  const copy = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(data)) copy[key] = data[key]
  return copy
}

/** Segredo resolvido no boot. */
export interface ResolvedSecret {
  secret: string
  /** `true` quando o segredo foi gerado aleatoriamente (dev sem JOT_SECRET). */
  generated: boolean
}

/**
 * Resolve o segredo da sessão: opção explícita > `JOT_SECRET`. Em produção sem
 * segredo é erro didático; em dev gera um aleatório por boot com aviso.
 */
export function resolveSecret(secret?: string): ResolvedSecret {
  const fromOption = secret?.trim()
  if (fromOption !== undefined && fromOption.length > 0) {
    assertStrongSecret(fromOption)
    return { secret: fromOption, generated: false }
  }
  const fromEnv = process.env.JOT_SECRET?.trim()
  if (fromEnv !== undefined && fromEnv.length > 0) {
    assertStrongSecret(fromEnv)
    return { secret: fromEnv, generated: false }
  }
  if (isProduction()) {
    throw new Error(
      "JOT_SECRET is required in production. " +
        "Set JOT_SECRET in .env (e.g. JOT_SECRET=<32 random bytes>) " +
        "or pass `secret` to createApp()/start().",
    )
  }
  console.warn(
    pc.yellow(
      "JOT_SECRET is not set; using a random secret for this boot. " +
        "Sessions will not survive a restart — set JOT_SECRET in .env to keep them.",
    ),
  )
  return { secret: randomBytes(32).toString("hex"), generated: true }
}

export interface SessionMiddlewareOptions {
  secret: string
  /** `true` em produção: adiciona `Secure` ao cookie. */
  production: boolean
}

/** Lê o cookie assinado no início da request e o reescreve no fim, se mudou. */
export function sessionMiddleware(options: SessionMiddlewareOptions): MiddlewareHandler {
  const { secret, production } = options
  return async (c, next) => {
    const session = new Session(decodeSession(getCookie(c, SESSION_COOKIE), secret))
    setRequestState(c, { session, flash: {} })
    await next()
    if (!session.dirty) return
    const data = session[SESSION_SERIALIZER]()
    if (Object.keys(data).length === 0) {
      deleteCookie(c, SESSION_COOKIE, { path: "/" })
      return
    }
    setCookie(c, SESSION_COOKIE, encodeSession(data, secret), {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: production,
      maxAge: SESSION_MAX_AGE_SECONDS,
    })
  }
}

function assertStrongSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(
      "JOT_SECRET must contain at least 32 UTF-8 bytes. Replace it with 32 random bytes (for example, `node --input-type=module -e \"import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))\"`) and restart the server.",
    )
  }
}

function encodeSession(data: Record<string, unknown>, secret: string): string {
  const payload = Buffer.from(JSON.stringify(data), "utf8").toString("base64url")
  return `${payload}.${sign(payload, secret)}`
}

/** Cookie inválido/adulterado nunca derruba a request: vira sessão vazia. */
function decodeSession(value: string | undefined, secret: string): Record<string, unknown> {
  if (value === undefined || value.length === 0) return copySessionData()
  const separator = value.lastIndexOf(".")
  if (separator <= 0 || separator === value.length - 1) return copySessionData()
  const payload = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  if (!verify(payload, signature, secret)) return copySessionData()
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return copySessionData(parsed as Record<string, unknown>)
    }
  } catch {
    // JSON corrompido no payload: sessão vazia.
  }
  return copySessionData()
}

function verify(payload: string, signature: string, secret: string): boolean {
  const provided = Buffer.from(signature)
  const expected = Buffer.from(sign(payload, secret))
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url")
}
