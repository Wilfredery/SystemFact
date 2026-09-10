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
  testMatch: [
    "<rootDir>/src/**/*.test.ts",
    "<rootDir>/src/**/*.spec.ts",
    "<rootDir>/src/**/*.test.tsx",
    "<rootDir>/src/**/*.spec.tsx",
    "<rootDir>/tools/**/*.test.ts",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/.next/",
    "/src/generated/",
    "<rootDir>/scripts/",
    "/withTenantTransaction\\.test\\.ts$",
    "/src/integration/",
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
    // Component tests (fase 5b PR-3): the same ts-jest options plus the
    // automatic JSX runtime, so `*.spec.tsx` files render with React Testing
    // Library. The test files themselves opt into `jest-environment-jsdom`
    // via their `@jest-environment` docblock — the global environment stays
    // `node` (unit/integration convention).
    "^.+\\.tsx$": [
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
          jsx: "react-jsx",
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
