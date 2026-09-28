import { generateResource } from "./index"

void generateResource("post", [], { kind: "model", dbGenerate: false })

// @ts-expect-error The public API intentionally has no dependency-injection argument.
void generateResource("post", [], { kind: "model", dbGenerate: false }, { commit: () => undefined })
