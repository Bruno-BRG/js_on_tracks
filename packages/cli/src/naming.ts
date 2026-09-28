import { CliError } from "./output"

const WORD_SEPARATORS = /[^A-Za-z0-9]+/

/** `home_controller` → `Home`; `admin-posts` → `AdminPosts`. */
export function pascalCase(value: string): string {
  return words(value)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("")
}

/** `posts/index` → `postsIndex`. */
export function camelCase(value: string): string {
  const pascal = pascalCase(value)
  return pascal.length === 0 ? "" : pascal[0].toLowerCase() + pascal.slice(1)
}

/**
 * Chave de registry de um controller a partir do caminho relativo:
 * `admin/posts_controller.ts` → `Admin/Posts`.
 */
export function controllerKey(relativePath: string): string {
  const base = relativePath.replace(/\.ts$/, "").replace(/_controller$/, "")
  return segments(base).map(pascalCase).join("/")
}

/** Nome de view a partir do caminho relativo: `posts/index.tsx` → `posts/index`. */
export function viewKey(relativePath: string): string {
  return relativePath.replace(/\.tsx$/, "")
}

/** Identificador importado no manifest: `Admin/Posts` → `AdminPostsController`. */
export function controllerIdent(key: string): string {
  return `${segments(key).map(pascalCase).join("")}Controller`
}

/** Identificador importado no manifest: `posts/index` → `postsIndex`. */
export function viewIdent(key: string): string {
  return camelCase(key)
}

/** Par arquivo→identificador usado na detecção de colisão. */
export interface NamedImport {
  /** Caminho exibido no erro (relativo, com `/`). */
  readonly file: string
  readonly ident: string
}

/**
 * Garante que dois imports gerados não usem o mesmo identificador (o TypeScript
 * não aceitaria o manifest).
 */
export function assertUniqueIdents(entries: readonly NamedImport[]): void {
  const seen = new Map<string, string>()
  for (const entry of entries) {
    const previous = seen.get(entry.ident)
    if (previous !== undefined) {
      throw new CliError(
        `Generated import name collision between "${previous}" and "${entry.file}". Rename one of them.`,
      )
    }
    seen.set(entry.ident, entry.file)
  }
}

function segments(value: string): string[] {
  return value.split("/").filter((segment) => segment.length > 0)
}

function words(value: string): string[] {
  return value.split(WORD_SEPARATORS).filter((part) => part.length > 0)
}
