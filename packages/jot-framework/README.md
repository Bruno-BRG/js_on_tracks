# jot-framework

The app-facing entry point for the JOT TypeScript web framework. It re-exports the public APIs from `@js_on_tracks/core`, `@js_on_tracks/db`, `@js_on_tracks/orm`, and `@js_on_tracks/views`.

## Create an app

```sh
npm create jot@latest blog
cd blog
npm run migrate
npm run dev
```

Requires Node.js 24 or newer. Generated apps use ESM, TypeScript, `tsx`, and SQLite through the built-in `node:sqlite` module.

```ts
import { Controller, Model, paths, routes, table, id, string, presence } from "jot-framework"
```

Configure JSX with `"jsx": "react-jsx"` and `"jsxImportSource": "@js_on_tracks/views"`. JOT 1.0 includes model and scaffold generators, SQL migrations, validation, sessions, and default-on CSRF protection. Active Record associations are not included in 1.0.

See the [project guide](https://github.com/Bruno-BRG/js_on_tracks#readme), [architecture contract](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md), and [blog example](https://github.com/Bruno-BRG/js_on_tracks/tree/master/examples/blog).
