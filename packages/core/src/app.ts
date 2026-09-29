/** Configuração do app (`config/app.ts`). */
export type CsrfConfig = { enabled?: true } | { enabled: false; reason: string }

export interface AppConfig {
  name: string
  csrf?: CsrfConfig
}

/** Valida e devolve a configuração do app (erro didático se `name` for vazio). */
export function defineApp(config: AppConfig): AppConfig {
  const name = typeof config?.name === "string" ? config.name.trim() : ""
  if (name.length === 0) {
    throw new Error(
      `defineApp requires a non-empty "name" (config/app.ts). ` +
        `Example: export default defineApp({ name: "blog" })`,
    )
  }
  validateCsrfConfig(config?.csrf)
  return { ...config, name }
}

/** Validação compartilhada pelo helper público e pelo boot para configs JS diretas. */
export function validateCsrfConfig(config: CsrfConfig | undefined): void {
  if (config === undefined) return
  if (config === null || typeof config !== "object") {
    throw new Error(
      "Invalid CSRF config in config/app.ts. Use { enabled: true } or provide a reason when disabling it.",
    )
  }
  if (config.enabled === false) {
    if (typeof config.reason !== "string" || config.reason.trim().length === 0) {
      throw new Error(
        'Disabling CSRF requires a non-empty reason. Use { csrf: { enabled: false, reason: "..." } } in config/app.ts.',
      )
    }
    return
  }
  if (config.enabled !== undefined && config.enabled !== true) {
    throw new Error(
      "Invalid CSRF config in config/app.ts. Use { enabled: true } or provide a reason when disabling it.",
    )
  }
}
