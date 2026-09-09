/**
 * Jest config — REAL-DB integration tests (database `systemfact_test`).
 *
 * Differences from the unit-test config (jest.config.js):
 * - globalSetup loads `app/.env.integration` via dotenv BEFORE any test module
 *   can evaluate `src/lib/env.ts` (which validates DATABASE_URL at import time).
 * - setupFilesAfterEnv connects a superuser harness client and truncates tables.
 * - The generated Prisma client (src/generated/prisma) is ESM-flavored source:
 *   it uses `import.meta.url`, which ts-jest's CommonJS output cannot execute.
 *   Those files are therefore transformed with babel-jest (preset-typescript +
 *   plugin-transform-modules-commonjs + a tiny inline plugin that rewrites
 *   `import.meta.url` to `require("node:url").pathToFileURL(__filename).href`).
 *   Test files still go through ts-jest with the same strict tsconfig overrides.
 * - runInBand is MANDATORY: every suite shares one physical database.
 */
const config = {
  testEnvironment: "node",
  rootDir: ".",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  globalSetup: "<rootDir>/src/integration/setup/global-setup.ts",
  setupFilesAfterEnv: ["<rootDir>/src/integration/setup/setup-env.ts"],
  testMatch: ["<rootDir>/src/integration/**/*.test.ts"],
  transform: {
    // MUST come before the ts-jest pattern below — Jest uses the FIRST
    // matching transform, and the generated Prisma client (ESM-flavored
    // source with `import.meta`) cannot run through ts-jest's CJS output.
    "src[\\\\/]generated[\\\\/]prisma[\\\\/].*\\.ts$": [
      require.resolve("babel-jest"),
      {
        presets: [require.resolve("@babel/preset-typescript")],
        plugins: [
          require.resolve("@babel/plugin-transform-modules-commonjs"),
          // The generated client re-exports namespaces (`export * as ...`).
          require.resolve("@babel/plugin-transform-export-namespace-from"),
          // Rewrites `import.meta.url` (unsupported in CJS output) to an
          // equivalent file URL. Only used on the generated client files.
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
    // Test + production sources: ts-jest with the same strict overrides as the
    // unit config. The pattern excludes the generated Prisma client so the two
    // transform rules never overlap (Jest pattern precedence is subtle).
    "^(?!.*src[\\\\/]generated[\\\\/]prisma).*\\.ts$": [
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
        // import.meta in the generated client would fail TS diagnostics here;
        // that file is babel-transformed instead (see pattern above).
        diagnostics: { exclude: ["src/generated/**"] },
      },
    ],
  },
  runInBand: true,
  testTimeout: 30_000,
  clearMocks: true,
};

module.exports = config;

