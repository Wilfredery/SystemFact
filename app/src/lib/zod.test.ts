/**
 * El wrapper de zod (docs/22 T1 stage 2): zod no debe sondear `new Function("")`,
 * porque una CSP estricta reporta ese intento aunque el throw se trague.
 * Ver tools/config/zod-wrapper.test.ts para el porqué completo.
 */

import { z } from "./zod";

describe("src/lib/zod", () => {
  it("parsea con normalidad: jitless no cambia los resultados", () => {
    const esquema = z.object({ a: z.string(), n: z.number().int() });

    expect(esquema.parse({ a: "x", n: 2 })).toEqual({ a: "x", n: 2 });
    expect(esquema.safeParse({ a: "x", n: 2.5 }).success).toBe(false);
    expect(esquema.safeParse({ a: 1, n: 2 }).success).toBe(false);
  });

  it("no invoca `new Function` al construir ni al parsear un esquema de objeto", () => {
    const original = globalThis.Function;
    let construcciones = 0;
    globalThis.Function = new Proxy(original, {
      construct(target, args, newTarget) {
        construcciones += 1;
        return Reflect.construct(target, args, newTarget);
      },
    });

    try {
      const esquema = z.object({ a: z.string() });
      esquema.parse({ a: "x" });
    } finally {
      globalThis.Function = original;
    }

    expect(construcciones).toBe(0);
  });
});
