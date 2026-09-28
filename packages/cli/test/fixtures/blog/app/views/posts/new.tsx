import type { Post } from "../../models/post.ts"

export default function PostsNew({ post }: { post: Post }) {
  const titleErrors = post.errors.title
  return (
    <section>
      <h1>New post</h1>
      <form method="post" action="/posts">
        <div>
          <label for="title">Title</label>
          <input id="title" name="title" value={post.title ?? ""} />
          {titleErrors && titleErrors.length > 0 ? (
            <p class="error">{titleErrors.join(", ")}</p>
          ) : null}
        </div>
        <div>
          <label for="body">Body</label>
          <textarea id="body" name="body">
            {post.body ?? ""}
          </textarea>
        </div>
        <button type="submit">Create</button>
      </form>
    </section>
  )
}
