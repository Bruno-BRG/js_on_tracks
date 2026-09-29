import type { Post } from "../../models/post"

export default function PostForm({
  post,
  csrfToken,
  action,
  method = "post",
  values,
}: {
  post: Post
  csrfToken: string
  action: string
  method?: "post" | "put"
  values?: Record<string, string | undefined>
}) {
  return (
    <form method="post" action={action}>
      <input type="hidden" name="_csrf" value={csrfToken} />
      {method === "put" ? <input type="hidden" name="_method" value="put" /> : null}
      <div>
        <label for="title">Title</label>
        <input id="title" name="title" value={values?.title ?? post.title ?? ""} />
        {post.errors.title && post.errors.title.length > 0 ? (
          <p class="error">{post.errors.title.join(", ")}</p>
        ) : null}
      </div>
      <div>
        <label for="body">Body</label>
        <textarea id="body" name="body">
          {values?.body ?? post.body ?? ""}
        </textarea>
      </div>
      <button type="submit">Save</button>
    </form>
  )
}
