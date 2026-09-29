# JOT — Contrato de Arquitetura (versão 1.0)

Documento **normativo**. Se o código divergir daqui, o código está errado — ou este documento deve ser
atualizado de propósito, nunca por acidente.

## 0. Decisões travadas

| Área | Decisão |
|---|---|
| HTTP | Hono (`hono` + `@hono/node-server`), controllers JOT por cima |
| UI | JSX SSR próprio (`@js_on_tracks/views`), HTMX-like (`jot-*`), zero JS no cliente por padrão |
| ORM | `@js_on_tracks/db` (schema DSL → Drizzle) + `@js_on_tracks/orm` (ActiveRecord) |
| Rotas | DSL em `config/routes.ts` (`r.resource("posts")`) + `paths` |
| Banco dev | SQLite via `node:sqlite` (builtin), através de um `Driver` próprio + `drizzle-orm/sqlite-proxy` |
| Migrations | Arquivos `.sql` puros aplicados pelo runner próprio do `@js_on_tracks/db` |
| Execução | Node >= 24; app roda via `tsx` (dev) — sem bundling nesta fase |
| Distribuição | npm; pacotes públicos `jot-framework`, `create-jot` e `@js_on_tracks/{cli,core,db,orm,views}` |

## 1. Convenções gerais

- **Node >= 24**, ESM (`"type": "module"`), TypeScript strict.
- Imports relativos **sem extensão** (`moduleResolution: bundler`). Nada de `.js` em import relativo.
- **Sem decorators, sem reflexão**. Tudo explícito ou por convenção de nomes de arquivo.
- Nomes: JS/TS em `camelCase`/`PascalCase`; colunas SQL em `snake_case` (mapeadas explicitamente
  na definição da coluna).
- **Windows-first**: `process.execPath`, `node:path`, `node:fs`. Nada de POSIX.
- **Erros didáticos**: toda mensagem prevista diz o que o usuário deve fazer.
- **Idioma**: mensagens voltadas ao usuário da framework (erros de runtime, CLI, páginas de erro) em
  **inglês** (framework é open source). Comentários de código e docs internos podem ser em português.
- Pacotes exportam **fonte TS** (`"exports": { ".": "./src/index.ts" }`) nesta fase. O bundling para
  publicação é um milestone posterior.

## 2. Mapa do repositório

```
packages/db          @js_on_tracks/db         schema DSL, Driver sqlite, createDatabase, migrations
packages/orm         @js_on_tracks/orm        Model (ActiveRecord), validações, operadores Drizzle re-export
packages/views       @js_on_tracks/views      runtime JSX SSR, renderToString, jsx-runtime, script cliente
packages/core        @js_on_tracks/core       defineApp/defineDatabase, routes DSL, Controller, start(), registry
packages/cli         @js_on_tracks/cli        binário `jot`, collect/manifest, comandos, templates/app
packages/testing     @jot/testing    helpers para apps (stub em M1)
packages/jot-framework  jot-framework  meta-pacote: re-exporta core+db+orm+views (import único do usuário)
packages/create-jot  create-jot      `npm create jot@latest`
examples/blog        app de referência (dogfooding)
```

Import do usuário é **sempre** `jot-framework` (nunca `@js_on_tracks/core` direto), exceto `@js_on_tracks/views`
no `jsxImportSource`.

## 3. App gerado (template)

`packages/cli/templates/app/` é copiado por `jot new`/`create-jot`:

```
myapp/
├─ package.json          type: module; deps: jot-framework; devDeps: @js_on_tracks/cli, drizzle-kit, tsx,
│                        typescript, @types/node
├─ tsconfig.json         strict, moduleResolution bundler, jsx react-jsx, jsxImportSource @js_on_tracks/views,
│                        allowImportingTsExtensions: true, noEmit: true
├─ .env                  PORT=3000, DATABASE_URL=./db/dev.sqlite, JOT_SECRET=<random>
├─ .gitignore            node_modules, .jot, *.sqlite, .env
├─ config/
│  ├─ app.ts             export default defineApp({ name: "..." })
│  ├─ database.ts        export default defineDatabase({ url: env("DATABASE_URL", "./db/dev.sqlite") })
│  └─ routes.ts          export default routes(r => { r.root("home#index") })
├─ app/
│  ├─ controllers/home_controller.ts
│  └─ views/
│     ├─ layouts/application.tsx
│     └─ home/index.tsx
├─ db/
│  ├─ schema.ts          (vazio em M1; será o schema do app)
│  ├─ migrate/           (.gitkeep)
│  └─ dev.sqlite         (gerado, gitignored)
├─ public/               (assets estáticos servidos em /)
└─ test/
```

