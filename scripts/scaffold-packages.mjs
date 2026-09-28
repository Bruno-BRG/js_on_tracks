import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"

const root = process.cwd()
const pkgs = [
  { dir: "db", name: "@jot/db", deps: {} },
  { dir: "orm", name: "@jot/orm", deps: { "@jot/db": "*" } },
  { dir: "views", name: "@jot/views", deps: {} },
  { dir: "core", name: "@jot/core", deps: { "@jot/db": "*", "@jot/orm": "*", "@jot/views": "*" } },
  { dir: "cli", name: "@jot/cli", deps: {}, bin: { jot: "bin/jot.js" } },
  { dir: "testing", name: "@jot/testing", deps: { "@jot/core": "*" } },
  {
    dir: "jot-framework",
    name: "jot-framework",
    deps: { "@jot/core": "*", "@jot/db": "*", "@jot/orm": "*", "@jot/views": "*" },
  },
  { dir: "create-jot", name: "create-jot", deps: { "@jot/cli": "*" }, bin: { "create-jot": "bin/create-jot.js" } },
]

function w(file, content) {
  const p = join(root, file)
  mkdirSync(dirname(p), { recursive: true })
  if (!existsSync(p)) writeFileSync(p, content)
}

for (const pkg of pkgs) {
  const base = `packages/${pkg.dir}`
  const exportsMap =
    pkg.dir === "views"
      ? {
          ".": "./src/index.ts",
          "./jsx-runtime": "./src/jsx-runtime.ts",
          "./jsx-dev-runtime": "./src/jsx-dev-runtime.ts",
        }
      : { ".": "./src/index.ts" }

  const manifest = {
    name: pkg.name,
    version: "0.0.0",
    private: true,
    type: "module",
    license: "MIT",
    engines: { node: ">=24" },
    exports: exportsMap,
    scripts: {
      test: 'node --import tsx --test "src/**/*.test.ts"',
      typecheck: "tsc --noEmit",
    },
    dependencies: pkg.deps,
    ...(pkg.bin ? { bin: pkg.bin } : {}),
  }
  w(`${base}/package.json`, JSON.stringify(manifest, null, 2) + "\n")
  w(
    `${base}/tsconfig.json`,
    JSON.stringify({ extends: "../../tsconfig.base.json", include: ["src"] }, null, 2) + "\n",
  )
  w(`${base}/src/index.ts`, `// TODO: implementação do pacote ${pkg.name}\nexport {}\n`)
  w(
    `${base}/src/smoke.test.ts`,
    `import { test } from "node:test"\nimport assert from "node:assert/strict"\n\ntest("smoke", () => {\n  assert.ok(true)\n})\n`,
  )
  if (pkg.bin) {
    for (const file of Object.values(pkg.bin)) {
      w(`${base}/${file}`, `#!/usr/bin/env node\nconsole.error("not implemented yet: ${pkg.name}")\nprocess.exit(1)\n`)
    }
  }
}

console.log("scaffold ok:", pkgs.map((p) => p.name).join(", "))
