import type { MiddlewareHandler } from "hono"
import pc from "picocolors"

/**
 * Log de requests no formato `GET /posts 200 12ms` (método em ciano, status
 * colorido por faixa, duração em dim). Sem TTY o picocolors não emite ANSI.
 */
export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now()
    try {
      await next()
    } catch (error) {
      logRequest(c.req.method, c.req.path, 500, performance.now() - started)
      throw error
    }
    logRequest(c.req.method, c.req.path, c.res.status, performance.now() - started)
  }
}

function logRequest(method: string, path: string, status: number, durationMs: number): void {
  const ms = `${Math.round(durationMs)}ms`
  console.log(`${pc.cyan(method)} ${path} ${statusColor(status)(String(status))} ${pc.dim(ms)}`)
}

function statusColor(status: number): (text: string) => string {
  if (status >= 500) return pc.red
  if (status >= 400) return pc.yellow
  if (status >= 300) return pc.cyan
  return pc.green
}
