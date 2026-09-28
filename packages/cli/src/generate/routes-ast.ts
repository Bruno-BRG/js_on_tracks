import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { camelCase, pascalCase } from "../naming"
import { CliError } from "../output"
import type { ResourceSpec } from "./parse"
import { detectEol } from "./write"

interface AstNode {
  readonly kind: number
  readonly pos: number
  readonly end: number
  forEachChild?(callback: (child: AstNode) => void): void
  getStart(sourceFile?: AstNode): number
}

interface AstDiagnostic {
  readonly start?: number
}

interface AstSourceFile extends AstNode {
  readonly statements: readonly AstNode[]
  readonly text?: string
  getLineAndCharacterOfPosition(position: number): {
    readonly line: number
    readonly character: number
  }
}

interface TypeScriptApi {
  readonly SyntaxKind: Readonly<Record<string, number>>
  readonly NodeFlags: Readonly<{ Const: number }>
  parseSourceFile(
    fileName: string,
    sourceText: string,
  ): {
    readonly sourceFile: AstSourceFile
    readonly diagnostics: readonly AstDiagnostic[]
  }
  forEachChild(node: AstNode, callback: (child: AstNode) => void): void
  close(): void
}

interface StringConstants {
  readonly values: Map<string, string>
  readonly blocked: Set<string>
}

interface RouteCall {
  readonly receiver: string
  readonly method: string
  readonly start: number
  readonly line: number
  readonly resourceName?: string
  readonly routePath?: string
  readonly helpers: readonly string[]
}

interface RouteAnalysis {
  readonly calls: readonly RouteCall[]
  readonly receiver: string
  readonly openIndex: number
  readonly closeIndex: number
}

const ROUTE_METHODS = ["get", "post", "put", "patch", "delete"] as const
const RESOURCE_ACTIONS = ["index", "new", "create", "show", "edit", "update", "destroy"] as const

/**
 * Insert only after proving the full JOT routes callback belongs to the supported,
 * statically analyzable subset. TypeScript is resolved from the app, not @jot/cli.
 */
export async function insertResourceWithAst(
  source: string,
  resource: ResourceSpec,
  root: string,
): Promise<string> {
  const routeFile = join(root, "config", "routes.ts")
  const ts = await loadTypeScript(root, routeFile, source)
  let analysis: RouteAnalysis
  try {
    analysis = analyzeRoutes(source, ts, resource.names.table, routeFile)
  } finally {
    ts.close()
  }
  for (const call of analysis.calls) {
    if (call.resourceName !== undefined) {
      if (call.resourceName === resource.names.table) {
        throw new CliError(
          `config/routes.ts already has ${call.receiver}.resource("${resource.names.table}") ` +
            `(line ${call.line}). Remove it first.`,
        )
      }
      if (routePathConflicts(call.resourceName, resource.names.table)) {
        const routePath = `/${trimRouteSlashes(call.resourceName)}`
        throw new CliError(
          `config/routes.ts already mentions "${routePath}" (line ${call.line}). ` +
            `Remove the conflicting route or add r.resource("${resource.names.table}") manually.`,
        )
      }
    } else if (
      call.routePath !== undefined &&
      routePathConflicts(call.routePath, resource.names.table)
    ) {
      throw new CliError(
        `config/routes.ts already mentions "${call.routePath}" (line ${call.line}). ` +
          `Remove the conflicting route or add r.resource("${resource.names.table}") manually.`,
      )
    }
  }

  const wantedHelpers = generatedResourceHelpers(resource.names.table, resource.names.singular)
  for (const call of analysis.calls) {
    const helper = call.helpers.find((name) => wantedHelpers.has(name))
    if (helper === undefined) continue
    throw new CliError(
      `config/routes.ts already defines route helper "${helper}" (line ${call.line}), ` +
        `which conflicts with helpers from r.resource("${resource.names.table}"). Rename or remove the existing helper first.`,
    )
  }

  const eol = detectEol(source)
  const inner = source.slice(analysis.openIndex + 1, analysis.closeIndex)
  const line = `${analysis.receiver}.resource("${resource.names.table}")`
  let insertion: string
  if (inner.trim().length === 0) {
    insertion = `${eol}  ${line}${eol}`
  } else if (/(?:\r?\n)$/.test(inner)) {
    insertion = `${blockIndent(inner) ?? "  "}${line}${eol}`
  } else {
    insertion = `${eol}${blockIndent(inner) ?? "  "}${line}${eol}`
  }
  return source.slice(0, analysis.closeIndex) + insertion + source.slice(analysis.closeIndex)
}