Nomes de arquivos: `snake_case` (`posts_controller.ts`, `home/index.tsx`). Controller `posts_controller.ts`
→ chave de registry `Posts`; view `posts/index.tsx` → chave `posts/index`.

## 4. Contratos de API

### 4.1 `@js_on_tracks/db`

```ts
// Schema DSL (compila para drizzle-orm/sqlite-core)
import { table, id, string, text, boolean, integer, real, json, timestamps, refs } from "@js_on_tracks/db"

export const posts = table("posts", {
  id: id(),                                   // integer PK autoincrement, JS key "id"
  title: string().notNull(),                  // text, NOT NULL
  body: text(),                               // text nullable
  published: boolean().default(false),        // integer(boolean mode), default 0
  authorId: refs(() => users),                // FK → users.id, coluna "author_id"
  ...timestamps(),                            // createdAt/updatedAt (integer timestamp_ms), colunas created_at/updated_at
})
```

Regras:
- A chave JS do objeto vira o nome do campo e a coluna SQL é o `snake_case` dela
  (`createdAt` → `created_at`, `authorId` → `author_id`), **explicitamente** na definição da coluna.
- `table()` retorna um objeto de tabela **do Drizzle** (`sqliteTable`) — `drizzle-kit generate` precisa
  conseguir lê-lo.
- `timestamps()` retorna `{ createdAt, updatedAt }` (spread), não-nulos, mode `timestamp_ms`.
- `refs(() => users)` retorna coluna integer com FK; `{ onDelete: "cascade" }` opcional.

```ts
// Banco
import { createDatabase, setDefaultDatabase, getDefaultDatabase } from "@js_on_tracks/db"

const db = createDatabase({
  url: "./db/dev.sqlite",            // caminho ou file:... → SQLite (node:sqlite)
  schema: { posts, users },          // o namespace exportado por db/schema.ts
  migrationsDir: "./db/migrate",     // default relativo ao root
  logQueries: true,                  // dev only
})

await db.migrate()                    // aplica *.sql em ordem lexicográfica; tabela jot_migrations
await db.rollback(1)                  // desfaz N (default 1) usando a seção "-- jot:down"
await db.exec("select 1")             // SQL cru no driver
await db.close()
db.drizzle                            // instância Drizzle para o @js_on_tracks/orm
setDefaultDatabase(db) / getDefaultDatabase()
```

Regras de migration:
- Arquivo: `db/migrate/0001_create_posts.sql`, aplicado em ordem de nome.
- Tabela de controle: `jot_migrations (id integer pk, name text not null unique, applied_at integer)`.
- Down: tudo após a linha `-- jot:down` é o SQL de rollback. Sem a seção, `rollback` falha com erro
  didático ("migration \"X\" does not define -- jot:down; add the section or edit the database manually.").
- Migrations rodam no **driver cru**, não via Drizzle.
- `createDatabase` com `url` postgres → erro didático "Postgres support arrives in M3; use SQLite for now."

`Driver` (interface pública, `@js_on_tracks/db`):
```ts
interface Driver {
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  run(sql: string, params?: unknown[]): Promise<void>
  close(): Promise<void>
  /** Opcional: linhas posicionais para joins com nomes repetidos (node:sqlite: setReturnArrays). */
  queryArrays?(sql: string, params?: unknown[]): Promise<unknown[][]>
  /** Opcional: SQL multi-statement cru (node:sqlite: DatabaseSync.exec). */
  exec?(sql: string): Promise<void>
}
sqliteDriver({ file }): Driver      // node:sqlite DatabaseSync
```

`DatabaseOptions` extras aprovados: `root?` (ancia o default de `migrationsDir`), `logParams?` (default
`true`; `false` omite os params do log), `schema?` (opcional; só para o API relacional do Drizzle).

