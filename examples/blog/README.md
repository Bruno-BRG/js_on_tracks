# JOT Blog example

A small JOT 1.0 app that demonstrates a generated Post model and full CRUD scaffold using the public `jot-framework` and `@js_on_tracks/cli` packages.

## Run the app

Requires Node.js 24 or newer.

```sh
npm install
npm run typecheck
npm run migrate
npm run dev
```

Open `http://localhost:3000/posts`. The scaffold provides index, show, create, edit, update, and delete actions with server-rendered JSX, SQLite, validation, flash messages, and CSRF tokens in every generated form.

To create the same resource in a fresh app, run:

```sh
npx jot generate scaffold post title:string! body:text
npm run migrate
npm run dev
```

The checked-in migration includes a `-- jot:down` section for `npx jot db:rollback`. Schema changes use plain SQL migrations; review generated SQL before applying it.

## Security behavior

Mutating requests require a valid CSRF token by default. The example smoke test checks that a POST without a token returns `403`, then creates, updates, and deletes a post through token-protected forms.

See the [English project guide](https://github.com/Bruno-BRG/js_on_tracks#readme), [Portuguese guide](https://github.com/Bruno-BRG/js_on_tracks/blob/master/README.pt-BR.md), and [architecture contract](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md).
