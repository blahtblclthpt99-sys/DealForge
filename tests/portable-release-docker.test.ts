import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("portable Docker image uses a Node version supported by DealForge", async () => {
  const source = await readFile("Dockerfile", "utf8");
  assert.doesNotMatch(source, /FROM node:20(?:-|\s)/);
  assert.equal((source.match(/FROM node:24-alpine/g) || []).length, 3);
});

test("Docker dependency stage provides Prisma postinstall inputs before npm ci", async () => {
  const source = await readFile("Dockerfile", "utf8");
  const generatorCopy = source.indexOf("COPY scripts/prisma-generate.mjs");
  const schemaCopy = source.indexOf("COPY prisma/schema.prisma prisma/schema.postgres.prisma ./prisma/");
  const npmCi = source.indexOf("RUN npm ci");

  assert.ok(generatorCopy >= 0, "Prisma generator script must be copied into the deps stage");
  assert.ok(schemaCopy >= 0, "Prisma schemas must be copied into the deps stage");
  assert.ok(npmCi >= 0, "npm ci step must exist");
  assert.ok(generatorCopy < npmCi, "Prisma generator script must exist before postinstall runs");
  assert.ok(schemaCopy < npmCi, "Prisma schemas must exist before postinstall runs");
});

test("portable production image generates the PostgreSQL Prisma client", async () => {
  const source = await readFile("Dockerfile", "utf8");
  assert.ok((source.match(/ENV PRISMA_DATABASE_PROVIDER=postgresql/g) || []).length >= 2);
  assert.match(source, /RUN npm run build/);
});

test("portable release validates Docker builds on relevant pull requests without publishing them", async () => {
  const source = await readFile(".github/workflows/portable-release.yml", "utf8");
  assert.match(source, /pull_request:/);
  assert.match(source, /- 'Dockerfile'/);
  assert.match(source, /if: github\.event_name != 'pull_request'/);
  assert.match(source, /push: \$\{\{ github\.event_name != 'pull_request' \}\}/);
});