### 4.2 `@js_on_tracks/orm`

```ts
import { Model, presence, minLength, maxLength, format, eq, gt, and, or, desc } from "@js_on_tracks/orm"

export class Post extends Model<typeof posts> {
  static readonly table = posts
  static validations = {
    title: [presence(), minLength(3)],
    body: [presence()],
  }
}
```

Estáticos (tipados via `this` polimórfico):
```ts
Post.all()                          // Post[] ordenado por id asc (default)
Post.find(1)                        // Post | null (aceita number | string numérica)
Post.findBy({ title: "x" })         // Post | null
Post.where({ published: true })     // Post[] — igualdade por campo
Post.where(t => and(eq(t.published, true), gt(t.id, 10)))
Post.count(where?)                  // number
Post.create({ title: "x" })         // Post (inserido; timestamps automáticos)
Post.new({ title: "x" })            // instância não salva (alias claro de new Post(data))
```

Instância:
```ts
post.title                          // tipado (derivado do schema, sem declare manual)
post.isValid()                      // boolean (roda validações e popula errors)
post.errors                         // Record<string, string[]>
await post.save()                   // boolean: false se inválido; insere ou atualiza; timestamps automáticos
post.update({ title: "y" })         // aplica campos (não salva)
await post.destroy()                // delete
```

Regras:
- Só usa o banco via `getDefaultDatabase()` (setado pelo `@js_on_tracks/core` no boot). Se não houver banco,
  erro didático ("No database configured; define config/database.ts or call setDefaultDatabase().").
- `save()` valida antes de persistir; `errors` limpa a cada validação.
- Validações M1: `presence`, `minLength(n)`, `maxLength(n)`, `format(regex, message?)`.
- `where`/`findBy` aceitam apenas igualdade por campo; callback recebe as colunas Drizzle para
  operadores avançados.
- Associações Active Record não fazem parte da versão 1.0; ficam planejadas para uma versão futura.
- Inferência de tipos é requisito: `const p = await Post.find(1); p.title` deve compilar sem `declare`.

### 4.3 `@js_on_tracks/views`

- JSX **automático**: exporta `@js_on_tracks/views/jsx-runtime` (`jsx`, `jsxs`, `Fragment`) e
  `@js_on_tracks/views/jsx-dev-runtime`.
- Chaves comuns: `{ "exports": { ".": "./src/index.ts", "./jsx-runtime": "./src/jsx-runtime.ts", "./jsx-dev-runtime": "./src/jsx-dev-runtime.ts" } }`.
- `renderToString(vnode): Promise<string>` — resolve componentes **assíncronos** (await em promises
  dentro da árvore), escapa texto e atributos, ignora `null/undefined/false`, renderiza números e
  booleanos como atributo booleano quando `true`.
- Props especiais: `class`/`className`, `style` como objeto, `raw(string)` para HTML cru
  (`dangerouslySetInnerHTML` não é necessário).
- `Fragment` disponível para `<>...</>`.
- Elementos void (`br`, `img`, `input`, ...) não fecham nem aceitam filhos; children significativos
  neles geram erro didático (children vazios/nulos são ignorados).
- Erros de componente propagam com mensagem clara (sem stack perdida).
- `CLIENT_SCRIPT: string` — o JS do cliente (atributos `jot-*`), servido pelo core em `/_jot/jot.js`.
  M1: intercepta submit de `<form jot-method="post|put|patch|delete" jot-target="<seletor>" jot-swap="innerHTML|outerHTML" jot-confirm>`,
  faz `fetch`, aplica swap, e cai no comportamento nativo se `jot-target` ausente. ~100 linhas, sem deps.
- Sem estado, sem hooks, sem reatividade no M1 — SSR puro.

### 4.4 `@js_on_tracks/core`