async function loadTypeScript(
  root: string,
  routeFile: string,
  source: string,
): Promise<TypeScriptApi> {
  const appRequire = createRequire(join(root, "package.json"))
  let entry: string
  try {
    entry = appRequire.resolve("typescript")
  } catch {
    throw new CliError(
      `Cannot safely analyze config/routes.ts because TypeScript could not be resolved from app root ${root}. ` +
        "Restore the app's TypeScript dev dependency, then re-run `jot generate scaffold`.",
    )
  }

  try {
    const imported: unknown = await import(pathToFileURL(entry).href)
    const namespace = asRecord(imported)
    const candidate = namespace?.default ?? imported
    const api = asRecord(candidate)
    if (
      api === undefined ||
      typeof api.createSourceFile !== "function" ||
      typeof api.forEachChild !== "function" ||
      typeof api.SyntaxKind !== "object" ||
      typeof api.NodeFlags !== "object"
    ) {
      return await loadNativeTypeScriptApi(appRequire, root, routeFile, source)
    }
    const compiler = api as unknown as {
      readonly SyntaxKind: Readonly<Record<string, number>>
      readonly NodeFlags: Readonly<{ Const: number }>
      readonly ScriptTarget: Readonly<{ Latest: number }>
      readonly ScriptKind: Readonly<{ TS: number }>
      createSourceFile(
        fileName: string,
        sourceText: string,
        languageVersion: number,
        setParentNodes?: boolean,
        scriptKind?: number,
      ): AstSourceFile & { readonly parseDiagnostics: readonly AstDiagnostic[] }
      forEachChild(node: AstNode, callback: (child: AstNode) => void): void
    }
    return {
      SyntaxKind: compiler.SyntaxKind,
      NodeFlags: compiler.NodeFlags,
      parseSourceFile: (fileName, text) => {
        const sourceFile = compiler.createSourceFile(
          fileName,
          text,
          compiler.ScriptTarget.Latest,
          true,
          compiler.ScriptKind.TS,
        )
        return { sourceFile, diagnostics: sourceFile.parseDiagnostics }
      },
      forEachChild: compiler.forEachChild,
      close: () => undefined,
    }
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : ""
    throw new CliError(
      `Cannot safely load the TypeScript parser resolved from app root ${root}.${detail} ` +
        "Restore the app's TypeScript installation, then re-run `jot generate scaffold`.",
    )
  }
}

