import type { RouteDefinition } from "./routes"

/** Valor aceito num parâmetro de rota (`/posts/:id`). */
export type PathParamValue = string | number

/** Params de um helper: valor único (primeiro param) ou objeto por nome. */
export type PathParams = PathParamValue | Readonly<Record<string, PathParamValue>>

/** Função de helper (`paths.post(3)` → `/posts/3`). */
export type PathHelper = (params?: PathParams) => string

/** Mapa de helpers (`paths`). */
export type PathHelpers = Record<string, PathHelper>

/** Padrão registrado para um helper. */
interface HelperPattern {
  readonly name: string
  readonly path: string
  readonly params: readonly string[]
}

const helperPatterns = new Map<string, HelperPattern>()
const helperFunctions = new Map<string, PathHelper>()

/**
 * `paths` global: funções vindas do registry de rotas. É um `Proxy` didático —
 * helper inexistente lança um erro que ensina a definir a rota, em vez de
 * `undefined is not a function`.
 */
export const paths: PathHelpers = new Proxy({} as PathHelpers, {
  get(_target, property) {
    if (typeof property !== "string") return undefined
    const helper = helperFunctions.get(property)
    if (helper === undefined) throw unknownHelperError(property)
    return helper
  },
  has(_target, property) {
    return typeof property === "string" && helperFunctions.has(property)
  },
  ownKeys() {
    return [...helperFunctions.keys()]
  },
  getOwnPropertyDescriptor(_target, property) {
    if (typeof property !== "string") return undefined
    const helper = helperFunctions.get(property)
    if (helper === undefined) return undefined
    return { configurable: true, enumerable: true, writable: false, value: helper }
  },
})

/**
 * Registra os helpers de uma tabela de rotas (chamado por `routes()` e por
 * `createApp()`). Helper duplicado é erro didático.
 */
export function setPathHelpers(definitions: readonly RouteDefinition[]): void {
  const patterns = new Map<string, HelperPattern>()
  for (const definition of definitions) {
    if (definition.as === undefined) continue
    const pattern: HelperPattern = {
      name: definition.as,
      path: definition.path,
      params: readParamNames(definition.path),
    }
    const existing = patterns.get(pattern.name)
    if (existing !== undefined) {
      throw new Error(
        `Duplicate route helper "paths.${pattern.name}" in config/routes.ts: ` +
          `"${existing.path}" and "${pattern.path}" both use as: "${pattern.name}". ` +
          `Use a unique \`as\` for each route.`,
      )
    }
    patterns.set(pattern.name, pattern)
  }

  helperPatterns.clear()
  helperFunctions.clear()
  for (const [name, pattern] of patterns) {
    helperPatterns.set(name, pattern)
    helperFunctions.set(name, createHelper(pattern))
  }
}

/** Nomes registrados (útil para CLI/testes). */
export function getPathHelperNames(): string[] {
  return [...helperPatterns.keys()]
}

function createHelper(pattern: HelperPattern): PathHelper {
  if (pattern.params.length === 0) {
    return () => pattern.path
  }
  return (params?: PathParams) => {
    const values = resolveParams(pattern, params)
    return pattern.path.replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) =>
      encodeURIComponent(String(values[key])),
    )
  }
}

function resolveParams(
  pattern: HelperPattern,
  params: PathParams | undefined,
): Readonly<Record<string, PathParamValue>> {
  if (params === undefined || params === null) throw missingParamsError(pattern, [])
  if (typeof params === "string" || typeof params === "number") {
    if (pattern.params.length !== 1) throw singleValueError(pattern)
    const name = pattern.params[0]
    if (name === undefined) throw singleValueError(pattern)
    return { [name]: checkParamValue(pattern, name, params) }
  }
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new Error(
      `paths.${pattern.name}() expected an object with parameters ${formatParamNames(pattern.params)}, ` +
        `but received ${describeValue(params)}. Use paths.${pattern.name}({ ${pattern.params[0] ?? "id"}: 1 }).`,
    )
  }
  const values: Record<string, PathParamValue> = {}
  const missing: string[] = []
  for (const name of pattern.params) {
    const value = (params as Record<string, unknown>)[name]
    if (value === undefined || value === null) {
      missing.push(name)
      continue
    }
    values[name] = checkParamValue(pattern, name, value)
  }
  if (missing.length > 0) throw missingParamsError(pattern, missing)
  return values
}

function checkParamValue(pattern: HelperPattern, name: string, value: unknown): PathParamValue {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  throw new Error(
    `paths.${pattern.name}() expected a string or number for "${name}", ` +
      `but received ${describeValue(value)}.`,
  )
}

function readParamNames(path: string): string[] {
  const names: string[] = []
  for (const match of path.matchAll(/:([A-Za-z0-9_]+)/g)) {
    const name = match[1]
    if (name !== undefined) names.push(name)
  }
  return names
}

function missingParamsError(pattern: HelperPattern, missing: readonly string[]): Error {
  const names = missing.length > 0 ? missing : pattern.params
  const sample = names.map((name) => `${name}: 1`).join(", ")
  return new Error(
    `paths.${pattern.name}() is missing ${names.length === 1 ? "the parameter" : "parameters"} ` +
      `${formatParamNames(names)}. Use paths.${pattern.name}({ ${sample} })` +
      `${names.length === 1 ? ` or paths.${pattern.name}(1)` : ""}.`,
  )
}

function singleValueError(pattern: HelperPattern): Error {
  const sample = pattern.params.map((name) => `${name}: 1`).join(", ")
  return new Error(
    `paths.${pattern.name}() needs parameters ${formatParamNames(pattern.params)}; ` +
      `a single value is not enough. Use paths.${pattern.name}({ ${sample} }).`,
  )
}

function unknownHelperError(name: string): Error {
  return new Error(
    `Route helper "paths.${name}" is not defined. Define the route in config/routes.ts ` +
      `(e.g. r.get("/${name}", "controller#action", { as: "${name}" })) ` +
      `or restart \`jot server\` to regenerate the manifest.`,
  )
}

function formatParamNames(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(", ")
}

function describeValue(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "an array"
  if (typeof value === "string") return `string ${JSON.stringify(value)}`
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return `${typeof value} ${String(value)}`
  }
  return typeof value
}
