/**
 * `@js_on_tracks/core` — boot, rotas, controllers, sessão e static do JOT
 * (contrato em `docs/architecture.md` §4.4).
 *
 * Os apps importam de `jot-framework`; `@js_on_tracks/core` só é usado diretamente pelo
 * CLI (manifest/entry) e pelos testes.
 */

export { type AppConfig, type CsrfConfig, defineApp } from "./app"
export {
  Controller,
  type ControllerContext,
  type JsonOptions,
  type RedirectOptions,
  type RenderOptions,
} from "./controller"
export { type DatabaseConfig, defineDatabase } from "./database"
export { env, loadDotEnv } from "./env"
export {
  type PathHelper,
  type PathHelpers,
  type PathParams,
  type PathParamValue,
  paths,
} from "./paths"
export {
  type ControllerClass,
  registerControllers,
  registerViews,
  type ViewComponent,
} from "./registry"
export {
  type ActionRef,
  type CsrfExemption,
  type HttpMethod,
  type ResourceAction,
  type ResourceOptions,
  type RouteBuilder,
  type RouteDefinition,
  type RouteOptions,
  type RouteTable,
  routes,
} from "./routes"
export {
  type CreateAppOptions,
  createApp,
  type ServerHandle,
  type StartOptions,
  start,
} from "./server"
export { SESSION_COOKIE, Session } from "./session"
