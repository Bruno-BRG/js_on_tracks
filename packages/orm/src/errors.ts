// Erro didático do `@jot/orm`.
//
// Mensagens ao usuário em inglês (contrato §1); a dica (`hint`) sempre diz o que fazer.

/**
 * Todo erro previsto do ORM. A mensagem final concatena `message` + `hint`
 * (ex.: "table 'posts' has no primary key. define one with `id: id()` ...").
 * `options.cause` preserva o erro original do driver quando a falha vem do banco
 * (ex.: violação de UNIQUE/PK em `save()`).
 */
export class OrmError extends Error {
  constructor(
    message: string,
    readonly hint: string,
    options?: ErrorOptions,
  ) {
    super(`${message} ${hint}`, options)
    this.name = "OrmError"
  }
}

/** Lista campos para as mensagens didáticas ("available fields: a, b, c."). */
export function availableFields(names: readonly string[]): string {
  return `available fields: ${names.join(", ")}.`
}

/** Descreve um valor recebido do usuário em mensagens de erro (`"x"`, `123`, `null`). */
export function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (value === null || value === undefined) return String(value)
  if (Array.isArray(value)) return "array"
  if (typeof value === "object") return value.constructor?.name ?? "object"
  return String(value)
}
