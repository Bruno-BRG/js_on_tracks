import type { Post } from "../../models/post.ts"

export default function PostsIndex({ posts }: { posts: Post[] }) {
  return (
    <section>
      <h1>Posts</h1>
      {posts.length === 0 ? <p>No posts yet.</p> : null}
      <ul class="posts">
        {posts.map((post) => (
          <li>
            <a href={`/posts/${post.id}`}>{post.title}</a>
          </li>
        ))}
      </ul>
      <p>
        <a href="/posts/new">New post</a>
      </p>
    </section>
  )
}
