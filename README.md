# JOT — JS on Tracks

Um framework web para TypeScript no espírito do Ruby on Rails: **muito opinativo, rápida de aprender e ainda mais rápida de desenvolver**.

```bash
npm create jot@latest blog
cd blog
jot db:migrate
jot server        # http://localhost:3000
```

## Princípios

1. Zero config para começar; config só quando você precisar mudar o padrão.
2. Convenção > configuração.
3. Batteries included — cada peça tem escape hatch.
4. SSR-first: JavaScript no cliente é exceção.
5. Type-safety ponta a ponta, sem decorators e sem reflexão mágica.
6. Migrations em SQL puro.
7. Um comando para cada tarefa.
8. Erros didáticos.
9. Windows é plataforma de primeira classe.

## Status

M0/M1 concluídos e M2 em andamento: `jot new` gera o app, `jot generate model|scaffold` cria models e CRUD REST com JSX SSR, SQLite, migrations SQL, validações e flash. O fluxo de scaffold está coberto por e2e de ponta a ponta. Ainda não é um release publicado; CSRF e associações ActiveRecord seguem no roadmap. Veja `docs/architecture.md` para o contrato técnico.

## Estrutura

| Pacote | Papel |
|---|---|
| `@jot/core` | Boot, rotas, controllers, Hono, sessão, static |
| `@jot/db` | Schema DSL (Drizzle) + driver SQLite + runner de migrations |
| `@jot/orm` | Camada ActiveRecord (`Model`, validações) |
| `@jot/views` | Runtime JSX SSR + cliente mínimo (`jot-*`) |
| `@jot/cli` | Binário `jot` (server, new, generate, db:*, routes, console) |
| `jot-framework` | Meta-pacote que os apps importam |
| `create-jot` | `npm create jot@latest` |

## Licença

MIT
