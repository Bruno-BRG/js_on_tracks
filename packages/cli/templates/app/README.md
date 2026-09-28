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

## CSRF protection

JOT protects `POST`, `PUT`, `PATCH`, and `DELETE` routes by default. `GET`, `HEAD`, and `OPTIONS` do not need a token. A missing or invalid token returns `403` without running the controller.

For a manual HTML form, accept the framework-provided `csrfToken` prop and include it as a hidden field. The JSX renderer escapes the value:

```tsx
export default function NewPost({ csrfToken }: { csrfToken: string }) {
  return <form method="post" action="/posts">
    <input type="hidden" name="_csrf" value={csrfToken} />
    <button type="submit">Create</button>
  </form>
}
```

For JSON/API requests, call `this.csrfToken()` in the controller and send the returned value in the `X-CSRF-Token` header on every unsafe request. JSON bodies do not accept `_csrf` as a substitute. The token is stable for the session; call `this.session.rotateCsrfToken()` after an authentication change.

If a request receives `403`, fetch or render a fresh form and submit its token. Do not retry the mutation without a token or disable protection to fix an ordinary browser form.

An isolated webhook may opt out only when it has independent authentication, such as a verified provider signature:

```ts
r.post("/webhooks/provider", "webhooks#create", {
  csrf: { exempt: true, reason: "Verify the provider signature before processing" },
})
```

Disabling CSRF globally is discouraged. It requires a reviewed reason in `config/app.ts` and emits a startup warning:

```ts
csrf: { enabled: false, reason: "Bearer-authenticated API; no cookie authentication" }
```

## Development inside the JOT monorepo (M1)

`jot-framework` is not published on npm yet. Until it is, create apps with
`jot new <name> --no-install` and run `npm install` from the repository root so the
workspace packages resolve. Published packages arrive in a later milestone.
