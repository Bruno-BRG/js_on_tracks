/**
 * Utilitários de nomes usados pela DSL de rotas e pelo render automático:
 * `snake`, `pascal`, `camel` e `singularize`.
 *
 * `snake`/`pascal` preservam `/` para namespaces de controller (`Admin/Posts`).
 */

/** Converte para `snake_case`, preservando `/` (ex.: `Admin/Posts` → `admin/posts`). */
export function snake(name: string): string {
  return name.split("/").map(snakeSegment).join("/")
}

function snakeSegment(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase()
}

/** Converte para `PascalCase`, preservando `/` (ex.: `admin/posts` → `Admin/Posts`). */
export function pascal(name: string): string {
  return name.split("/").map(pascalSegment).join("/")
}

function pascalSegment(segment: string): string {
  return segment
    .split(/[_\-\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

/** Minúscula na primeira letra (ex.: `Post` → `post`, `AdminPosts` → `adminPosts`). */
export function camel(name: string): string {
  return name.length === 0 ? name : name.charAt(0).toLowerCase() + name.slice(1)
}

/**
 * Singular simples para helpers de `resource` (§4.4):
 * `ies$` → `y`; `(s|x|z|ch|sh)es$` → remove `es`; `s$` → remove `s`.
 */
export function singularize(name: string): string {
  if (/ies$/.test(name)) return name.replace(/ies$/, "y")
  if (/(s|x|z|ch|sh)es$/.test(name)) return name.slice(0, -2)
  if (/s$/.test(name)) return name.slice(0, -1)
  return name
}
