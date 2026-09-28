import type { Post } from "../../models/post.ts"

export default function PostsShow({ post }: { post: Post }) {
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
      <p>
        <a href="/posts">Back to posts</a>
      </p>
    </article>
  )
}
