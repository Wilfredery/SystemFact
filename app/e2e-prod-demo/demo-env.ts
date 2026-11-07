/**
 * Environment contract and empresa guard of the production DEMO lane
 * (odd/tasks/prod-demo-lane.md S4/S5).
 *
 * Pure TypeScript on purpose (no Playwright import): the decision "is this
 * session inside the demo company?" is unit-tested without a browser in
 * `tools/config/prod-demo-guard.test.ts`.
 *
 * Messages name VARIABLES, never values: this lane logs into live production
 * and the repository is public, so a credential (or a real company's name) must
 * never reach a log line.
 */

export type DemoEnv = {
  user: string;
  password: string;
  /** The empresa name the UI must show before any write (`DEMO_EMPRESA_NAME`). */
  empresaName: string;
};

const REQUIRED = ["DEMO_USER", "DEMO_PASSWORD", "DEMO_EMPRESA_NAME"] as const;

/** Throws (so the lane FAILS, never skips) when any required variable is missing or blank. */
export function leerEntornoDemo(env: Record<string, string | undefined>): DemoEnv {
  const missing = REQUIRED.filter((name) => (env[name] ?? "").trim() === "");
  if (missing.length > 0) {
    throw new Error(
      `The production demo lane requires ${missing.join(", ")}. ` +
        "Without the demo identity and the expected empresa name it cannot prove it is writing " +
        "only into the demo company, so it FAILS instead of skipping.",
    );
  }
  return {
    user: env.DEMO_USER as string,
    password: env.DEMO_PASSWORD as string,
    empresaName: (env.DEMO_EMPRESA_NAME as string).trim(),
  };
}

const SEPARADOR_SUCURSAL = " · Sucursal ";

function normalizar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/**
 * True when the app-shell header (`<empresa> · Sucursal <sucursal>`, rendered on
 * every `(app)` page) names exactly the expected empresa.
 */
export function cabeceraPerteneceAEmpresa(cabecera: string, esperada: string): boolean {
  const nombre = normalizar(esperada);
  if (nombre === "") return false;
  return normalizar(cabecera).startsWith(`${nombre}${SEPARADOR_SUCURSAL}`);
}
