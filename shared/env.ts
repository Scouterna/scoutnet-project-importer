export type ScoutnetEnv = "production" | "test";

export const scoutnetEnvs: readonly ScoutnetEnv[] = ["production", "test"];

export const apiBaseUrls: Record<ScoutnetEnv, string> = {
  production: "https://scoutnet.se/api",
  test: "https://s1.test.custard.no/api",
};

export const siteOrigins: Record<ScoutnetEnv, string> = {
  production: "https://scoutnet.se",
  test: "https://s1.test.custard.no",
};

export const isScoutnetEnv = (value: unknown): value is ScoutnetEnv =>
  value === "production" || value === "test";

// Hostnames of the Scoutnet sites, derived from siteOrigins, plus the www alias.
export const hostEnvs: ReadonlyMap<string, ScoutnetEnv> = new Map([
  ...scoutnetEnvs.map((env) => [new URL(siteOrigins[env]).hostname, env] as const),
  ["www.scoutnet.se", "production" as const],
]);
