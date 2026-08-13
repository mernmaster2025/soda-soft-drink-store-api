# Testing Guide

This repository uses Node's built-in test runner (`node --test`). No test
framework is installed — `describe`/`it` come from `node:test` and assertions
from `node:assert/strict`.

## Run the suite

```bash
npm test
```

A healthy run reports **11 passing, 0 failing, 0 skipped**:

```
# tests 11
# pass 11
# fail 0
# skipped 0
```

> ⚠️ Check the `skipped` count, not just `fail`. The integration tests skip
> themselves when they cannot reach PostgreSQL, so a run showing
> `pass 9 / skipped 2` is **green but not actually testing the purchase flow**.
> See [Troubleshooting](#troubleshooting).

## Requirements

- PostgreSQL running locally, and a role that is allowed to `CREATE DATABASE`.
  The DB-backed tests create and drop their own throwaway databases.
- A configured `.env` (see [Configuration](#configuration)).

`test/http.test.js` and `test/service.test.js` need neither — they use mocks.

## Configuration

`npm test` runs `node --require dotenv/config --test`, which loads `.env`
before any test file is evaluated. Two consequences worth knowing:

- **Real environment variables win over `.env`.** `dotenv` never overwrites a
  variable that is already set, so CI's explicit `DB_USER`/`DB_PASSWORD` take
  precedence over any `.env` that happens to exist.
- **`node --test` on its own will not load `.env`.** Use `npm test`, or pass
  `--require dotenv/config` yourself.

The test files read these variables directly:

| Variable      | Fallback      | Default      |
| ------------- | ------------- | ------------ |
| `DB_USER`     | `PGUSER`      | `postgres`   |
| `DB_HOST`     | `PGHOST`      | `localhost`  |
| `DB_PASSWORD` | `PGPASSWORD`  | `postgres`   |
| `DB_PORT`     | `PGPORT`      | `5432`       |
| `DB_NAME`     | `PGDATABASE`  | see below    |
| `JWT_SECRET`  | —             | test-only fallback |

> ⚠️ **`DATABASE_URL` is not honored by the tests.** `config.js` treats it as
> taking precedence over the individual `DB_*` variables, but the test files
> resolve their own connection settings and only read `DB_*` / `PG*`. If you
> configure the app with `DATABASE_URL` alone, the tests will fall back to the
> defaults above and connect somewhere else. Set the `DB_*` variables too.

### `DB_USER` on macOS

Homebrew and Postgres.app **do not create a role named `postgres`**. They create
one named after your macOS username. If you leave `DB_USER` unset, the tests
fall back to `postgres`, and every DB-backed test fails with
`role "postgres" does not exist`. Set it explicitly:

```bash
DB_USER=$(whoami)     # in your .env
```

### `DB_NAME`

`DB_NAME` does **not** need to point at an existing database for the tests to
run. Every test creates its own temporary database and connects to the built-in
`postgres` maintenance database to do so. `DB_NAME` only supplies the name
*prefix* used by `test/integration.test.js`.

## What is covered

| File | Needs PostgreSQL | Covers |
| ---- | ---------------- | ------ |
| `test/database.test.js` | yes | Runs `setupDatabase.js` against a fresh database and asserts the expected tables exist; verifies every `CHECK` constraint rejects invalid values. |
| `test/integration.test.js` | yes | Full `register → add-to-cart → checkout` flow over HTTP against a real database; admin-only enforcement on product mutations. |
| `test/seed.test.js` | yes | Runs `setupDatabase.js` then `seed.js` and asserts 15 products plus the demo user land correctly, including `--reset`. |
| `test/http.test.js` | no | Boots the Express middleware layer; checks `/health` and the 404 handler. |
| `test/service.test.js` | no | Exercises the auth, cart, order, and user services against an in-memory mocked data layer. |

## Temporary databases

The three DB-backed files each provision a throwaway database and drop it in a
`finally` block, so a failing test still cleans up after itself. Names are
uniquified with a timestamp, the process id, and a per-file counter:

```
soda_soft_drink_store_test_<ts>_<pid>_<n>          # database.test.js
soda_soft_drink_store_seed_test_<ts>_<pid>_<n>     # seed.test.js
<DB_NAME>_integration_test_<ts>_<pid>_<n>          # integration.test.js
```

Nothing should survive a run. To confirm:

```bash
psql -lqt | cut -d\| -f1 | grep -i test
```

If that prints anything after `npm test` finishes, a database leaked — please
open an issue, and clean up with:

```bash
for db in $(psql -lqt | cut -d\| -f1 | grep -E '_test_[0-9]+_[0-9]+_[0-9]+'); do
  psql -d postgres -c "DROP DATABASE IF EXISTS \"$db\""
done
```

`DROP DATABASE` cannot run inside a transaction block, so drop one per `psql -c`
invocation as above rather than passing several statements at once.

## Troubleshooting

| Symptom | Cause |
| ------- | ----- |
| `role "postgres" does not exist` | `DB_USER` is unset and the fallback is wrong for your install. See [`DB_USER` on macOS](#db_user-on-macos). |
| `PostgreSQL is not reachable — skipping integration tests` | The integration tests could not connect. This covers a stopped server **and** bad credentials — the two look identical. Confirm with `psql -c 'select 1'` using the same `DB_USER`/`DB_PORT`. |
| `password authentication failed` | `DB_PASSWORD` is unset or wrong. Postgres.app uses trust auth locally, so no password is needed; Homebrew and Linux installs usually require one. |
| `permission denied to create database` | Your role lacks `CREATEDB`. Grant it: `ALTER ROLE <user> CREATEDB;` |
| `database "..." already exists` | A previous run leaked a database. See [Temporary databases](#temporary-databases). |

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm ci`,
`npm run lint`, then `npm test` on every pull request against `main`, using a
`postgres:16` service container. It sets `DB_USER`, `DB_PASSWORD`, `DB_HOST`,
`DB_PORT`, `DB_NAME` and `JWT_SECRET` explicitly in the step environment, so CI
never depends on a `.env` file — `.env` is gitignored and absent from a fresh
checkout.

Because CI pins `DB_USER=postgres` to match its container, a credentials
problem that breaks the suite on a developer machine will **not** show up in
CI. Run the suite locally before relying on a green check.
