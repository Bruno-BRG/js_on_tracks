export default function ApplicationLayout(props: { children?: unknown; title?: string }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title ?? "blog"}</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <header class="topbar">
          <a href="/" class="brand">
            blog
          </a>
          <span class="tag">powered by JOT</span>
        </header>
        <main class="container">{props.children}</main>
        <script src="/_jot/jot.js"></script>
      </body>
    </html>
  )
}
