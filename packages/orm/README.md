# @js_on_tracks/orm

Active Record models and validations for JOT. A model is bound to a schema table and uses the default database created by the framework boot process.

```ts
import { Model, presence } from "jot-framework"
import { posts } from "../../db/schema"

export class Post extends Model<typeof posts> {
  static readonly table = posts
  static validations = { title: [presence()] }
}

const post = Post.new({ title: "Hello" })
if (await post.save()) console.log(post.id)
```

JOT 1.0 provides queries, create/update/delete, and field validations. Associations and callbacks are planned for a later release. See the [ORM contract](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md#42-jotorm).
