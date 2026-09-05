import { isProductionEnvironment, isTransactionModePooling } from "./verify-rls-policy";

describe("RLS pooling policy", () => {
  test("requires transaction-mode pooling only in production", () => {
    expect(isProductionEnvironment("production")).toBe(true);
    expect(isProductionEnvironment("development")).toBe(false);
    expect(isProductionEnvironment(undefined)).toBe(false);
  });

  test("recognizes the supported transaction-mode connection forms", () => {
    expect(isTransactionModePooling("postgresql://db.example/postgres?pgbouncer=true")).toBe(true);
    expect(isTransactionModePooling("postgresql://db.example:6543/postgres")).toBe(true);
    expect(isTransactionModePooling("postgresql://localhost:5433/postgres")).toBe(false);
    expect(isTransactionModePooling("not-a-database-url")).toBe(false);
  });
});
