/**
 * Shared E2E env guard: a missing variable FAILS the test with a pointer to the
 * provisioning script. Never skip (assert-no-skips.mjs would fail the job anyway,
 * and a skip reads as coverage it does not have).
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set: provision the E2E stack with .github/ci/provision-local-e2e.sh and load its env file.`,
    );
  }
  return value;
}
