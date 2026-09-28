import { camel, pascal, singularize } from "./naming"
import { setPathHelpers } from "./paths"

/** Métodos HTTP da DSL. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/** Alvo de uma rota no formato `"controller#action"` (ex.: `"posts#index"`). */
export type ActionRef = `${string}#${string}`

/** Ações convencionais de `r.resource(...)`. */
export type ResourceAction = "index" | "new" | "create" | "show" | "edit" | "update" | "destroy"

/** Opções de uma rota avulsa; `as` define o nome do helper em `paths`. */
export interface RouteOptions {
  as?: string
}

/** Filtros de `r.resource(...)`; `only` e `except` são mutuamente exclusivos. */
export interface ResourceOptions {
  only?: readonly ResourceAction[]
  except?: readonly ResourceAction[]
}

/** Rota resolvida da DSL. */
export interface RouteDefinition {
  readonly method: HttpMethod
  /** Caminho Hono, com `:params` (ex.: `/posts/:id`). */
  readonly path: string
  /** Controller como escrito na DSL (ex.: `posts`, `admin/posts`). */
  readonly controller: string
  /** Chave no registry de controllers (ex.: `Posts`, `Admin/Posts`). */
  readonly controllerKey: string
  readonly action: string
  /** Nome do helper em `paths`, quando a rota tem um. */
  readonly as?: string
}

/** Tabela imutável devolvida por `routes()`. */
export interface RouteTable {
  readonly definitions: readonly RouteDefinition[]
}

/** Builder fluente passado para `routes((r) => ...)`. */
export interface RouteBuilder {
  /** `GET /` (helper `paths.root()`). */
  root(to: ActionRef): RouteBuilder
  get(path: string, to: ActionRef, options?: RouteOptions): RouteBuilder
  post(path: string, to: ActionRef, options?: RouteOptions): RouteBuilder
  put(path: string, to: ActionRef, options?: RouteOptions): RouteBuilder
  patch(path: string, to: ActionRef, options?: RouteOptions): RouteBuilder
  delete(path: string, to: ActionRef, options?: RouteOptions): RouteBuilder
  /** Expande as rotas REST convencionais de um resource. */
  resource(name: string, options?: ResourceOptions): RouteBuilder
}

const RESOURCE_ACTIONS: readonly ResourceAction[] = [
  "index",
  "new",
  "create",
  "show",
  "edit",
  "update",
  "destroy",
]

interface ResourceSpec {
  readonly action: ResourceAction
  readonly method: HttpMethod
  readonly path: string
  readonly as?: string
}

/**
 * Declara as rotas do app (`config/routes.ts`).
 *
 * ```ts
 * export default routes((r) => {
 *   r.root("home#index")
 *   r.get("/about", "pages#about", { as: "about" })
 *   r.resource("posts")
 * })
 * ```
 */
export function routes(build: (r: RouteBuilder) => void): RouteTable {
  const definitions: RouteDefinition[] = []
  build(createBuilder(definitions))
  const table: RouteTable = { definitions: Object.freeze(definitions.slice()) }
  setPathHelpers(table.definitions)
  return table
}

function createBuilder(definitions: RouteDefinition[]): RouteBuilder {
  const add = (method: HttpMethod, path: string, to: ActionRef, as?: string): void => {
    const { controller, action } = parseActionRef(to)
    const normalizedPath = normalizePath(path)
    const duplicate = definitions.find(
      (definition) => definition.method === method && definition.path === normalizedPath,
    )
    if (duplicate !== undefined) {
      throw new Error(
        `Duplicate route ${method} ${normalizedPath} in config/routes.ts ` +
          `(both point to "${duplicate.controller}#${duplicate.action}"). Remove one of them.`,
      )
    }
    const definition: RouteDefinition = {
      method,
      path: normalizedPath,
      controller,
      controllerKey: pascal(controller),
      action,
      ...(as !== undefined ? { as } : {}),
    }
    definitions.push(Object.freeze(definition))
  }

  const builder: RouteBuilder = {
    root(to) {
      add("GET", "/", to, "root")
      return builder
    },
    get(path, to, options) {
      add("GET", path, to, options?.as)
      return builder
    },
    post(path, to, options) {
      add("POST", path, to, options?.as)
      return builder
    },
    put(path, to, options) {
      add("PUT", path, to, options?.as)
      return builder
    },
    patch(path, to, options) {
      add("PATCH", path, to, options?.as)
      return builder
    },
    delete(path, to, options) {
      add("DELETE", path, to, options?.as)
      return builder
    },
    resource(name, options) {
      for (const spec of resourceSpecs(name, options)) {
        add(spec.method, spec.path, `${name}#${spec.action}`, spec.as)
      }
      return builder
    },
  }
  return builder
}

