import type { Stats } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { CLIENT_SCRIPT } from "@js_on_tracks/views"
import type { MiddlewareHandler } from "hono"
import { bytesResponse, textResponse } from "./http"

/** Caminho do script cliente, servido pelo core. */
export const CLIENT_SCRIPT_PATH = "/_jot/jot.js"

const DEFAULT_CONTENT_TYPE = "application/octet-stream"

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
}

export interface StaticOptions {
  /** Root do app; `public/` é resolvido a partir dele. */
  root: string
}

/**
 * Static de `public/**` servido em `/` + `/_jot/jot.js` (script cliente).
 *
 * Só responde `GET`/`HEAD`; arquivo ausente (ou caminho fora de `public/`) cai
 * para as rotas → 404 do app.
 */
export function staticMiddleware(options: StaticOptions): MiddlewareHandler {
  const publicDir = path.resolve(options.root, "public")
  return async (c, next) => {
    const method = c.req.method.toUpperCase()
    if (method !== "GET" && method !== "HEAD") return next()

    if (c.req.path === CLIENT_SCRIPT_PATH) {
      const body = method === "HEAD" ? null : CLIENT_SCRIPT
      return textResponse(c, body, 200, "text/javascript; charset=utf-8")
    }

    const file = await findPublicFile(publicDir, c.req.path)
    if (file === undefined) return next()
    const contentType = contentTypeFor(file)
    if (method === "HEAD") return textResponse(c, null, 200, contentType)
    try {
      const data = await readFile(file)
      return bytesResponse(c, data, 200, contentType)
    } catch {
      return next()
    }
  }
}

async function findPublicFile(publicDir: string, requestPath: string): Promise<string | undefined> {
  let segments: string[]
  try {
    segments = decodeURIComponent(requestPath)
      .split("/")
      .filter((segment) => segment.length > 0)
  } catch {
    return undefined // `%` inválido
  }
  const unsafe = segments.some(
    (segment) => segment === ".." || segment === "." || segment.includes("\0"),
  )
  if (unsafe) return undefined

  const file = path.resolve(publicDir, ...segments)
  const prefix = publicDir.endsWith(path.sep) ? publicDir : publicDir + path.sep
  if (!file.startsWith(prefix)) return undefined

  const info = await statOrUndefined(file)
  if (info === undefined) return undefined
  if (info.isDirectory()) {
    const index = path.join(file, "index.html")
    const indexInfo = await statOrUndefined(index)
    return indexInfo?.isFile() === true ? index : undefined
  }
  return info.isFile() ? file : undefined
}

async function statOrUndefined(file: string): Promise<Stats | undefined> {
  try {
    return await stat(file)
  } catch {
    return undefined
  }
}

function contentTypeFor(file: string): string {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? DEFAULT_CONTENT_TYPE
}