async function loadNativeTypeScriptApi(
  appRequire: NodeJS.Require,
  root: string,
  routeFile: string,
  source: string,
): Promise<TypeScriptApi> {
  let activeApi: NativeCompilerApi | undefined
  try {
    const syncEntry = appRequire.resolve("typescript/unstable/sync")
    const astEntry = appRequire.resolve("typescript/unstable/ast")
    const [syncImport, astImport] = await Promise.all([
      import(pathToFileURL(syncEntry).href),
      import(pathToFileURL(astEntry).href),
    ])
    const syncModule = asRecord(syncImport)
    const astModule = asRecord(astImport)
    const ApiConstructor = syncModule?.API
    const syntaxKind = asRecord(astModule?.SyntaxKind)
    const nodeFlags = asRecord(astModule?.NodeFlags)
    if (
      typeof ApiConstructor !== "function" ||
      syntaxKind === undefined ||
      nodeFlags === undefined ||
      typeof syntaxKind.SourceFile !== "number" ||
      typeof nodeFlags.Const !== "number"
    ) {
      throw new Error(
        "the app TypeScript package exposes neither the stable parser nor its AST API",
      )
    }
    const routePath = normalizeFilePath(routeFile)
    const configDirectory = normalizeFilePath(dirname(routeFile))
    const api = new (
      ApiConstructor as new (
        options: Readonly<Record<string, unknown>>,
      ) => NativeCompilerApi
    )({
      cwd: root,
      fs: {
        readFile: (path: string) => (normalizeFilePath(path) === routePath ? source : undefined),
        fileExists: (path: string) => (normalizeFilePath(path) === routePath ? true : undefined),
        directoryExists: (path: string) =>
          normalizeFilePath(path) === configDirectory ? true : undefined,
      },
    })
    activeApi = api
    const snapshot = api.updateSnapshot({ openFiles: [routeFile] })
    const project = snapshot.getDefaultProjectForFile(routeFile)
    const sourceFile = project?.program.getSourceFile(routeFile)
    if (project === undefined || sourceFile === undefined || sourceFile.text !== source) {
      throw new Error("the app TypeScript parser could not read config/routes.ts exactly")
    }
    const diagnostics = project.program.getSyntacticDiagnostics(routeFile)
    return {
      SyntaxKind: syntaxKind as Readonly<Record<string, number>>,
      NodeFlags: nodeFlags as unknown as Readonly<{ Const: number }>,
      parseSourceFile: () => ({
        sourceFile: sourceFile as unknown as AstSourceFile,
        diagnostics: diagnostics as readonly AstDiagnostic[],
      }),
      forEachChild: (node, callback) => {
        const visit = node.forEachChild
        if (visit === undefined) throw new Error("the TypeScript AST node cannot be traversed")
        visit.call(node, callback)
      },
      close: () => api.close(),
    }
  } catch (error) {
    activeApi?.close()
    const detail = error instanceof Error ? ` ${error.message}` : ""
    throw new CliError(
      `Cannot safely load the TypeScript AST parser resolved from app root ${root}.${detail} ` +
        "Restore the app's TypeScript installation, then re-run `jot generate scaffold`.",
    )
  }
}

interface NativeCompilerApi {
  updateSnapshot(options: { readonly openFiles: readonly string[] }): NativeSnapshot
  close(): void
}

interface NativeSnapshot {
  getDefaultProjectForFile(fileName: string): NativeProject | undefined
}

interface NativeProject {
  readonly program: NativeProgram
}

interface NativeProgram {
  getSourceFile(fileName: string): AstSourceFile | undefined
  getSyntacticDiagnostics(fileName: string): readonly AstDiagnostic[]
}

function normalizeFilePath(path: string): string {
  return resolve(path).replaceAll("\\", "/").toLowerCase()
}

