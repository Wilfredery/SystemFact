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
    // MUST precede "^@/(.*)$" — Jest picks the FIRST matching key.
    "^@/generated/prisma/client$": "<rootDir>/src/test-support/prisma-client-stub.ts",
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
    // MUST come before the ts-jest pattern below: the generated Prisma client
    // is ESM-flavored source (`import.meta.url`) that ts-jest's CommonJS
    // output cannot execute. Same babel transform the integration config
    // (jest.integration.config.js) already established for db-free unit tests
    // that import the client (e.g. the cobros idempotency matcher test).
    "src[\\\\/]generated[\\\\/]prisma[\\\\/].*\\.ts$": [
      require.resolve("babel-jest"),
      {
        presets: [require.resolve("@babel/preset-typescript")],
        plugins: [
          require.resolve("@babel/plugin-transform-modules-commonjs"),
          require.resolve("@babel/plugin-transform-export-namespace-from"),
          {
            visitor: {
              MetaProperty(path) {
                const isUrlMember =
                  path.parent.type === "MemberExpression" &&
                  path.parent.property?.name === "url";
                if (isUrlMember) {
                  path.parentPath.replaceWithSourceString(
                    `require("node:url").pathToFileURL(__filename).href`,
                  );
                } else {
                  path.replaceWithSourceString(
                    `{ url: require("node:url").pathToFileURL(__filename).href }`,
                  );
                }
              },
            },
          },
        ],
      },
    ],
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
