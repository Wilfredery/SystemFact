import { rule as serverActionMustWrapTenant } from "./rules/server-action-must-wrap-tenant.ts";

const plugin = {
  meta: {
    name: "eslint-plugin-systemfact",
    version: "0.1.0",
  },
  rules: {
    "server-action-must-wrap-tenant": serverActionMustWrapTenant,
  },
};

// Flat-config preset. Attached after creation because the config references the
// plugin object itself; a self-reference inside the same object literal would
// be a circular initializer (TS7022/TS2448).
const recommended = {
  name: "systemfact/recommended",
  plugins: { systemfact: plugin },
  rules: {
    "systemfact/server-action-must-wrap-tenant": "error",
  },
};

const systemfact = {
  ...plugin,
  configs: { recommended },
};

export default systemfact;
