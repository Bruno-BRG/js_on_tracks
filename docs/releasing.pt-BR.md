# Publicação dos pacotes JOT

Os sete pacotes públicos começam com a versão de desenvolvimento `0.0.0` no monorepo. O Changeset major inicial produz a primeira versão, `1.0.0`, no pull request de versionamento. `@jot/testing` continua privado e nunca entra no workflow de publicação.

## Fluxo automatizado

1. Faça merge em `master` de uma alteração com Changeset. O workflow Changesets cria ou atualiza um pull request com as novas versões.
2. Revise o pull request de versões e os checks de CI. Como o pull request é criado com `GITHUB_TOKEN`, um mantenedor com permissão de escrita talvez precise aprovar a execução dos workflows de Actions antes de os checks rodarem; o GitHub pode marcá-los como `approval-required` ([comportamento de aprovação dos workflows](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)). Depois, faça merge. O preflight da publicação compara todo o intervalo do push, de `github.event.before` até o commit enviado, e mantém o job OIDC desativado até definir `NPM_TRUSTED_PUBLISHING_READY=true`.
3. No primeiro release, execute o workflow manualmente com `bootstrap=true` em `master`. O preflight sem proteção falha a menos que os sete manifests públicos estejam exatamente em `1.0.0`; os checks protegidos então rodam contra o mesmo SHA de commit. Aprove o ambiente `npm-publish` e aguarde typecheck, testes, lint e validação dos pacotes. O job de bootstrap não publica.
4. Um mantenedor publica interativamente os sete pacotes `1.0.0` revisados com autenticação npm de dois fatores, na ordem das dependências. Esse passo único é necessário porque o npm exige que o pacote exista antes de configurar Trusted Publisher. Durante a preparação, o registry retornou `E404` para os sete nomes. Depois de os checks protegidos do bootstrap passarem, copie o SHA impresso pelo passo `Record the approved bootstrap source SHA` da execução bem-sucedida, faça checkout exatamente desse commit (`git checkout <SHA>`) e confirme que `git rev-parse HEAD` imprime o mesmo SHA antes de executar os comandos abaixo na raiz do repositório. Não publique de outro commit versionado. Quando necessário, o npm solicitará o segundo fator configurado.
5. Configure o Trusted Publisher de cada pacote e defina a variável de Actions `NPM_TRUSTED_PUBLISHING_READY` do repositório como `true`. O workflow ignora uma versão exata que já tenha sido publicada no bootstrap.
6. Nas versões seguintes, aprove a implantação `npm-publish`. O job OIDC repete typecheck, testes, lint e validação do conteúdo antes de publicar somente os pacotes com versão alterada.

Após o bootstrap, o job de publicação usa OIDC do GitHub Actions com npm Trusted Publishing e exige npm CLI 11.5.1 ou superior. Nenhum token npm fica armazenado em GitHub Actions. CI normal e o workflow Changesets não publicam pacotes.

## Configuração única do mantenedor

Antes de habilitar releases automatizados por OIDC:

1. Confirme que a conta npm pode publicar `jot-framework`, `create-jot` e os pacotes do escopo `@jot`. Se algum nome já estiver ocupado, resolva a titularidade antes do release.
2. Em **Settings → Actions → General → Workflow permissions**, habilite **Allow GitHub Actions to create and approve pull requests** para que o Changesets Action crie ou atualize seu pull request de versões ([requisitos do Changesets Action](https://github.com/changesets/action#requirements), [configuração do GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#allowing-github-actions-to-create-and-approve-pull-requests)).
3. Nas configurações do repositório GitHub, crie o ambiente `npm-publish` e adicione mantenedores como revisores obrigatórios.
4. Depois que o primeiro publish interativo criar os pacotes, adicione em cada um um trusted publisher GitHub Actions com owner `Bruno-BRG`, repositório `js_on_tracks`, arquivo de workflow `publish.yml` e ambiente `npm-publish`.
5. Defina a variável Actions do repositório `NPM_TRUSTED_PUBLISHING_READY` como `true` somente após configurar os sete publishers.
6. Confirme Node.js 24 e npm 11.5.1 ou superior no job de publicação.

O primeiro publish interativo e essas configurações do registry/GitHub são externos ao repositório e devem ser feitos por um mantenedor. Não adicione `NPM_TOKEN` aos secrets do repositório.

## Comandos do primeiro publish

Depois que a execução do workflow com `bootstrap=true` passar e o ambiente `npm-publish` for aprovado, copie o SHA exato impresso pelo passo bem-sucedido `Record the approved bootstrap source SHA`. Faça checkout desse SHA e confirme-o antes de publicar:

```sh
git checkout <SHA>
git rev-parse HEAD
```

A saída de `git rev-parse HEAD` deve ser igual ao SHA registrado pelo workflow protegido. Autentique-se como mantenedor autorizado e confirme a conta; então publique:

```sh
npm login
npm whoami
npm run check:packs
npm publish --workspace=@jot/db --access=public
npm publish --workspace=@jot/views --access=public
npm publish --workspace=@jot/orm --access=public
npm publish --workspace=@jot/core --access=public
npm publish --workspace=@jot/cli --access=public
npm publish --workspace=jot-framework --access=public
npm publish --workspace=create-jot --access=public
```

Pare se algum comando falhar; resolva o problema antes de publicar os pacotes dependentes. Esses comandos criam somente as versões `1.0.0` revisadas a partir do commit versionado, nunca os manifests `0.0.0` de preparação do monorepo.

## Lista de pacotes públicos

- `jot-framework`
- `create-jot`
- `@jot/cli`
- `@jot/core`
- `@jot/db`
- `@jot/orm`
- `@jot/views`
