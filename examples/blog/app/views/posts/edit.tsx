import { paths } from "jot-framework"
import type { Post } from "../../models/post"
import PostForm from "./_form"

export default function PostsEdit({
  post,
  csrfToken,
  values,
}: {
  post: Post
  csrfToken: string
  values?: Record<string, string | undefined>
}) {
  return (
    <section>
      <h1>Edit post</h1>
      <PostForm
        post={post}
        csrfToken={csrfToken}
        action={paths.post(post.id)}
        method="put"
        values={values}
      />
    </section>
  )
}
