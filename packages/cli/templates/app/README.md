# __APP_NAME__

App JOT (JS on Tracks).

```bash
npm run dev        # http://localhost:3000
npm run migrate    # aplica db/migrate/*.sql
npm run routes     # lista as rotas
npm run console    # REPL com db, models e paths
```

- Rotas: `config/routes.ts`
- Schema do banco: `db/schema.ts` (+ `npm run generate` para criar a migration)
- Controllers: `app/controllers`
- Views: `app/views` (JSX, SSR)

## Development inside the JOT monorepo (M1)

`jot-framework` is not published on npm yet. Until it is, create apps with
`jot new <name> --no-install` and run `npm install` from the repository root so the
workspace packages resolve. Published packages arrive in a later milestone.
