# @js_on_tracks/core

The HTTP runtime behind JOT: app boot, route definitions, controllers, signed sessions, CSRF checks, static files, and server lifecycle. Most apps should import these APIs from `jot-framework`.

```ts
import { Controller, defineApp, routes, start } from "jot-framework"

export default routes((r) => r.root("home#index"))
```

Node.js 24 or newer is required. Mutating routes require a valid CSRF token by default. See the [architecture contract](https://github.com/Bruno-BRG/js_on_tracks/blob/master/docs/architecture.md#44-jotcore) for route, controller, session, and security behavior.