function analyzeRoutes(
  source: string,
  ts: TypeScriptApi,
  table: string,
  routeFile: string,
): RouteAnalysis {
  const parsed = ts.parseSourceFile(routeFile, source)
  const sourceFile = parsed.sourceFile
  const syntaxError = parsed.diagnostics[0]
  if (syntaxError !== undefined) {
    throw cannotAnalyzeRoute(sourceFile, syntaxError.start ?? 0)
  }

  const factories: AstNode[] = []
  visitAst(sourceFile, ts, (node) => {
    if (!isKind(node, "CallExpression", ts)) return
    const callee = child(node, "expression")
    if (isKind(callee, "Identifier", ts) && nodeText(callee) === "routes") factories.push(node)
  })
  const factory = factories[0]
  if (factories.length !== 1 || factory === undefined) {
    throw new CliError(
      `Could not find one unambiguous routes((r) => { ... }) callback in config/routes.ts. ` +
        `Simplify it to one direct export default routes((r) => { ... }) before running this generator for "${table}".`,
    )
  }

  const isDefaultExport = sourceFile.statements.some((statement) => {
    if (!isKind(statement, "ExportAssignment", ts) || booleanField(statement, "isExportEquals")) {
      return false
    }
    return unwrapExpression(child(statement, "expression"), ts) === factory
  })
  if (!isDefaultExport || !hasJotRoutesImport(sourceFile, ts)) {
    const line = sourceFile.getLineAndCharacterOfPosition(factory.getStart(sourceFile)).line + 1
    throw new CliError(
      `Cannot prove that config/routes.ts uses the JOT routes builder (line ${line}). ` +
        'Keep `import { routes } from "jot-framework"` and `export default routes((r) => { ... })`, then re-run this generator.',
    )
  }

  const args = children(factory, "arguments")
  const callback = unwrapExpression(args[0], ts)
  if (args.length !== 1 || !isKind(callback, "ArrowFunction", ts)) {
    throw cannotAnalyzeRoute(sourceFile, factory.getStart(sourceFile))
  }
  const parameters = children(callback, "parameters")
  const receiverNode = child(parameters[0], "name")
  const body = child(callback, "body")
  if (
    parameters.length !== 1 ||
    receiverNode === undefined ||
    !isKind(receiverNode, "Identifier", ts) ||
    body === undefined ||
    !isKind(body, "Block", ts)
  ) {
    throw cannotAnalyzeRoute(sourceFile, factory.getStart(sourceFile))
  }
  const receiver = nodeText(receiverNode)
  if (receiver === undefined) throw cannotAnalyzeRoute(sourceFile, factory.getStart(sourceFile))

  const moduleConstants = readModuleStringConstants(sourceFile, ts)
  const callbackConstants: StringConstants = { values: new Map(), blocked: new Set([receiver]) }
  const calls: RouteCall[] = []
  for (const statement of children(body, "statements")) {
    if (isKind(statement, "EmptyStatement", ts)) continue
    if (isKind(statement, "VariableStatement", ts)) {
      readCallbackConstants(statement, callbackConstants, moduleConstants, sourceFile, ts)
      continue
    }
    if (!isKind(statement, "ExpressionStatement", ts)) {
      throw cannotAnalyzeRoute(sourceFile, statement.getStart(sourceFile))
    }
    const expression = child(statement, "expression")
    if (expression === undefined || !isKind(expression, "CallExpression", ts)) {
      throw cannotAnalyzeRoute(sourceFile, statement.getStart(sourceFile))
    }
    calls.push(
      analyzeBuilderCall(expression, receiver, callbackConstants, moduleConstants, sourceFile, ts),
    )
  }

  const openIndex = body.getStart(sourceFile)
  const closeIndex = body.end - 1
  if (source[openIndex] !== "{" || source[closeIndex] !== "}") {
    throw cannotAnalyzeRoute(sourceFile, openIndex)
  }
  return { calls, receiver, openIndex, closeIndex }
}

function hasJotRoutesImport(sourceFile: AstSourceFile, ts: TypeScriptApi): boolean {
  for (const statement of sourceFile.statements) {
    if (!isKind(statement, "ImportDeclaration", ts)) continue
    const module = child(statement, "moduleSpecifier")
    if (!isKind(module, "StringLiteral", ts) || nodeText(module) !== "jot-framework") continue
    const clause = child(statement, "importClause")
    if (clause === undefined || booleanField(clause, "isTypeOnly")) continue
    const named = child(clause, "namedBindings")
    if (!isKind(named, "NamedImports", ts)) continue
    for (const specifier of children(named, "elements")) {
      if (booleanField(specifier, "isTypeOnly")) continue
      const local = child(specifier, "name")
      const imported = child(specifier, "propertyName") ?? local
      if (nodeText(local) === "routes" && nodeText(imported) === "routes") return true
    }
  }
  return false
}

function readModuleStringConstants(sourceFile: AstSourceFile, ts: TypeScriptApi): StringConstants {
  const constants: StringConstants = { values: new Map(), blocked: new Set() }
  for (const statement of sourceFile.statements) {
    if (!isKind(statement, "VariableStatement", ts)) continue
    const declarationList = child(statement, "declarationList")
    if (declarationList === undefined) continue
    const isConst = ((numberField(declarationList, "flags") ?? 0) & ts.NodeFlags.Const) !== 0
    for (const declaration of children(declarationList, "declarations")) {
      const name = child(declaration, "name")
      if (!isKind(name, "Identifier", ts)) continue
      const identifier = nodeText(name)
      if (identifier === undefined) continue
      constants.blocked.add(identifier)
      constants.values.delete(identifier)
      const value = isConst ? staticStringLiteral(child(declaration, "initializer"), ts) : undefined
      if (value !== undefined) constants.values.set(identifier, value)
    }
  }
  return constants
}

