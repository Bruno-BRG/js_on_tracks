import { Model, presence, minLength } from "jot-framework"
import { posts } from "../../db/schema.ts"

export class Post extends Model<typeof posts> {
  static readonly table = posts

  static validations = {
    title: [presence(), minLength(3)],
  }
}
