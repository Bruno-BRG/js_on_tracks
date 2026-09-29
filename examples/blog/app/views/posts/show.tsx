import { paths } from "jot-framework"
import type { Post } from "../../models/post"

export default function PostsShow({ post, csrfToken }: { post: Post; csrfToken: string }) {
  return (
    <article>
      <h1>{post.title}</h1>
      <dl>
        <dt>Body</dt>
        <dd>{post.body}</dd>
      </dl>
      <p>
        <a href={paths.editPost(post.id)}>Edit</a> · <a href={paths.posts()}>Back to posts</a>
      </p>
      <form method="post" action={paths.post(post.id)}>
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="_method" value="delete" />
        <button type="submit">Delete</button>
      </form>
    </article>
  )
}