function readCallbackConstants(
  statement: AstNode,
  local: StringConstants,
  module: StringConstants,
  sourceFile: AstSourceFile,
  ts: TypeScriptApi,
): void {
  const declarationList = child(statement, "declarationList")
  const position = statement.getStart(sourceFile)
  if (
    declarationList === undefined ||
    ((numberField(declarationList, "flags") ?? 0) & ts.NodeFlags.Const) === 0
  ) {
    throw cannotAnalyzeRoute(sourceFile, position)
  }
  for (const declaration of children(declarationList, "declarations")) {
    const name = child(declaration, "name")
    const initializer = child(declaration, "initializer")
    const identifier = isKind(name, "Identifier", ts) ? nodeText(name) : undefined
    if (identifier === undefined || initializer === undefined) {
      throw cannotAnalyzeRoute(sourceFile, position)
    }
    local.blocked.add(identifier)
    const value = resolveStringExpression(initializer, local, module, ts)
    if (value === undefined) throw cannotAnalyzeRoute(sourceFile, position)
    local.values.set(identifier, value)
  }
}

function analyzeBuilderCall(
  call: AstNode,
  receiver: string,
  local: StringConstants,
  module: StringConstants,
  sourceFile: AstSourceFile,
  ts: TypeScriptApi,
): RouteCall {
  if (child(call, "questionDotToken") !== undefined) {
    throw cannotAnalyzeRoute(sourceFile, call.getStart(sourceFile))
  }
  const callee = child(call, "expression")
  const methodNode = child(callee, "name")
  const calleeReceiver = child(callee, "expression")
  if (
    !isKind(callee, "PropertyAccessExpression", ts) ||
    child(callee, "questionDotToken") !== undefined ||
    !isKind(calleeReceiver, "Identifier", ts) ||
    nodeText(calleeReceiver) !== receiver ||
    !isKind(methodNode, "Identifier", ts)
  ) {
    throw cannotAnalyzeRoute(sourceFile, call.getStart(sourceFile))
  }
  const method = nodeText(methodNode)
  if (method === undefined) throw cannotAnalyzeRoute(sourceFile, call.getStart(sourceFile))
  const args = children(call, "arguments")
  const start = call.getStart(sourceFile)
  const line = sourceFile.getLineAndCharacterOfPosition(start).line + 1

  if (method === "resource") {
    if (args.length < 1 || args.length > 2) throw cannotAnalyzeRoute(sourceFile, start)
    const resourceName = resolveStringExpression(args[0], local, module, ts)
    if (resourceName === undefined) {
      throw new CliError(
        `Cannot verify a dynamic resource name in config/routes.ts (line ${line}). ` +
          "Use a string literal or a const string for `r.resource(...)`, then re-run this generator.",
      )
    }
    const actions = resourceActions(args[1], local, module, sourceFile, ts, line)
    return {
      receiver,
      method,
      start,
      line,
      resourceName,
      helpers: resourceHelperNames(resourceName, actions.only, actions.except),
    }
  }

  if (method === "root") {
    if (args.length !== 1 || resolveStringExpression(args[0], local, module, ts) === undefined) {
      throw cannotAnalyzeRoute(sourceFile, start)
    }
    return { receiver, method, start, line, helpers: ["root"] }
  }

  if (!(ROUTE_METHODS as readonly string[]).includes(method)) {
    throw cannotAnalyzeRoute(sourceFile, start)
  }
  if (args.length < 2 || args.length > 3) throw cannotAnalyzeRoute(sourceFile, start)
  const routePath = resolveStringExpression(args[0], local, module, ts)
  if (routePath === undefined) {
    throw new CliError(
      `Cannot verify a dynamic route path in config/routes.ts (line ${line}). ` +
        "Use a string literal or a const string for the route path, then re-run this generator.",
    )
  }
  if (resolveStringExpression(args[1], local, module, ts) === undefined) {
    throw new CliError(
      `Cannot verify a dynamic controller/action in config/routes.ts (line ${line}). ` +
        "Use a string literal or a const string for the route target, then re-run this generator.",
    )
  }
  return {
    receiver,
    method,
    start,
    line,
    routePath,
    helpers: routeHelpers(args[2], local, module, sourceFile, ts, line),
  }
}

