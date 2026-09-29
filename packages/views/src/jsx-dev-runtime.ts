/**
 * Runtime JSX automático de desenvolvimento do `@js_on_tracks/views`
 * (`"jsx": "react-jsxdev"`).
 *
 * `jsxDEV` responde à mesma assinatura do `jsx` mais os argumentos de debug
 * (`isStaticChildren`, `source`, `self`). O comportamento de render é idêntico:
 * as informações de fonte ficam disponíveis mas não alteram a árvore.
 */

import { jsx } from "./jsx-runtime"
import type { Key, Props, VNode } from "./runtime"

export * from "./jsx-runtime"

/** Localização no código-fonte, enviada pelo compilador no modo development. */
export interface JsxSource {
  fileName?: string
  lineNumber?: number
  columnNumber?: number
}

/** Versão de desenvolvimento de `jsx`; delega para o runtime de produção. */
export function jsxDEV(
  type: unknown,
  props: Props | null,
  key?: Key | null,
  _isStaticChildren?: boolean,
  _source?: JsxSource,
  _self?: unknown,
): VNode {
  return jsx(type, props, key)
}
