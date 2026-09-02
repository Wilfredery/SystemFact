/**
 * Jest config — SystemFact.
 *
 * - ts-jest preset for native TypeScript test files.
 * - moduleNameMapper mirrors the Next.js `@/*` path alias from tsconfig.json
 *   so test files can import application modules with the same paths the
 *   production code uses.
 * - testEnvironment is `node` (helpers are server-side; no DOM needed).
 * - Path patterns intentionally exclude `.next/`, generated Prisma client, and
 *   the scripts/ probe directory (probes are run via `tsx`, not Jest).
 */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.spec.ts"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/.next/",
    "/src/generated/",
    "/scripts/",
  ],
  // Surface tsconfig's strict settings so tests catch the same type errors
  // as the production build.
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          target: "es2022",
          module: "commonjs",
          moduleResolution: "node",
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
          types: ["jest", "node"],
        },
      },
    ],
  },
  setupFilesAfterEnv: [],
  clearMocks: true,
};

module.exports = config;
