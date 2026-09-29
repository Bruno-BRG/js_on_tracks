# JOT — JS on Tracks

JOT é um framework web opinativo para TypeScript, inspirado no Ruby on Rails: convenções, generators, JSX renderizado no servidor, SQLite e migrations SQL em uma única ferramenta.

```bash
npm create jot@latest blog
cd blog
npm run migrate
npm run dev        # http://localhost:3000
```

## Escopo da versão 1.0

A JOT 1.0 inclui o generator de apps, generators de model e scaffold, rotas REST, JSX renderizado no servidor, SQLite, migrations SQL, validações, mensagens flash e proteção CSRF ativada por padrão. Associações Active Record estão planejadas para uma versão futura. Consulte o [contrato de arquitetura](docs/architecture.md) e o [app de exemplo blog](examples/blog/README.md).

## Pacotes

| Pacote | Função |
|---|---|
| `jot-framework` | Entry point do framework para apps |
| `create-jot` | Generator de projetos `npm create jot@latest` |
| `@jot/cli` | Comandos `jot` para servidor, generators, banco, rotas e console |
| `@jot/core` | Boot, rotas, controllers, sessões e runtime HTTP |
| `@jot/db` | Schema SQLite, driver e runner de migrations |
| `@jot/orm` | Models Active Record e validações |
| `@jot/views` | Renderização JSX no servidor e interações progressivas |

`@jot/testing` é um pacote privado de desenvolvimento e não faz parte do release 1.0.

## Requisitos

- Node.js 24 ou superior.
- TypeScript com ESM e resolução de módulos `bundler`.
- Apps gerados usam `tsx` durante o desenvolvimento e não fazem bundling do framework.

## Documentação

- Inglês: [README.md](README.md)
- Português brasileiro: [README.pt-BR.md](README.pt-BR.md)
- Contrato técnico: [docs/architecture.md](docs/architecture.md)
- Processo de release: [docs/releasing.pt-BR.md](docs/releasing.pt-BR.md)
- App de exemplo: [examples/blog](examples/blog/README.md)

## Licença

MIT. Consulte [LICENSE](LICENSE).
