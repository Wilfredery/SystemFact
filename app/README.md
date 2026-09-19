This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Code quality & coverage scan (Sonar)

The Sonar lab computes coverage from **two** LCOV reports merged together —
unit tests and real-database integration tests. Each report path is listed in
`sonar.javascript.lcov.reportPaths` (comma-separated). This keeps coverage
honest: code that is only exercised end-to-end against Postgres (sale
confirmation, NCF consumption, inventory movement, RLS) is credited, not just
what the unit suite reaches.

Generate the two reports first (unit output defaults to `coverage/`, the
integration helper writes `coverage-integration/`):

```bash
# Unit coverage (lcov) -> coverage/lcov.info
pnpm exec jest --coverage --coverageReporters=lcov --coverageDirectory=coverage

# Integration coverage (lcov) -> coverage-integration/lcov.info
# Requires sf-postgres up; DATABASE_URL / test-DB env come from app/.env.integration
# (loaded by the integration globalSetup) and are NEVER committed.
pnpm coverage:integration
```

Then scan, passing both report paths:

```bash
sonar-scanner \
  -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info,coverage-integration/lcov.info
```

Both report directories are git-ignored; only the commands and the scan
configuration are tracked. Secrets are supplied by the environment, never by
the committed files.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
