# @jot/db

SQLite database utilities for JOT, including a typed schema DSL, the built-in `node:sqlite` driver, database creation, and a SQL migration runner.

```ts
import { createDatabase, id, string, table } from "jot-framework"

export const posts = table("posts", { id: id(), title: string().notNull() })
const db = createDatabase({ url: "./db/dev.sqlite", schema: { posts } })
await db.migrate()
```

Migration files are plain `.sql` files under `db/migrate`, applied in lexical order. Requires Node.js 24 or newer. See the [database contract](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md#41-jotdb).