function parseActionRef(ref: string): { controller: string; action: string } {
  const separator = ref.indexOf("#")
  const controller = separator === -1 ? "" : ref.slice(0, separator).trim()
  const action = separator === -1 ? "" : ref.slice(separator + 1).trim()
  if (controller.length === 0 || action.length === 0) {
    throw new Error(
      `Invalid route target ${JSON.stringify(ref)} in config/routes.ts. ` +
        `Use "controller#action" (e.g. "posts#index").`,
    )
  }
  return { controller, action }
}

function normalizePath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed.startsWith("/")) {
    throw new Error(
      `Invalid route path ${JSON.stringify(path)} in config/routes.ts. ` +
        `Paths must start with "/" (e.g. "/about").`,
    )
  }
  return trimmed.length > 1 && trimmed.endsWith("/") ? trimmed.replace(/\/+$/, "") : trimmed
}

function resourceSpecs(name: string, options: ResourceOptions | undefined): ResourceSpec[] {
  if (options?.only !== undefined && options.except !== undefined) {
    throw new Error(
      `r.resource("${name}") cannot use "only" and "except" together in config/routes.ts. Pick one.`,
    )
  }
  const base = name.trim().replace(/^\/+|\/+$/g, "")
  const segments = base.split("/").filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    throw new Error(
      `r.resource() needs a resource name in config/routes.ts (e.g. r.resource("posts")).`,
    )
  }
  const invalid = segments.find((segment) => !/^[A-Za-z0-9_]+$/.test(segment))
  if (invalid !== undefined) {
    throw new Error(
      `Invalid resource name ${JSON.stringify(name)} in config/routes.ts. ` +
        `Use letters, numbers and underscores (e.g. "posts" or "admin/posts").`,
    )
  }

  const pathBase = `/${segments.join("/")}`
  const namespace = segments
    .slice(0, -1)
    .map((segment) => pascal(segment))
    .join("")
  const helperBase = pascal(segments.join("_"))
  const lastSegment = segments[segments.length - 1] ?? "item"
  const helperSingular = `${namespace}${pascal(singularize(lastSegment))}`
  const selected = selectResourceActions(name, options)

  const specs: ResourceSpec[] = [
    { action: "index", method: "GET", path: pathBase, as: camel(helperBase) },
    { action: "new", method: "GET", path: `${pathBase}/new`, as: `new${helperSingular}` },
    { action: "create", method: "POST", path: pathBase },
    { action: "show", method: "GET", path: `${pathBase}/:id`, as: camel(helperSingular) },
    { action: "edit", method: "GET", path: `${pathBase}/:id/edit`, as: `edit${helperSingular}` },
    { action: "update", method: "PUT", path: `${pathBase}/:id` },
    { action: "update", method: "PATCH", path: `${pathBase}/:id` },
    { action: "destroy", method: "DELETE", path: `${pathBase}/:id` },
  ]
  return specs.filter((spec) => selected.has(spec.action))
}

function selectResourceActions(
  name: string,
  options: ResourceOptions | undefined,
): ReadonlySet<ResourceAction> {
  if (options?.only !== undefined) {
    for (const action of options.only) assertResourceAction(name, action)
    return new Set(options.only)
  }
  const selected = new Set<ResourceAction>(RESOURCE_ACTIONS)
  if (options?.except !== undefined) {
    for (const action of options.except) {
      assertResourceAction(name, action)
      selected.delete(action)
    }
  }
  return selected
}

function assertResourceAction(name: string, action: ResourceAction): void {
  if (!RESOURCE_ACTIONS.includes(action)) {
    throw new Error(
      `Unknown resource action ${JSON.stringify(action)} in r.resource("${name}") (config/routes.ts). ` +
        `Valid actions: ${RESOURCE_ACTIONS.join(", ")}.`,
    )
  }
}
