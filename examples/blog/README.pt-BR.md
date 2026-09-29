# Exemplo JOT Blog

Um app pequeno com JOT 1.0 que demonstra um model Post e um scaffold CRUD gerado com os pacotes públicos `jot-framework` e `@jot/cli`.

## Execute o app

Requer Node.js 24 ou superior.

```sh
npm install
npm run typecheck
npm run migrate
npm run dev
```

Abra `http://localhost:3000/posts`. O scaffold oferece as ações index, show, create, edit, update e delete com JSX renderizado no servidor, SQLite, validação, mensagens flash e tokens CSRF em todos os formulários gerados.

Para criar o mesmo recurso em um app novo, execute:

```sh
npx jot generate scaffold post title:string! body:text
npm run migrate
npm run dev
```

A migration versionada inclui uma seção `-- jot:down` para `npx jot db:rollback`. Alterações de schema usam migrations SQL puras; revise o SQL gerado antes de aplicá-lo.

## Segurança

Requisições mutáveis exigem um token CSRF válido por padrão. O smoke test do exemplo verifica que um POST sem token retorna `403` e depois cria, atualiza e exclui um post por formulários protegidos por token.

Consulte o [guia em inglês](https://github.com/Bruno-BRG/js_on_tracks#readme), o [guia em português](https://github.com/Bruno-BRG/js_on_tracks/blob/master/README.pt-BR.md) e o [contrato de arquitetura](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md).
