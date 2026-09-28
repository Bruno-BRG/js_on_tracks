import type { Controller, ControllerContext } from "./controller"

/** Construtora de controller registrada pelo manifest (`registerControllers`). */
export type ControllerClass = new (context: ControllerContext) => Controller

/**
 * Componente de view registrado pelo manifest (`registerViews`).
 *
 * O parâmetro é `never` de propósito: por contravariância, qualquer assinatura
 * concreta de view (`(props: { posts: Post[] }) => VNode`) é atribuível a este
 * tipo, o que não aconteceria com `Record<string, unknown>`.
 */
export type ViewComponent = (props: never) => unknown

const controllerRegistry = new Map<string, ControllerClass>()
const viewRegistry = new Map<string, ViewComponent>()

/**
 * Registra controllers pelo nome de rota (chave do manifest). Ex.:
 * `registerControllers({ Posts: PostsController })`.
 */
export function registerControllers(controllers: Readonly<Record<string, ControllerClass>>): void {
  for (const [key, controller] of Object.entries(controllers)) {
    if (typeof controller !== "function") {
      throw new Error(
        `registerControllers received a non-class value for "${key}". ` +
          `The generated manifest must pass controller classes ` +
          `(e.g. registerControllers({ Posts: PostsController })).`,
      )
    }
    controllerRegistry.set(key, controller)
  }
}

/**
 * Registra views pelo nome convencional. Ex.:
 * `registerViews({ "posts/index": PostsIndex, "layouts/application": ApplicationLayout })`.
 */
export function registerViews(views: Readonly<Record<string, ViewComponent>>): void {
  for (const [key, view] of Object.entries(views)) {
    if (typeof view !== "function") {
      throw new Error(
        `registerViews received a non-component value for "${key}". ` +
          `The generated manifest must pass view components ` +
          `(e.g. registerViews({ "posts/index": PostsIndex })).`,
      )
    }
    viewRegistry.set(key, view)
  }
}

/** Controller registrado para a chave, ou `undefined`. */
export function getControllerClass(key: string): ControllerClass | undefined {
  return controllerRegistry.get(key)
}

/** View registrada para o nome, ou `undefined`. */
export function getViewComponent(name: string): ViewComponent | undefined {
  return viewRegistry.get(name)
}

/** Somente para testes: limpa os registries globais. */
export function __clearRegistries(): void {
  controllerRegistry.clear()
  viewRegistry.clear()
}