```ts
import { defineApp, defineDatabase, routes, Controller, paths, env, start,
         registerControllers, registerViews } from "@js_on_tracks/core"

// config/app.ts
export default defineApp({ name: "blog" })

// config/database.ts
export default defineDatabase({ url: env("DATABASE_URL", "./db/dev.sqlite") })

// config/routes.ts
export default routes(r => {
  r.root("home#index")                       // GET /          → Home#index, helper paths.root()
  r.get("/about", "pages#about", { as: "about" })   // helper paths.about()
  r.resource("posts")                        // 7 rotas REST → Posts#index/new/create/show/edit/update/destroy
  r.resource("posts", { only: ["index", "show"] })
  r.resource("posts", { except: ["destroy"] })
})
```

Tabela de rotas de `r.resource("posts")`:

| método | caminho | controller#action | helper |
|---|---|---|---|
| GET | /posts | posts#index | `paths.posts()` |
| GET | /posts/new | posts#new | `paths.newPost()` |
| POST | /posts | posts#create | — |
| GET | /posts/:id | posts#show | `paths.post(id)` |
| GET | /posts/:id/edit | posts#edit | `paths.editPost(id)` |
| PUT/PATCH | /posts/:id | posts#update | — |
| DELETE | /posts/:id | posts#destroy | — |

- `DELETE`/`PUT`/`PATCH` em formulários HTML usam campo oculto `_method` (o cliente `jot-*`
  e o core respeitam `_method` no dispatch).
- `paths` é um objeto cujas funções vêm do registry de rotas (ex.: `paths.post(3)` → `/posts/3`).

Controller:
```ts
import { Controller, paths } from "jot-framework"
import { Post } from "../models/post.ts"

export default class PostsController extends Controller {
  async index() {
    const posts = await Post.all()
    return this.render("posts/index", { posts })     // layout application por padrão
  }
  async show() {
    const post = await Post.find(this.params.id!)
    if (!post) return this.renderNotFound()          // 404 didático
    return this.render("posts/show", { post })
  }
  async create() {
    const post = await Post.new(this.params)
    if (await post.save()) return this.redirectTo(paths.post(post.id), { flash: { notice: "Post criado." } })
    return this.render("posts/new", { post }, { status: 422 })
  }
}
```

- Acesso: `this.params` (route params + query + body mesclados), `this.query`, `this.body`,
  `this.session`, `this.flash`, `this.status`, `this.request` (Hono context, escape hatch).
- Retorno: `this.render(view, props?, { status?, layout? })`, `this.redirectTo(path, { flash?, status? })`,
  `this.json(data)`, `this.renderNotFound()`.
- Se o método **não retorna nada**, o core renderiza a view convencional
  `${snake(controller)}/${action}` — ex.: `Posts#index` → `posts/index`.
- Layout: `app/views/layouts/application.tsx` recebe `{ children, ...layoutProps }`. `{ layout: false }`
  desliga. Erros: view ausente → erro didático citando o caminho esperado e o comando para regenerar.

Boot:
```ts
// start() é chamado pelo entry gerado pelo CLI
await start({ app, routes, database, root: process.cwd(), port? })
// → cria o Database (se database config presente), setDefaultDatabase, registra rotas no Hono,
//   static de public/, /_jot/jot.js, sessão assinada, request log, páginas de erro, serve na porta
```

- `.env` é carregado com `process.loadEnvFile()` (builtin) se existir.
- `env(name, fallback?)` lê process.env e devolve fallback se ausente.
- Sessão: cookie `jot_session` assinado com HMAC-SHA256 usando `JOT_SECRET`
  (em dev, ausente → gera aleatório por boot com aviso; em prod, ausente → erro didático).
- O token CSRF synchronizer fica privado na sessão assinada; `get`/`has`/`all` não o expõem.
  Tokens têm 32 bytes aleatórios codificados em base64url, permanecem estáveis na sessão e só
  mudam por `this.session.rotateCsrfToken()` (por exemplo, após autenticar, sair ou mudar privilégios).
  Flash: mensagens consumidas no próximo render.
- CSRF: proteção **default-on** (também pode ser declarada como `csrf: { enabled: true }` em
  `defineApp`). `POST`, `PUT`, `PATCH` e `DELETE` exigem o token; `GET`, `HEAD` e `OPTIONS` são
  seguros e não o exigem. O middleware verifica o método efetivo depois do `_method` override.
  Formulários urlencoded/multipart enviam o token em `_csrf`; requests JSON/API usam
  `X-CSRF-Token` (um `_csrf` no JSON body não autentica). Query string nunca autentica; quando
  campo e header são enviados juntos, ambos devem ser válidos e iguais. O campo `_csrf` é removido
  antes de `body`/`params` chegarem ao controller.
