# @js_on_tracks/cli

The JOT command-line interface. Its `jot` executable creates apps, starts the development server, generates models and CRUD scaffolds, runs SQL migrations, lists routes, and opens the app console.

```sh
npm create jot@latest blog
cd blog
npx jot generate scaffold post title:string! body:text
npm run migrate
npm run dev
```

Run `npx jot generate model <Name> field:type ...` to create a model without REST routes or views. Add `--no-db-generate` to edit the SQL migration yourself. Requires Node.js 24 or newer.

See the [CLI command reference](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md#46-jotcli) and [blog example](https://github.com/Bruno-BRG/js_on_tracks/tree/master/examples/blog).
