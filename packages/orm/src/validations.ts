// Validações do M1: presence, minLength, maxLength e format (contrato §4.2).

import { OrmError } from "./errors"

export interface PresenceValidation {
  readonly kind: "presence"
  readonly message: string
}

export interface MinLengthValidation {
  readonly kind: "minLength"
  readonly length: number
  readonly message: string
}

export interface MaxLengthValidation {
  readonly kind: "maxLength"
  readonly length: number
  readonly message: string
}

export interface FormatValidation {
  readonly kind: "format"
  readonly pattern: RegExp
  readonly message: string
}

export type Validation =
  | PresenceValidation
  | MinLengthValidation
  | MaxLengthValidation
  | FormatValidation

/** Validações por campo: `{ title: [presence(), minLength(3)] }`. */
export type Validations = Record<string, readonly Validation[]>

/** Campo obrigatório: falha em `null`, `undefined`, `""` e strings só com espaços. */
export function presence(message = "can't be blank"): PresenceValidation {
  return { kind: "presence", message }
}

function lengthMessage(defaults: string, length: number, message?: string): string {
  return message ?? defaults.replace("N", String(length))
}

/** Tamanho mínimo de texto (aplica-se apenas a strings; `null`/`undefined` são pulados). */
export function minLength(length: number, message?: string): MinLengthValidation {
  return {
    kind: "minLength",
    length,
    message: lengthMessage("must be at least N characters", length, message),
  }
}

/** Tamanho máximo de texto (aplica-se apenas a strings; `null`/`undefined` são pulados). */
export function maxLength(length: number, message?: string): MaxLengthValidation {
  return {
    kind: "maxLength",
    length,
    message: lengthMessage("must be at most N characters", length, message),
  }
}

/** Formato: testa `pattern` contra o valor (apenas strings; `null`/`undefined` são pulados). */
export function format(pattern: RegExp, message = "has an invalid format"): FormatValidation {
  return { kind: "format", pattern, message }
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  return typeof value === "string" && value.trim() === ""
}

/**
 * Roda uma validação e devolve a mensagem de erro (ou `undefined` se passou).
 * Lança `OrmError` para um `kind` desconhecido (erro de programação, não de usuário).
 */
export function runValidation(
  validation: Validation,
  field: string,
  value: unknown,
): string | undefined {
  switch (validation.kind) {
    case "presence":
      return isBlank(value) ? validation.message : undefined
    case "minLength":
    case "maxLength": {
      if (value === null || value === undefined) return undefined
      if (typeof value !== "string") return "must be a string"
      if (validation.kind === "minLength") {
        return value.length < validation.length ? validation.message : undefined
      }
      return value.length > validation.length ? validation.message : undefined
    }
    case "format": {
      if (value === null || value === undefined) return undefined
      if (typeof value !== "string") return "must be a string"
      // As flags `/g` e `/y` mantêm `lastIndex` entre chamadas de `test()`; zerar antes de
      // testar garante o mesmo resultado para o mesmo valor (o validador é reutilizado por
      // toda a aplicação). Preferimos normalizar a rejeitar `/g`: `format(/^\d+$/g)` é um
      // engano comum e inofensivo — o contrato não restringe as flags.
      validation.pattern.lastIndex = 0
      return validation.pattern.test(value) ? undefined : validation.message
    }
    default: {
      const kind = (validation as { kind: unknown }).kind
      throw new OrmError(
        `unknown validation '${String(kind)}' on field '${field}'.`,
        "use presence(), minLength(), maxLength() or format().",
      )
    }
  }
}
