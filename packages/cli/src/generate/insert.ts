import { CliError } from "../output"
import type { ResourceSpec } from "./parse"
import { renderTableBlock, tableBuilders } from "./render"
import { insertResourceWithAst } from "./routes-ast"
import { detectEol } from "./write"

/**
 * Edição textual e idempotente de `db/schema.ts`: garante o import do
 * `jot-framework`, remove o `export {}` do template e anexa a tabela.
 *
 * Duplicata (identificador ou `table("posts")`) falha com a linha exata —
 * a detecção de duplicata é a idempotência, não há marcador mágico.
 */
export function insertTable(source: string, resource: ResourceSpec): string {
  const { table } = resource.names
  const code = maskSource(source)

  const declared = new RegExp(`^export const ${table}\\b`, "m").exec(code)
  const duplicateIndex = declared?.index ?? findTableCall(code, source, table)
  if (duplicateIndex !== undefined) {
    throw new CliError(
      `db/schema.ts already defines table "${table}" (line ${lineOf(source, duplicateIndex)}). ` +
        "Remove it or pick another name.",
    )
  }

  const eol = detectEol(source)
  const needed = tableBuilders(resource)
  const importMatch = /^import\s*\{([^}]*)\}\s*from\s*["']jot-framework["']/m.exec(
    maskComments(source),
  )

  let content: string
  if (importMatch === null) {
    content = `import { ${needed.join(", ")} } from "jot-framework"${eol}${eol}${source}`
  } else {
    const existing = importMatch[1]
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
    const missing = needed.filter((name) => !existing.includes(name))
    const start = importMatch.index
    const end = start + importMatch[0].length
    const replacement =
      missing.length === 0
        ? source.slice(start, end)
        : `import { ${[...existing, ...missing].join(", ")} } from "jot-framework"`
    content = source.slice(0, start) + replacement + source.slice(end)
  }

  // O `export {}` do template só existia para o arquivo vazio.
  content = content.replace(/^[ \t]*export\s*\{\s*\}[ \t]*(?:\r?\n)?/m, "")
  const trimmed = content.trimEnd()
  return `${trimmed}${eol}${eol}${renderTableBlock(resource, eol)}${eol}`
}

/**
 * Edição textual e idempotente de `config/routes.ts`: insere `r.resource("posts")`
 * dentro do builder `routes(...)`, com a indentação do bloco.
 */
export function insertResource(
  source: string,
  resource: ResourceSpec,
  root: string,
): Promise<string> {
  return insertResourceWithAst(source, resource, root)
}

interface Token {
  readonly kind: "identifier" | "string" | "dynamic-string" | "punctuation"
  readonly value: string
  readonly start: number
  readonly end: number
}

function startsRegexLiteral(tokens: readonly Token[]): boolean {
  const last = tokens.at(-1)
  if (last === undefined) return true
  if (
    ["=", "(", "[", "{", ",", ":", ";", "!", "?", "&", "|", "+", "-", "*", "%", "~"].includes(
      last.value,
    )
  ) {
    return true
  }
  if (last.value === ">" && tokens.at(-2)?.value === "=") return true
  return (
    last.kind === "identifier" &&
    [
      "return",
      "throw",
      "case",
      "delete",
      "void",
      "typeof",
      "instanceof",
      "in",
      "of",
      "yield",
      "await",
      "else",
      "do",
    ].includes(last.value)
  )
}

