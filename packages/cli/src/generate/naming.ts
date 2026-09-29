import { camelCase, pascalCase } from "../naming"

/**
 * Singular simples espelhando `@js_on_tracks/core/src/naming.ts`:
 * `ies$` → `y`; `(s|x|z|ch|sh)es$` → remove `es`; `s$` → remove `s`.
 */
export function singularize(name: string): string {
  if (/ies$/.test(name)) return name.replace(/ies$/, "y")
  if (/(s|x|z|ch|sh)es$/.test(name)) return name.slice(0, -2)
  if (/s$/.test(name)) return name.slice(0, -1)
  return name
}

/** Plural simples: `y$` → `ies`; `(s|x|z|ch|sh)$` → `+es`; senão `+s`. */
export function pluralize(name: string): string {
  if (/y$/.test(name)) return name.replace(/y$/, "ies")
  if (/(s|x|z|ch|sh)$/.test(name)) return `${name}es`
  return `${name}s`
}

/** `author_id` → `authorId`-style: espelha o `toSnakeCase` do `@js_on_tracks/db` (colunas). */
export function snakeCase(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
}

/** Nomes derivados de um resource (`post`, `Posts`, `blog_post`, ...). */
export interface ResourceNames {
  /** Tabela/view dir/helper plural: `posts`. */
  readonly table: string
  /** Singular em snake_case: `post`. */
  readonly singular: string
  /** Singular em PascalCase (`Post`) — nome da classe do model. */
  readonly singularIdent: string
  /** Plural em PascalCase (`Posts`) — prefixo do controller e das views. */
  readonly pluralIdent: string
  /** Arquivo do model, sem extensão: `post`. */
  readonly singularFile: string
  /** Arquivo do controller: `posts_controller.ts`. */
  readonly controllerFile: string
  /** Classe do controller: `PostsController`. */
  readonly controllerClass: string
  /** Diretório das views: `posts`. */
  readonly viewsDir: string
  /** Helper singular de `paths` (`post`, `blogPost`). */
  readonly helper: string
  /** Helper plural de `paths` (`posts`, `blogPosts`). */
  readonly helperPlural: string
}

/**
 * Deriva os nomes do resource. Aceita singular ou plural (`post`, `Posts`,
 * `blog_posts`); namespaces (`admin/posts`) não são suportados no M2.
 */
export function resourceNames(rawName: string): ResourceNames {
  const snake = snakeCase(rawName)
  const isPlural = snake.endsWith("s") && singularize(snake) !== snake
  const singular = isPlural ? singularize(snake) : snake
  const table = isPlural ? snake : pluralize(snake)
  const singularIdent = pascalCase(singular)
  const pluralIdent = pascalCase(table)

  return {
    table,
    singular,
    singularIdent,
    pluralIdent,
    singularFile: singular,
    controllerFile: `${table}_controller.ts`,
    controllerClass: `${pluralIdent}Controller`,
    viewsDir: table,
    helper: camelCase(singular),
    helperPlural: camelCase(table),
  }
}
