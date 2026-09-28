import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { MiddlewareHandler } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import pc from "picocolors"
import { isProduction } from "./env"
import { setRequestState } from "./state"

/** Nome do cookie de sessão. */
export const SESSION_COOKIE = "jot_session"

const SESSION_MAX_AGE_SECONDS = 604800 // 7 dias

/**
 * Sessão por cookie assinado (HMAC-SHA256, `node:crypto`).
 *
 * O valor vive no contexto do controller; mutações marcam `dirty` e o middleware
 * só escreve o `Set-Cookie` no fim da request quando houve mudança.
 */
export class Session {
  #data: Record<string, unknown>
  #dirty = false

  constructor(data: Record<string, unknown> = {}) {
    this.#data = { ...data }
  }

  get(key: string): unknown {
    return this.#data[key]
  }

  set(key: string, value: unknown): void {
    this.#data[key] = value
    this.#dirty = true
  }

  has(key: string): boolean {
    return Object.hasOwn(this.#data, key)
  }

  delete(key: string): void {
    if (!Object.hasOwn(this.#data, key)) return
    delete this.#data[key]
    this.#dirty = true
  }

  /** Cópia dos dados da sessão. */
  all(): Record<string, unknown> {
    return { ...this.#data }
  }

  /** `true` quando a sessão mudou e precisa ser reescrita no cookie. */
  get dirty(): boolean {
    return this.#dirty
  }
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
    return { secret: fromOption, generated: false }
  }
  const fromEnv = process.env.JOT_SECRET?.trim()
  if (fromEnv !== undefined && fromEnv.length > 0) {
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
    const data = session.all()
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

function encodeSession(data: Record<string, unknown>, secret: string): string {
  const payload = Buffer.from(JSON.stringify(data), "utf8").toString("base64url")
  return `${payload}.${sign(payload, secret)}`
}

/** Cookie inválido/adulterado nunca derruba a request: vira sessão vazia. */
function decodeSession(value: string | undefined, secret: string): Record<string, unknown> {
  if (value === undefined || value.length === 0) return {}
  const separator = value.lastIndexOf(".")
  if (separator <= 0 || separator === value.length - 1) return {}
  const payload = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  if (!verify(payload, signature, secret)) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // JSON corrompido no payload: sessão vazia.
  }
  return {}
}

function verify(payload: string, signature: string, secret: string): boolean {
  const provided = Buffer.from(signature)
  const expected = Buffer.from(sign(payload, secret))
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url")
}