function skipRegexLiteral(source: string, start: number): number {
  let index = start + 1
  let inCharacterClass = false
  while (index < source.length) {
    const char = source[index] ?? ""
    if (char === "\\") {
      index += 2
      continue
    }
    if (char === "\n" || char === "\r") return index
    if (char === "[") inCharacterClass = true
    else if (char === "]") inCharacterClass = false
    else if (char === "/" && !inCharacterClass) {
      index += 1
      while (/[A-Za-z]/.test(source[index] ?? "")) index += 1
      return index
    }
    index += 1
  }
  return index
}
/** Índice do `table(` cujo 1º argumento é o nome da tabela (só em código, não em string). */
function findTableCall(code: string, source: string, table: string): number | undefined {
  const pattern = /\btable\s*\(/g
  let match = pattern.exec(code)
  while (match !== null) {
    const after = source.slice(match.index + match[0].length)
    if (new RegExp(`^\\s*["'\`]${table}["'\`]`).test(after)) return match.index
    match = pattern.exec(code)
  }
  return undefined
}

/** Índice do `}` que fecha o `{` em `openIndex` (texto já mascarado). */
export function findMatchingBrace(masked: string, openIndex: number): number {
  let depth = 0
  for (let index = openIndex; index < masked.length; index += 1) {
    const char = masked[index]
    if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) return index
    }
  }
  throw new CliError(
    "Unbalanced braces in config/routes.ts. Fix the file and re-run this generator.",
  )
}

/** Linha (1-based) do índice no texto original. */
export function lineOf(source: string, index: number): number {
  let line = 1
  for (let cursor = 0; cursor < index && cursor < source.length; cursor += 1) {
    if (source[cursor] === "\n") line += 1
  }
  return line
}

/** Mascara comentários (`//` e `/* *\/`), preservando strings e o comprimento. */
export function maskComments(source: string): string {
  return mask(source, false)
}

/** Mascara comentários e strings, preservando o comprimento (para contar chaves). */
export function maskSource(source: string): string {
  return mask(source, true)
}

function mask(source: string, maskStrings: boolean): string {
  const chars = source.split("")
  const context: Token[] = []
  let index = 0
  while (index < chars.length) {
    const char = chars[index]
    const next = chars[index + 1]

    if (char === "/" && next === "/") {
      while (index < chars.length && chars[index] !== "\n") {
        if (chars[index] !== "\r") chars[index] = " "
        index += 1
      }
      continue
    }
    if (char === "/" && next === "*") {
      chars[index] = " "
      chars[index + 1] = " "
      index += 2
      while (index < chars.length && !(chars[index] === "*" && chars[index + 1] === "/")) {
        if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " "
        index += 1
      }
      if (index < chars.length) {
        chars[index] = " "
        chars[index + 1] = " "
        index += 2
      }
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      const start = index
      const quote = char
      index += 1
      while (index < chars.length && chars[index] !== quote) {
        if (chars[index] === "\\") {
          index += 1
          if (index < chars.length) index += 1
          continue
        }
        index += 1
      }
      if (index < chars.length) {
        index += 1
      }
      if (maskStrings) maskRange(chars, start, index)
      context.push({ kind: "string", value: "", start, end: index })
      continue
    }

    if (char === "/" && startsRegexLiteral(context)) {
      const start = index
      index = skipRegexLiteral(source, index)
      if (maskStrings) maskRange(chars, start, index)
      context.push({ kind: "identifier", value: "__regex_literal__", start, end: index })
      continue
    }

    if (char !== undefined && /[A-Za-z_$]/.test(char)) {
      const start = index
      index += 1
      while (index < chars.length && /[A-Za-z0-9_$]/.test(chars[index] ?? "")) index += 1
      context.push({ kind: "identifier", value: source.slice(start, index), start, end: index })
      continue
    }
    if (char !== undefined && /[0-9]/.test(char)) {
      const start = index
      index += 1
      while (index < chars.length && /[A-Za-z0-9_.]/.test(chars[index] ?? "")) index += 1
      context.push({ kind: "identifier", value: source.slice(start, index), start, end: index })
      continue
    }
    if (char !== undefined && !/\s/.test(char)) {
      context.push({ kind: "punctuation", value: char, start: index, end: index + 1 })
    }
    index += 1
  }
  return chars.join("")
}

function maskRange(chars: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " "
  }
}
