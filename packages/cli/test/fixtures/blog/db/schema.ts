import { boolean, id, string, table, text, timestamps } from "jot-framework"

export const posts = table("posts", {
  id: id(),
  title: string().notNull(),
  body: text(),
  published: boolean().notNull().default(false),
  ...timestamps(),
})
