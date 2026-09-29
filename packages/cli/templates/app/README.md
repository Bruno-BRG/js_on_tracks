# __APP_NAME__

A JOT TypeScript web app.

```sh
npm run migrate
npm run dev
```

Generate a full CRUD resource with `npx jot generate scaffold post title:string! body:text`, then run `npm run migrate` and restart the server. JOT protects `POST`, `PUT`, `PATCH`, and `DELETE` requests with CSRF tokens by default. Generated forms include the token automatically; manual forms should render the `csrfToken` prop as a hidden `_csrf` field.

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

Requires Node.js 24 or newer. See the [JOT guide](https://github.com/Bruno-BRG/js_on_tracks#readme) and the [blog example](https://github.com/Bruno-BRG/js_on_tracks/tree/master/examples/blog).
