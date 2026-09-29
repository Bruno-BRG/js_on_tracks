# @jot/cli

Interface de linha de comando da JOT. O executável `jot` cria apps, inicia o servidor de desenvolvimento, gera models e scaffolds CRUD, executa migrations SQL, lista rotas e abre o console do app.

```sh
npm create jot@latest blog
cd blog
npx jot generate scaffold post title:string! body:text
npm run migrate
npm run dev
```

Utilize `npx jot generate model <Name> field:type ...` para criar um model sem rotas REST ou views. Adicione `--no-db-generate` para editar a migration SQL manualmente. Requer Node.js 24 ou superior.

Consulte a [referência de comandos](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md#46-jotcli) e o [app de exemplo blog](https://github.com/Bruno-BRG/js_on_tracks/tree/master/examples/blog).
