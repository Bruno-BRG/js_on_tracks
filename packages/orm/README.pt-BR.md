# @js_on_tracks/orm

Models Active Record e validações para JOT. Cada model usa uma tabela do schema e o banco padrão configurado durante o boot do framework.

```ts
import { Model, presence } from "jot-framework"
import { posts } from "../../db/schema"

export class Post extends Model<typeof posts> {
  static readonly table = posts
  static validations = { title: [presence()] }
}

const post = Post.new({ title: "Olá" })
if (await post.save()) console.log(post.id)
```

A JOT 1.0 oferece consultas, criação/atualização/exclusão e validações de campos. Associações e callbacks estão planejados para uma versão futura. Consulte o [contrato do ORM](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md#42-jotorm).
