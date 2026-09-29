# @js_on_tracks/db

Utilitários de banco SQLite para JOT, incluindo DSL de schema tipada, driver nativo `node:sqlite`, criação do banco e runner de migrations SQL.

```ts
import { createDatabase, id, string, table } from "jot-framework"

export const posts = table("posts", { id: id(), title: string().notNull() })
const db = createDatabase({ url: "./db/dev.sqlite", schema: { posts } })
await db.migrate()
```

Os arquivos de migration são `.sql` puros em `db/migrate` e rodam em ordem lexicográfica. Requer Node.js 24 ou superior. Consulte o [contrato do banco](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md#41-jotdb).
