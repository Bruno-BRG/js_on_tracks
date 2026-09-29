# @jot/core

Runtime HTTP da JOT: boot do app, definições de rota, controllers, sessões assinadas, verificações CSRF, arquivos estáticos e ciclo de vida do servidor. A maioria dos apps deve importar essas APIs de `jot-framework`.

```ts
import { Controller, defineApp, routes, start } from "jot-framework"

export default routes((r) => r.root("home#index"))
```

Requer Node.js 24 ou superior. Rotas mutáveis exigem um token CSRF válido por padrão. Consulte o [contrato de arquitetura](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md#44-jotcore) para comportamento de rotas, controllers, sessões e segurança.
