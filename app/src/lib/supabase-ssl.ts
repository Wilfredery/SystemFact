/**
 * TLS trust pinning for Supabase database connections (backlog item 2:
 * harden `sslmode=require` -> verified TLS).
 *
 * Why a pinned CA: the Supabase Postgres pooler serves a certificate chain
 * rooted at the self-managed "Supabase Root 2021 CA", which is NOT in the
 * public Node trust store (verified empirically against prod 2026-10-10:
 * `SELF_SIGNED_CERT_IN_CHAIN` when verifying `*.pooler.supabase.com`).
 * `sslmode=require` through pg-connection-string therefore maps to
 * `rejectUnauthorized: false` — encrypted but UNVERIFIED TLS.
 *
 * This module embeds the official `prod-ca-2021.crt` and exposes one helper
 * that returns an explicit `ssl` config for `pg.Pool` (what
 * `@prisma/adapter-pg` forwards to `new pg.Pool(config)`). The object pins the
 * CA and enables full verification; pg itself adds `servername = <host>` on
 * the TLS upgrade, so the result is verify-full semantics (CA chain + hostname).
 *
 * IMPORTANT (pg 8.23 `connection-parameters.js`): a `connectionString`
 * containing `sslmode` OVERRIDES any `ssl` object passed alongside it
 * (`parse(connectionString)` is merged last). Callers must use this helper
 * ONLY with DSNs that do NOT carry `sslmode`/`uselibpqcompat` params — the
 * production env values were scrubbed accordingly.
 */
import type { PoolConfig } from "pg";

/**
 * Official Supabase Root 2021 CA (valid 2021-04-28 → 2031-04-26). Downloaded
 * from https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
 * and pinned by SHA-256 so a changed remote can never swap silently.
 */
const SUPABASE_ROOT_2021_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;

/** SHA-256 of the DER-encoded certificate; update together with the PEM. */
export const SUPABASE_ROOT_2021_CA_SHA256 =
  "807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA";

/** Supabase host suffixes whose TLS endpoint chains to the pinned root CA. */
const SUPABASE_DB_HOST_SUFFIXES = [
  ".pooler.supabase.com",
  ".supabase.com",
  ".supabase.co",
] as const;

function isSupabaseDatabaseHost(connectionString: string): boolean {
  try {
    const { hostname } = new URL(connectionString);
    return SUPABASE_DB_HOST_SUFFIXES.some((suffix) =>
      hostname.endsWith(suffix),
    );
  } catch {
    return false;
  }
}

/**
 * Explicit `ssl` config for a Supabase DB connection: pinned CA + full
 * verification (pg upgrades the socket with `servername = <host>`, so the
 * hostname is validated too). Returns `undefined` for any non-Supabase DSN
 * (local Postgres, CI service) so local/CI behavior is untouched.
 */
export function supabaseDatabaseSsl(
  connectionString: string,
): PoolConfig["ssl"] {
  if (!isSupabaseDatabaseHost(connectionString)) {
    return undefined;
  }
  return {
    ca: SUPABASE_ROOT_2021_CA_PEM,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  };
}
