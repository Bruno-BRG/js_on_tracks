# __APP_NAME__

A JOT TypeScript web app.

```sh
npm run migrate
npm run dev
```

Generate a full CRUD resource with `npx jot generate scaffold post title:string! body:text`, then run `npm run migrate` and restart the server. JOT protects `POST`, `PUT`, `PATCH`, and `DELETE` requests with CSRF tokens by default. Generated forms include the token automatically; manual forms should render the `csrfToken` prop as a hidden `_csrf` field.

Requires Node.js 24 or newer. See the [JOT guide](https://github.com/Bruno-BRG/js_on_tracks#readme) and the [blog example](https://github.com/Bruno-BRG/js_on_tracks/tree/master/examples/blog).
