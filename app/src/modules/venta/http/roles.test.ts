/**
 * Role-matrix test for the POS board 02 decision (odd/tasks/uiux-alignment.md
 * S1): the wireframe is the source of truth for roles — the owner ratified
 * "Follow the rules and roles from the wireframe". The POS screen's header and
 * Etiqueta-Acción card show a Despachador using 02-Venta-Contado, so
 * ROLES_VENTA must grant Administrador, Operador AND Despachador, while the
 * adjacent gates keep their wireframe-denied exclusions: Despachador stays out
 * of Cobros (R-C6) and out of refunds (Administrador only, §10).
 */

// Mock the runtime chain (supabase client + tenant runtime) the same way
// actions.test.ts does: the constants under test are plain exports; the
// imports only pull the env/Prisma singleton the unit layer must not create.
jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));
jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));

import { ROLES_VENTA } from "./shared";
import { ROLES_COBROS, ROLES_REEMBOLSO } from "@/modules/cobros/http/shared";

describe("ROLES_VENTA — wireframe board 02 role matrix (S1)", () => {
  it("grants Administrador, Operador and Despachador the POS screen", () => {
    expect([...ROLES_VENTA].sort()).toEqual(
      ["Administrador", "Despachador", "Operador"],
    );
  });

  it("grants Cobrador Cobros per wireframe board 03 (S9) and keeps Despachador out", () => {
    // Board 03's header shows 'Juan · Cobrador' collecting; the owner ratified
    // wireframe-wins. R-C6 (Despachador denied) is unchanged.
    expect([...ROLES_COBROS].sort()).toEqual([
      "Administrador",
      "Cobrador",
      "Operador",
    ]);
    expect([...ROLES_REEMBOLSO].sort()).toEqual(["Administrador"]);
  });
});
