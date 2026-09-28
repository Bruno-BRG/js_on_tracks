import { Controller, paths } from "jot-framework"
import { Post } from "../models/post.ts"

export default class PostsController extends Controller {
  async index() {
    const posts = await Post.all()
    return this.render("posts/index", { posts })
  }

  async new() {
    return this.render("posts/new", { post: Post.new({}) })
  }

  async create() {
    const post = Post.new({
      title: String(this.params.title ?? ""),
      body: String(this.params.body ?? ""),
    })
    if (await post.save()) {
      return this.redirectTo(paths.post(post.id), { flash: { notice: "Post created." } })
    }
    return this.render("posts/new", { post }, { status: 422 })
  }

  async show() {
    const post = await Post.find(String(this.params.id))
    if (!post) return this.renderNotFound()
    return this.render("posts/show", { post })
  }
}
