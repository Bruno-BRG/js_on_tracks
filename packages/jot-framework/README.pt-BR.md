# jot-framework

Entry point voltado aos apps do framework web JOT para TypeScript. Ele reexporta as APIs públicas de `@jot/core`, `@jot/db`, `@jot/orm` e `@jot/views`.

## Crie um app

```sh
npm create jot@latest blog
cd blog
npm run migrate
npm run dev
```

Requer Node.js 24 ou superior. Os apps gerados usam ESM, TypeScript, `tsx` e SQLite pelo módulo nativo `node:sqlite`.

```ts
import { Controller, Model, paths, routes, table, id, string, presence } from "jot-framework"
```

Configure JSX com `"jsx": "react-jsx"` e `"jsxImportSource": "@jot/views"`. A JOT 1.0 inclui generators de model e scaffold, migrations SQL, validações, sessões e proteção CSRF ativada por padrão. Associações Active Record não fazem parte da 1.0.

Consulte o [guia do projeto](https://github.com/Bruno-BRG/js_on_tracks/blob/master/README.pt-BR.md), o [contrato de arquitetura](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md) e o [app de exemplo blog](https://github.com/Bruno-BRG/js_on_tracks/tree/master/examples/blog).