- Forms gerados pelo scaffold incluem o hidden `_csrf` nas views de new/edit e no delete de show;
  forms manuais usam o `csrfToken` injetado pelo framework. `this.csrfToken()` fornece o mesmo
  token para clientes JSON, e respostas render/JSON que o emitem são `private, no-store`.
- Falha ou ausência de token devolve `403` genérico antes da action, sem refletir token ou body;
  a resposta é `no-store`, `nosniff` e `Vary: Accept`, negociando HTML/JSON. Sem `Accept`, o
  Content-Type JSON da request prefere JSON; se nenhuma representação suportada for aceitável,
  o fallback determinístico é HTML.
- Opt-outs são explícitos e avisam no boot, inclusive em produção, para a desativação global e
  cada isenção de rota mutável. Desativação global exige
  `csrf: { enabled: false, reason: "..." }` com razão não vazia. Isenção de rota exige
  `csrf: { exempt: true, reason: "..." }` e deve ficar restrita a endpoints com autenticação
  independente (por exemplo, webhook com assinatura verificada); `r.resource` aceita a mesma
  opção e a aplica somente às ações mutáveis.
- Log de requests: `GET /posts 200 12ms` com cores (picocolors).
- Static: `public/**` servido em `/` (com `Content-Type` correto e 404 para arquivos ausentes).
- Dev: erro 500 = página HTML com mensagem e stack. Produção: página genérica.
- Registry: `registerControllers({ Posts: PostsController })` e
  `registerViews({ "posts/index": fn, "layouts/application": fn })` são chamados pelo
  `manifest.ts` gerado. `registerControllers` também define o nome de rota do controller.
- Rotas sem controller/view correspondente → erro didático no boot (não em runtime).

### 4.5 `jot-framework`

```ts
export * from "@js_on_tracks/core"
export * from "@js_on_tracks/db"
export * from "@js_on_tracks/orm"
export * from "@js_on_tracks/views"
```

### 4.6 `@js_on_tracks/cli`

Bin: `jot`. Estrutura: `bin/jot.js` (JS puro) → importa `dist/cli.js` se existir, senão registra
`tsx` (`tsx/esm/api` → `register()`) e importa `src/main.ts`. Toda execução de código do **app**
acontece em processo filho `node --import tsx` (o CLI nunca importa o app diretamente).

Comandos públicos da versão 1.0:
- `jot new <nome> [--no-install]` — copia `templates/app`, substitui `__APP_NAME__`, roda `npm install`
  (pulado com `--no-install`).
- `jot server` — `collect` + spawn `node --disable-warning=ExperimentalWarning --import tsx --watch --enable-source-maps .jot/entry.ts`
  com `stdio: inherit`; repassa SIGINT. Loga `JOT v<versão> → http://localhost:<porta>`.
  Matar a árvore de processos no Windows exige `taskkill /pid <pid> /T /F` (o `--watch` cria processo filho).
- `jot db:generate` — spawn `drizzle-kit generate` (gera `db/migrate/*.sql` a partir de `db/schema.ts`).
- `jot db:migrate` / `jot db:rollback [n]` — spawn script gerado `.jot/db-script.ts`.
- `jot routes` — spawn `.jot/routes-script.ts` e imprime a tabela.
- `jot console` — spawn REPL com `db`, models e `paths` no contexto.
- `jot --version`, `jot --help` com lista de comandos (erro didático para comando desconhecido).

`collect(root)` gera em `.jot/` (gitignored):
- `manifest.ts`:
  ```ts
  import { registerControllers, registerViews } from "jot-framework"
  import HomeController from "../app/controllers/home_controller.ts"
  import homeIndex from "../app/views/home/index.tsx"
  import appLayout from "../app/views/layouts/application.tsx"
  registerControllers({ Home: HomeController })
  registerViews({ "home/index": homeIndex, "layouts/application": appLayout })
  ```
