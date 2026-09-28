import { Model, minLength, presence } from "jot-framework"
import { posts } from "../../db/schema.ts"

/**
 * Campos declarados: dão ao `Post` o tipo completo da linha, para anotar props
 * de views (`{ post: Post }`) sem `InstanceOf<typeof Post>`.
 * O `jot generate` (M2) emite estes `declare` automaticamente.
 */
export class Post extends Model<typeof posts> {
  static readonly table = posts

  declare id: number
  declare title: string
  declare body: string | null
  declare published: boolean
  declare createdAt: Date
  declare updatedAt: Date

  static validations = {
    title: [presence(), minLength(3)],
  }
}
