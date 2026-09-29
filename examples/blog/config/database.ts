import { defineDatabase, env } from "jot-framework"

export default defineDatabase({
  url: env("DATABASE_URL", "./db/dev.sqlite"),
})
