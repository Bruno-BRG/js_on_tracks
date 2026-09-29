import { Model, presence } from "jot-framework"
import { posts } from "../../db/schema"

/** `declare` gives the full row type; views annotate `{ post: Post }` without `InstanceOf`. */
export class Post extends Model<typeof posts> {
  static readonly table = posts

  declare id: number
  declare title: string
  declare body: string | null
  declare createdAt: Date
  declare updatedAt: Date

  static validations = {
    title: [presence()],
  }
}
