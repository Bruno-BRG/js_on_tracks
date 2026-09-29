import { paths } from "jot-framework"
import type { Post } from "../../models/post"
import PostForm from "./_form"

export default function PostsNew({
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
      <h1>New post</h1>
      <PostForm post={post} csrfToken={csrfToken} action={paths.posts()} values={values} />
    </section>
  )
}
