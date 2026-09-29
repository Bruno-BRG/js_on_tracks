# @jot/views

Runtime de JSX renderizado no servidor usado pelos apps JOT. Exporta o runtime JSX automático, `renderToString`, escape de HTML, fragments, HTML cru e o pequeno script de navegador para interações de formulário `jot-*`.

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@jot/views"
  }
}
```

```tsx
import { renderToString } from "@jot/views"

const html = await renderToString(<main><h1>Olá</h1></main>)
```

SSR é o padrão e exige Node.js 24 ou superior em um app JOT. Consulte o [contrato de views](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md#43-jotviews).
