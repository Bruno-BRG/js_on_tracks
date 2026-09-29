# Primeiros passos com o JOT

Guia prático em português: do zero ao CRUD com formulário protegido por CSRF.
Para o contrato técnico completo, leia o architecture.md.

## 1. Criar o app

Pré-requisito: Node.js 24 ou mais novo.

```sh
npm create jot@latest blog
cd blog
npm run migrate
npm run dev
```

## 2. Gerar um CRUD

```sh
npx jot generate scaffold post title:string body:text
npm run migrate
```

Reinicie o jot server para regenerar o manifesto e abra http://localhost:3000/posts.
O scaffold cria model, migration, controller e views com token CSRF.

## 3. Formulário manual com CSRF

Formulários do scaffold já incluem o token. Num formulário escrito à mão,
renderize a prop csrfToken como campo oculto _csrf. POST sem token válido
retorna 403 antes da ação rodar.

## 4. Checklist de deploy

- PORT, DATABASE_URL e JOT_SECRET definidos no ambiente.
- Sem JOT_SECRET em produção, o boot falha de propósito.
- Migrations aplicadas antes de subir.
