const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** Returns a validated, lowercase media type without its parameters. */
function mediaType(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const essence = value.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  const separator = essence.indexOf("/")
  if (separator <= 0 || separator === essence.length - 1) return undefined

  const type = essence.slice(0, separator)
  const subtype = essence.slice(separator + 1)
  if (!TOKEN.test(type) || !TOKEN.test(subtype)) return undefined
  return `${type}/${subtype}`
}

export function isJsonContentType(value: string | undefined): boolean {
  const type = mediaType(value)
  if (type === undefined) return false
  const subtype = type.slice(type.indexOf("/") + 1)
  return subtype === "json" || (subtype.length > 5 && subtype.endsWith("+json"))
}

export function isUrlEncodedContentType(value: string | undefined): boolean {
  return mediaType(value) === "application/x-www-form-urlencoded"
}

export function isMultipartFormDataContentType(value: string | undefined): boolean {
  return mediaType(value) === "multipart/form-data"
}

export function isFormContentType(value: string | undefined): boolean {
  return isUrlEncodedContentType(value) || isMultipartFormDataContentType(value)
}
