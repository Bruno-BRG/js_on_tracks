import { Controller } from "jot-framework"

export default class HomeController extends Controller {
  index() {
    return this.render("home/index", { framework: "JOT" })
  }
}