function resourceActions(
  options: AstNode | undefined,
  local: StringConstants,
  module: StringConstants,
  sourceFile: AstSourceFile,
  ts: TypeScriptApi,
  line: number,
): { readonly only?: readonly string[]; readonly except?: readonly string[] } {
  if (options === undefined) return {}
  const parsed = parseOptions(options, local, module, ts)
  if (
    parsed.dynamic ||
    [...parsed.values.keys()].some((key) => key !== "only" && key !== "except")
  ) {
    throw dynamicHelperError(line)
  }
  const only = readActionList(parsed.values.get("only"), local, module, ts)
  const except = readActionList(parsed.values.get("except"), local, module, ts)
  if (only === null || except === null || (only !== undefined && except !== undefined)) {
    throw dynamicHelperError(line)
  }
  void sourceFile
  return {
    ...(only !== undefined ? { only } : {}),
    ...(except !== undefined ? { except } : {}),
  }
}

function routeHelpers(
  options: AstNode | undefined,
  local: StringConstants,
  module: StringConstants,
  sourceFile: AstSourceFile,
  ts: TypeScriptApi,
  line: number,
): string[] {
  if (options === undefined) return []
  const parsed = parseOptions(options, local, module, ts)
  if (parsed.dynamic || [...parsed.values.keys()].some((key) => key !== "as")) {
    throw dynamicHelperError(line)
  }
  const aliasExpression = parsed.values.get("as")
  if (aliasExpression === undefined) return []
  const alias = resolveStringExpression(aliasExpression, local, module, ts)
  if (alias === undefined) throw dynamicHelperError(line)
  void sourceFile
  return [alias]
}

interface ParsedOptions {
  readonly values: ReadonlyMap<string, AstNode>
  readonly dynamic: boolean
}

function parseOptions(
  object: AstNode,
  local: StringConstants,
  module: StringConstants,
  ts: TypeScriptApi,
): ParsedOptions {
  if (!isKind(object, "ObjectLiteralExpression", ts)) return { values: new Map(), dynamic: true }
  const values = new Map<string, AstNode>()
  for (const property of children(object, "properties")) {
    let nameNode: AstNode | undefined
    let valueNode: AstNode | undefined
    if (isKind(property, "PropertyAssignment", ts)) {
      const name = child(property, "name")
      valueNode = child(property, "initializer")
      if (isKind(name, "ComputedPropertyName", ts)) {
        nameNode = child(name, "expression")
        nameNode = staticNameNode(nameNode, local, module, ts)
      } else {
        nameNode = name
      }
    } else if (isKind(property, "ShorthandPropertyAssignment", ts)) {
      nameNode = child(property, "name")
      valueNode = nameNode
    } else {
      return { values, dynamic: true }
    }
    const name = staticPropertyName(nameNode, ts)
    if (name === undefined || valueNode === undefined || values.has(name)) {
      return { values, dynamic: true }
    }
    values.set(name, valueNode)
  }
  return { values, dynamic: false }
}

function staticNameNode(
  node: AstNode | undefined,
  local: StringConstants,
  module: StringConstants,
  ts: TypeScriptApi,
): AstNode | undefined {
  if (staticPropertyName(node, ts) !== undefined) return node
  const value = resolveStringExpression(node, local, module, ts)
  if (value === undefined || node === undefined) return undefined
  return {
    kind: ts.SyntaxKind.StringLiteral,
    pos: node.pos,
    end: node.end,
    getStart: node.getStart.bind(node),
    text: value,
  } as unknown as AstNode
}

