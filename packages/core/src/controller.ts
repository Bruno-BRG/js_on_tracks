import type { Context } from "hono"
import { isProduction } from "./env"
import { notFoundPage } from "./errors"
import { textResponse, toRedirectStatusCode, toStatusCode } from "./http"
import { renderView } from "./render"
import type { Session } from "./session"

const HTML_CONTENT_TYPE = "text/html; charset=utf-8"

/** Opções de `this.render(view, props?, options?)`. */
export interface RenderOptions {
  /** Status HTTP da resposta (default: `this.status` ou 200). */
  status?: number
  /** Layout registrado (default: `layouts/application`); `false` desliga o layout. */
  layout?: string | false
}

/** Opções de `this.redirectTo(path, options?)`. */
export interface RedirectOptions {
  /** Grava flash para o próximo render (`notice`, `alert`, ...). */
  flash?: Record<string, unknown>
  /** Status do redirect (default: 303). */
  status?: number
}

/** Opções de `this.json(data, options?)`. */
export interface JsonOptions {
  status?: number
}

/** O que o dispatch entrega ao controller. */
export interface ControllerContext {
  /** Route params + query + campos string do body (route param vence). */
  params: Record<string, string>
  /** Somente a query string. */
  query: Record<string, string>
  /** Body parseado: urlencoded/multipart → strings/Files (arrays para campos repetidos); JSON → valores. */
  body: Record<string, unknown>
  /** Sessão por cookie assinado. */
  session: Session
  /** Flash disponível nesta request (mutável; consumido no render). */
  flash: Record<string, unknown>
  /** Contexto Hono — escape hatch. */
  request: Context
}

/**
 * Base dos controllers JOT.
 *
 * ```ts
 * export default class PostsController extends Controller {
 *   async index() {
 *     return this.render("posts/index", { posts: await Post.all() })
 *   }
 * }
 * ```
 *
 * Actions devem ser **métodos de protótipo** (`async index() {}`), não class
 * fields — o boot descobre as actions pelo protótipo da classe.
 */
export abstract class Controller {
  readonly params: Record<string, string>
  readonly query: Record<string, string>
  readonly body: Record<string, unknown>
  readonly session: Session
  readonly flash: Record<string, unknown>
  readonly request: Context

  /** Status default do próximo `render()` (default 200). */
  status?: number

  constructor(context: ControllerContext) {
    this.params = context.params
    this.query = context.query
    this.body = context.body
    this.session = context.session
    this.flash = context.flash
    this.request = context.request
  }

  /** Renderiza uma view com o layout default (flash consumido ao final). */
  async render(
    view: string,
    props: Record<string, unknown> = {},
    options: RenderOptions = {},
  ): Promise<Response> {
    const status = options.status ?? this.status ?? 200
    const csrfToken = this.csrfToken()
    const html = await renderView(view, props, options.layout, this.flash, csrfToken)
    this.session.delete("flash")
    const response = textResponse(this.request, html, toStatusCode(status), HTML_CONTENT_TYPE)
    response.headers.set("Cache-Control", "private, no-store")
    return response
  }

  /** Token para formulários/API; qualquer resposta que o use não pode ser cacheada. */
  csrfToken(): string {
    this.request.header("Cache-Control", "private, no-store")
    return this.session.csrfToken()
  }

  /** Redirect (default 303), opcionalmente gravando flash para o próximo render. */
  redirectTo(path: string, options: RedirectOptions = {}): Response {
    if (options.flash !== undefined) {
      this.session.set("flash", { ...this.flash, ...options.flash })
    }
    return this.request.redirect(path, toRedirectStatusCode(options.status ?? 303))
  }

  /** Resposta JSON. */
  json(data: unknown, options: JsonOptions = {}): Response {
    const body = JSON.stringify(data) ?? "null"
    return textResponse(this.request, body, toStatusCode(options.status ?? 200), "application/json")
  }

  /** Página 404 amigável (usa a mesma página do `notFoundHandler`). */
  renderNotFound(message?: string): Response {
    const html = notFoundPage({
      dev: !isProduction(),
      method: this.request.req.method,
      path: this.request.req.path,
      message,
    })
    this.session.delete("flash")
    return textResponse(this.request, html, 404, HTML_CONTENT_TYPE)
  }
}
