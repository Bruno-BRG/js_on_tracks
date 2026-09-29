# __APP_NAME__

Um app web para TypeScript com JOT.

```sh
npm run migrate
npm run dev
```

Gere um recurso CRUD completo com `npx jot generate scaffold post title:string! body:text`, execute `npm run migrate` e reinicie o servidor. A JOT protege requisições `POST`, `PUT`, `PATCH` e `DELETE` com tokens CSRF por padrão. Os formulários gerados já incluem o token; formulários manuais devem renderizar a prop `csrfToken` em um campo oculto `_csrf`.

Requer Node.js 24 ou superior. Consulte o [guia da JOT](https://github.com/Bruno-BRG/js_on_tracks/blob/master/README.pt-BR.md) e o [app de exemplo blog](https://github.com/Bruno-BRG/js_on_tracks/tree/master/examples/blog).
