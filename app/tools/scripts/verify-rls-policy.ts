/**
 * Environment and connection policy for the RLS smoke test.
 * NODE_ENV is the existing application convention; only its exact
 * production value makes pooling a hard requirement.
 */
export function isProductionEnvironment(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production";
}

export function isTransactionModePooling(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl);
    return url.port === "6543" || url.searchParams.get("pgbouncer") === "true";
  } catch {
    return false;
  }
}
