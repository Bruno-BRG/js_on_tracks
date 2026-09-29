import { paths } from "jot-framework"
import type { Post } from "../../models/post"

export default function PostsIndex({ posts }: { posts: Post[] }) {
  return (
    <section>
      <h1>Posts</h1>
      {posts.length === 0 ? <p>No posts yet.</p> : null}
      <ul class="posts">
        {posts.map((post) => (
          <li>
            <a href={paths.post(post.id)}>{post.title}</a>
          </li>
        ))}
      </ul>
      <p>
        <a href={paths.newPost()}>New post</a>
      </p>
    </section>
  )
}
