import { renderToString } from "@jot/views"
import { jsx } from "@jot/views/jsx-runtime"
import { getViewComponent } from "./registry"

/** Nome do layout default do app. */
export const DEFAULT_LAYOUT = "layouts/application"

/**
 * Renderiza uma view (e o layout, quando não desligado) para HTML.
 *
 * `flash` entra nas mesmas props da view e do layout; o layout recebe também
 * `children` com a view já renderizada. `csrfToken` é reservado pelo framework.
 */
export async function renderView(
  name: string,
  props: Record<string, unknown>,
  layout: string | false | undefined,
  flash: Record<string, unknown>,
  csrfToken: string,
): Promise<string> {
  const view = getViewComponent(name)
  if (view === undefined) throw viewNotFoundError(name, "View")
  const viewProps = { ...props, flash, csrfToken }
  const inner = jsx(view, viewProps)
  if (layout === false) return renderToString(inner)
  const layoutName = typeof layout === "string" ? layout : DEFAULT_LAYOUT
  const layoutComponent = getViewComponent(layoutName)
  if (layoutComponent === undefined) throw viewNotFoundError(layoutName, "Layout")
  return renderToString(jsx(layoutComponent, { ...viewProps, children: inner }))
}

function viewNotFoundError(name: string, kind: "View" | "Layout"): Error {
  return new Error(
    `${kind} '${name}' not found. Expected file: app/views/${name}.tsx. ` +
      "Restart `jot server` to regenerate the manifest.",
  )
}
