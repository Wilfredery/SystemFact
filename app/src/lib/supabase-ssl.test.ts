import { supabaseDatabaseSsl } from "./supabase-ssl";

describe("supabaseDatabaseSsl", () => {
  it("pins the Supabase CA with full verification for pooler DSNs", () => {
    const ssl = supabaseDatabaseSsl(
      "postgresql://systemfact_app.abc123:secret@aws-1-us-east-2.pooler.supabase.com:6543/postgres",
    );
    expect(ssl).toBeDefined();
    expect(typeof ssl).toBe("object");
    const cfg = ssl as { ca: string; rejectUnauthorized: boolean; minVersion: string };
    expect(cfg.rejectUnauthorized).toBe(true);
    expect(cfg.minVersion).toBe("TLSv1.2");
    expect(cfg.ca).toContain("-----BEGIN CERTIFICATE-----");
    expect(cfg.ca).toContain("-----END CERTIFICATE-----");
  });

  it("leaves non-Supabase DSNs untouched (local dev / CI service)", () => {
    expect(supabaseDatabaseSsl("postgresql://systemfact_app:pw@localhost:5433/postgres")).toBeUndefined();
    expect(supabaseDatabaseSsl("postgresql://postgres:devpass@127.0.0.1:5433/postgres")).toBeUndefined();
  });

  it("returns undefined for a malformed DSN instead of throwing", () => {
    expect(supabaseDatabaseSsl("not-a-url")).toBeUndefined();
    expect(supabaseDatabaseSsl("")).toBeUndefined();
  });
});