function readActionList(
  expression: AstNode | undefined,
  local: StringConstants,
  module: StringConstants,
  ts: TypeScriptApi,
): string[] | undefined | null {
  if (expression === undefined) return undefined
  if (!isKind(expression, "ArrayLiteralExpression", ts)) return null
  const values: string[] = []
  for (const element of children(expression, "elements")) {
    const value = resolveStringExpression(element, local, module, ts)
    if (
      value === undefined ||
      !RESOURCE_ACTIONS.includes(value as (typeof RESOURCE_ACTIONS)[number])
    ) {
      return null
    }
    values.push(value)
  }
  return values
}

function resourceHelperNames(
  resourceName: string,
  only: readonly string[] | undefined,
  except: readonly string[] | undefined,
): string[] {
  const segments = trimRouteSlashes(resourceName).split("/").filter(Boolean)
  const lastSegment = segments.at(-1)
  if (lastSegment === undefined) return []
  const namespace = segments.slice(0, -1).map(pascalCase).join("")
  const singularHelper = `${namespace}${pascalCase(singularizeRouteName(lastSegment))}`
  const pluralHelper = camelCase(pascalCase(segments.join("_")))
  const selected = new Set<string>(only ?? RESOURCE_ACTIONS)
  for (const action of except ?? []) selected.delete(action)
  const helpers: Partial<Record<(typeof RESOURCE_ACTIONS)[number], string>> = {
    index: pluralHelper,
    new: `new${singularHelper}`,
    show: camelCase(singularHelper),
    edit: `edit${singularHelper}`,
  }
  return [...selected]
    .map((action) => helpers[action as keyof typeof helpers])
    .filter((helper): helper is string => helper !== undefined)
}

function dynamicHelperError(line: number): CliError {
  return new CliError(
    `Cannot verify a dynamic route helper in config/routes.ts (line ${line}). ` +
      "Use a string literal or a const string for the route's `as` value, and a literal options object, " +
      "then re-run this generator.",
  )
}

function resolveStringExpression(
  node: AstNode | undefined,
  local: StringConstants,
  module: StringConstants,
  ts: TypeScriptApi,
): string | undefined {
  const expression = unwrapExpression(node, ts)
  const literal = staticStringLiteral(expression, ts)
  if (literal !== undefined) return literal
  if (!isKind(expression, "Identifier", ts)) return undefined
  const name = nodeText(expression)
  if (name === undefined) return undefined
  if (local.values.has(name)) return local.values.get(name)
  if (local.blocked.has(name)) return undefined
  return module.values.get(name)
}

function staticStringLiteral(node: AstNode | undefined, ts: TypeScriptApi): string | undefined {
  const expression = unwrapExpression(node, ts)
  if (
    expression !== undefined &&
    (isKind(expression, "StringLiteral", ts) ||
      isKind(expression, "NoSubstitutionTemplateLiteral", ts))
  ) {
    return nodeText(expression)
  }
  return undefined
}

function unwrapExpression(node: AstNode | undefined, ts: TypeScriptApi): AstNode | undefined {
  let expression = node
  while (
    expression !== undefined &&
    ["ParenthesizedExpression", "AsExpression", "SatisfiesExpression", "NonNullExpression"].some(
      (kind) => isKind(expression, kind, ts),
    )
  ) {
    expression = child(expression, "expression")
  }
  return expression
}

function staticPropertyName(node: AstNode | undefined, ts: TypeScriptApi): string | undefined {
  if (
    node !== undefined &&
    (isKind(node, "Identifier", ts) ||
      isKind(node, "StringLiteral", ts) ||
      isKind(node, "NoSubstitutionTemplateLiteral", ts))
  ) {
    return nodeText(node)
  }
  return undefined
}

