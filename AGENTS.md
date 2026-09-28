# Regras de engenharia — JOT

Leia `docs/architecture.md` **antes** de tocar em qualquer código. Ele é o contrato: APIs públicas,
formatos de arquivo e convenções estão definidos lá.

1. **Escopo**: edite apenas o diretório do(s) seu(s) pacote(s). Nunca edite arquivos de outro pacote,
   configs da raiz ou `docs/`.
2. **Stack**: Node >= 24, ESM (`"type": "module"`), TypeScript strict herdando `tsconfig.base.json`
   (`moduleResolution: bundler`, imports relativos **sem extensão**, `jsx: react-jsx` com
   `jsxImportSource: @jot/views`).
3. **Proibido**: decorators, `emitDecoratorMetadata`, `require`, `.js` em imports relativos, `any`
   gratuito em API pública, e **novas dependências** — tudo que você precisa já está instalado
   (não rode `npm install`; se faltar algo, reporte).
4. **Testes**: use `node:test` + assert. Rode `npm test -w <pacote>` e `npm run typecheck -w <pacote>`.
   Testes devem ser determinísticos e não depender de rede.
5. **Windows-first**: use `process.execPath`, `node:path`, `node:fs`; nada de comandos POSIX,
   nada de `\n` hardcoded em arquivos de dados.
6. **Erros didáticos**: toda falha prevista deve dizer o que fazer
   (ex.: "View 'posts/index' não encontrada. Esperado em app/views/posts/index.tsx. Rode `jot server` para regenerar o manifest.")
7. **Não commite** no git. Não crie arquivos fora do seu escopo.
8. **Ao terminar**, responda: (a) arquivos criados, (b) comandos executados com resultado,
   (c) pendências/bugs conhecidos, (d) desvios do contrato (com justificativa).
