/** Configuração do app (`config/app.ts`). */
export interface AppConfig {
  name: string
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
  return { ...config, name }
}