- `entry.ts`:
  ```ts
  import "./manifest.ts"
  import { start } from "jot-framework"
  import app from "../config/app.ts"
  import routes from "../config/routes.ts"
  import database from "../config/database.ts"   // omitido se o arquivo não existir
  await start({ app, routes, database })
  ```
- `db-script.ts`, `routes-script.ts` e `console-script.ts` para os comandos correspondentes
  (o CLI nunca importa código do app no próprio processo — sempre em processo filho).
- Imports usam extensão explícita `.ts`/`.tsx`; ordem determinística (alfabética).
- Views em `app/views/layouts/**` também entram no registry como `layouts/<nome>`.

Regras:
- `packages/cli/templates/app` é a fonte do `jot new` **e** do `create-jot` (mesma função).
- Mensagens em português ou inglês? **Inglês** para o CLI (open source); os erros didáticos citam
  comandos exatos.
- O CLI nunca assume que `node_modules/.bin` está no PATH: usa `process.execPath` e resolve binários
  via `createRequire(import.meta.url).resolve("<pkg>/package.json")`.

### 4.7 `create-jot`

Bin `create-jot` (JS puro, mesmo padrão do bin do CLI): pergunta o nome do projeto (ou usa `argv[2]`),
chama a mesma função `newProject()` do `@js_on_tracks/cli`. `npm create jot@latest blog` precisa funcionar.

## 5. Fluxo de `jot server`

```
collect(root)                       → .jot/manifest.ts, .jot/entry.ts
spawn: node --import tsx --watch --enable-source-maps .jot/entry.ts
  └─ entry importa manifest e configs, chama start()
      └─ start(): loadEnvFile .env → defineDatabase → setDefaultDatabase → Hono → serve
```

- Alterou arquivo de app sem criar/remover arquivos → restart automático (node --watch).
- Criou/removeu controller ou view → reinicie `jot server` (o manifest é regenerado só no boot do CLI);
  o erro de view/controller ausente deve dizer isso explicitamente.

## 6. E2E dourado e exemplo público (versão 1.0)

`packages/cli/test/e2e.test.ts` verifica o fluxo do gerador de scaffold:

1. Cria um app em diretório temporário e executa `jot generate scaffold` para um recurso com colunas tipadas.
2. Verifica o typecheck do app e aplica a migration SQLite com `jot db:migrate`.
3. Sobe `jot server` em porta livre e cobre listagem, formulário, criação, edição, atualização e exclusão.
4. Confirma que POST sem token CSRF retorna `403`, que os formulários enviam token e que recursos ausentes retornam `404`.
5. Encerra o servidor e remove os arquivos temporários mesmo em caso de falha.

`examples/blog` mantém um app equivalente usando somente as APIs públicas. O smoke test executa migrations e CRUD/CSRF sem rede.

## 7. Testes

- Framework: `node:test` + `node:assert/strict`, rodando via `npm test -w <pacote>`
  (`node --import tsx --test "src/**/*.test.ts"`).
- Cada pacote testa o seu contrato isoladamente; fakes são bem-vindos para o driver de banco;
  o e2e dourado é a prova de integração.
- Sem rede nos testes.

## 8. Escopo da versão 1.0

Incluídos: generators de model e scaffold, app de referência `examples/blog`, publicação npm dos sete pacotes públicos e documentação em português e inglês. `@jot/testing` segue privado e não é publicado.

Ficam para versões futuras: associações Active Record, callbacks, sessões em banco, jobs, mailer,
uploads, Postgres, bundling de produção, i18n do runtime e ilhas/client components.

## 9. Definição de pronto

`npm run typecheck`, `npm test`, `npm run lint` e `npm run check:packs` verdes. O e2e dourado e o smoke de `examples/blog` passam em Windows e Linux com Node.js 24. Cada tarball contém README em inglês e português, licença MIT e os entrypoints necessários; não contém testes, fixtures ou `tsconfig.json`.

A publicação de cada versão roda em workflow separado, depois de aprovação do ambiente GitHub `npm-publish`, usando npm Trusted Publishing/OIDC. O maintainer configura aprovação obrigatória no ambiente e vínculo de trusted publisher para cada pacote; nenhum token npm de longa duração é usado. Consulte o [guia de release](releasing.md).
