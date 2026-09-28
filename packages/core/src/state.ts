import type { Context } from "hono"
import type { Session } from "./session"

/**
 * Estado por request. Fica num `WeakMap` (e não em `c.set`) para não depender
 * do tipo genérico do `Context` e não poluir o escape hatch do Hono.
 */
export interface RequestState {
  /** Sessão da request (cookie assinado). */
  session: Session
  /** Flash lido/mutado pelo controller antes de render/redirect. */
  flash: Record<string, unknown>
}

const states = new WeakMap<Context, RequestState>()

export function setRequestState(context: Context, state: RequestState): void {
  states.set(context, state)
}

export function getRequestState(context: Context): RequestState | undefined {
  return states.get(context)
}
