/**
 * The only module that imports zod at runtime (docs/22 T1 stage 2,
 * odd/tasks/csp-nonce.md; pinned by tools/config/zod-wrapper.test.ts).
 *
 * Zod 4 probes `new Function("")` in a try/catch to decide whether it may JIT
 * its object schemas. The throw is swallowed, but a strict CSP (no
 * `'unsafe-eval'`, S2) REPORTS the attempt as a `securitypolicyviolation`.
 * `jitless` makes zod skip the probe and only turns off its speed shortcut:
 * validation results are identical. It must be set before the first object
 * schema is built, so every module imports zod from here, never from "zod".
 */

import { z } from "zod";

z.config({ jitless: true });

export * from "zod";
export { z };
