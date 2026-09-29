import { routes } from "jot-framework"

export default routes((r) => {
  r.root("home#index")
  r.resource("posts")
})
