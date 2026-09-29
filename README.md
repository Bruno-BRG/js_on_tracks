# JOT — JS on Tracks

JOT is an opinionated TypeScript web framework in the spirit of Ruby on Rails: conventions, generators, server-rendered JSX, SQLite, and SQL migrations in one toolkit.

```bash
npm create jot@latest blog
cd blog
npm run migrate
npm run dev        # http://localhost:3000
```

## Principles

1. Start with sensible defaults and add configuration when needed.
2. Convention over configuration.
3. Batteries included, with escape hatches.
4. Server rendering first; client-side JavaScript is optional.
5. End-to-end type safety without decorators or runtime reflection.
6. Plain SQL migrations.
7. A command for each task.
8. Errors explain how to fix the problem.
9. Windows is a first-class platform.

## Version 1.0 scope

JOT 1.0 includes the app generator, model and scaffold generators, REST routes, server-rendered JSX, SQLite, SQL migrations, validations, flash messages, and default-on CSRF protection. Active Record associations are planned for a later release. See [the architecture contract](docs/architecture.md) and the runnable [blog example](examples/blog/README.md).

## Packages

| Package | Purpose |
|---|---|
| `jot-framework` | App-facing framework entrypoint |
| `create-jot` | `npm create jot@latest` project generator |
| `@js_on_tracks/cli` | `jot` server, generator, database, route, and console commands |
| `@js_on_tracks/core` | App boot, routes, controllers, sessions, and HTTP runtime |
| `@js_on_tracks/db` | SQLite schema, driver, and migration runner |
| `@js_on_tracks/orm` | Active Record models and validations |
| `@js_on_tracks/views` | JSX server rendering and progressive interactions |

`@jot/testing` is a private development package and is not part of the 1.0 release.

## Requirements

- Node.js 24 or newer.
- TypeScript with ESM and bundler module resolution.
- Generated apps use `tsx` for development and do not bundle the framework.

## Documentation

- Português brasileiro: [README.pt-BR.md](README.pt-BR.md)
- Technical contract: [docs/architecture.md](docs/architecture.md)
- Release process: [docs/releasing.md](docs/releasing.md)
- Tutorial (PT-BR): [docs/primeiros-passos.md](docs/primeiros-passos.md)
- Example app: [examples/blog](examples/blog/README.md)

## License

MIT. See [LICENSE](LICENSE).