function cannotAnalyzeRoute(sourceFile: AstSourceFile, position: number): CliError {
  const line = sourceFile.getLineAndCharacterOfPosition(position).line + 1
  return new CliError(
    `Cannot safely analyze config/routes.ts (line ${line}). Simplify the routes(...) callback ` +
      "to direct builder calls (`r.resource(...)`, `r.get(...)`, `r.root(...)`) and const string declarations; " +
      "remove computed methods, wrappers, template interpolations, and control flow, then re-run `jot generate scaffold`.",
  )
}

function visitAst(node: AstNode, ts: TypeScriptApi, visitor: (node: AstNode) => void): void {
  visitor(node)
  ts.forEachChild(node, (childNode) => visitAst(childNode, ts, visitor))
}

function isKind(node: AstNode | undefined, name: string, ts: TypeScriptApi): boolean {
  return node !== undefined && node.kind === ts.SyntaxKind[name]
}

function child(node: AstNode | undefined, name: string): AstNode | undefined {
  if (node === undefined) return undefined
  const value = (node as unknown as Readonly<Record<string, unknown>>)[name]
  return isAstNode(value) ? value : undefined
}

function children(node: AstNode | undefined, name: string): readonly AstNode[] {
  if (node === undefined) return []
  const value = (node as unknown as Readonly<Record<string, unknown>>)[name]
  return Array.isArray(value) ? value.filter(isAstNode) : []
}

function nodeText(node: AstNode | undefined): string | undefined {
  if (node === undefined) return undefined
  const value = (node as unknown as Readonly<Record<string, unknown>>).text
  return typeof value === "string" ? value : undefined
}

function numberField(node: AstNode, name: string): number | undefined {
  const value = (node as unknown as Readonly<Record<string, unknown>>)[name]
  return typeof value === "number" ? value : undefined
}

function booleanField(node: AstNode, name: string): boolean {
  return (node as unknown as Readonly<Record<string, unknown>>)[name] === true
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof value.kind === "number" &&
    "getStart" in value &&
    typeof value.getStart === "function"
  )
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function routePathConflicts(existing: string, table: string): boolean {
  const path = `/${trimRouteSlashes(existing)}`
  if (path === `/${table}` || path.startsWith(`/${table}/`)) return true
  return generatedResourcePaths(table).some((generated) => routePatternsOverlap(path, generated))
}

function generatedResourcePaths(table: string): readonly string[] {
  return [`/${table}`, `/${table}/new`, `/${table}/:id`, `/${table}/:id/edit`]
}

function routePatternsOverlap(left: string, right: string): boolean {
  const leftParts = left.split("/").filter(Boolean)
  const rightParts = right.split("/").filter(Boolean)
  let index = 0
  while (index < leftParts.length && index < rightParts.length) {
    const leftPart = leftParts[index] ?? ""
    const rightPart = rightParts[index] ?? ""
    if (leftPart === "*" || rightPart === "*") return true
    const dynamicLeft = leftPart.startsWith(":")
    const dynamicRight = rightPart.startsWith(":")
    if (!dynamicLeft && !dynamicRight && leftPart !== rightPart) return false
    index += 1
  }
  if (index === leftParts.length && index === rightParts.length) return true
  return leftParts[index] === "*" || rightParts[index] === "*"
}

function trimRouteSlashes(value: string): string {
  let trimmed = value.trim()
  while (trimmed.startsWith("/")) trimmed = trimmed.slice(1)
  while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1)
  return trimmed
}

function generatedResourceHelpers(table: string, singular: string): Set<string> {
  const singularIdent = pascalCase(singular)
  return new Set([
    camelCase(table),
    `new${singularIdent}`,
    camelCase(singular),
    `edit${singularIdent}`,
  ])
}

function singularizeRouteName(name: string): string {
  if (/ies$/.test(name)) return name.replace(/ies$/, "y")
  if (/(s|x|z|ch|sh)es$/.test(name)) return name.slice(0, -2)
  if (/s$/.test(name)) return name.slice(0, -1)
  return name
}

function blockIndent(inner: string): string | undefined {
  const match = /\r?\n([ \t]*)\S/.exec(inner)
  return match === null ? undefined : match[1]
}
