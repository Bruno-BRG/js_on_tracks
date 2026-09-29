/**
 * Escape de HTML do `@js_on_tracks/views` (contrato §4.3).
 *
 * - Texto entre tags: escapa `&`, `<`, `>`, `"` e `'`.
 * - Valores de atributo (sempre entre aspas duplas): escapa `&`, `"` e `<`.
 *
 * Toda saída dinâmica do `renderToString` passa por aqui; somente `raw()` é pulado.
 */

const TEXT_REPLACEMENTS: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

const TEXT_PATTERN = /[&<>"']/g

/** Escapa um valor de texto (conteúdo entre tags). */
export function escapeText(text: string): string {
  return text.replace(TEXT_PATTERN, (character) => TEXT_REPLACEMENTS[character])
}

const ATTRIBUTE_REPLACEMENTS: Record<string, string> = {
  "&": "&amp;",
  '"': "&quot;",
  "<": "&lt;",
}

const ATTRIBUTE_PATTERN = /[&"<]/g

/** Escapa um valor de atributo; o render sempre emite atributos entre `"`. */
export function escapeAttribute(text: string): string {
  return text.replace(ATTRIBUTE_PATTERN, (character) => ATTRIBUTE_REPLACEMENTS[character])
}
