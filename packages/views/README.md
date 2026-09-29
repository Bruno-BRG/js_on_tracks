# @js_on_tracks/views

The JSX server-rendering runtime used by JOT apps. It exports the automatic JSX runtime, `renderToString`, HTML escaping, fragments, raw HTML, and the small browser-side script for `jot-*` form interactions.

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@js_on_tracks/views"
  }
}
```

```tsx
import { renderToString } from "@js_on_tracks/views"

const html = await renderToString(<main><h1>Hello</h1></main>)
```

SSR is the default and requires Node.js 24 or newer in a JOT app. See the [views contract](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md#43-jotviews).
