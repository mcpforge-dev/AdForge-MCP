# V2 CI foundation

.github/workflows/v2-foundation.yml runs on v2 branches and pull requests:

1. frozen pnpm install;
2. ESLint;
3. strict TypeScript typecheck;
4. unit tests;
5. production builds;
6. Prisma schema validation;
7. tracked-file secret scan;
8. high-severity dependency audit.

The workflow does not deploy and has read-only repository permissions.
