# 🥤 Soda Soft Drink Store — E-Commerce REST API

A Codecademy portfolio-project REST API for a soda soft-drink store, built with
**Node.js, Express, PostgreSQL (Sequelize ORM), Passport (JWT)** and documented
with **Swagger UI** and **Scalar**.

## Features

- 🔐 **Auth** — register / login with hashed passwords and JWTs
- 🥫 **Products** — list, search and filter soda drinks; single-drink details
- 🛒 **Cart** — add / update / remove items, view totals
- 📦 **Orders** — transactional checkout with stock reservation & order history
- 👤 **Users** — view and update your profile
- 🧩 **Sequelize ORM** — models, associations, validations & transactions (no raw SQL)
- 📖 **Two docs UIs** — Swagger UI at `/api-docs`, Scalar reference at `/reference`

## Project structure

```
soda-soft-drink-store-api/
├── db/            # Sequelize connection + model registry & associations
├── loaders/       # Express, Passport & docs (Swagger UI + Scalar) setup
├── middleware/    # Route guards (e.g. requireAdmin)
├── migrations/    # Numbered schema migrations — the schema source of truth
├── models/        # Sequelize model definitions (one per table)
├── resources/     # ERD diagram & shared assets
├── routes/        # HTTP endpoints → services
├── services/      # Business logic (uses the ORM models)
├── test/          # Node test-runner suites (see TESTING.md)
├── config.js      # Env-driven settings
├── index.js       # App entry point
├── seed.js        # Inserts fixed product fixtures + a demo user
├── setupDatabase.js  # Creates the database and runs the migrations
└── swagger.yml    # OpenAPI spec (shared by both docs UIs)
```

Request flow: **routes → services → models (Sequelize) → db**.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [PostgreSQL](https://www.postgresql.org/) 13+ (running locally)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp example.env .env        # (Windows: copy example.env .env)
# then edit .env with your PostgreSQL credentials + a JWT secret
#   On macOS (Homebrew / Postgres.app) DB_USER is your OS username,
#   NOT "postgres" — run `whoami`.

# 3. Create the database and run the migrations
npm run setup-db
#   Creates DB_NAME if it does not exist — no manual CREATE DATABASE needed.
#   Reset everything:   node setupDatabase.js --force

# 4. Seed the database with 15 fixed soda products and a demo user
npm run seed
#   Re-load fixtures from scratch:  node seed.js --reset

# 5. Start the API
npm start          # or: npm run dev  (auto-reload with nodemon)
```

> **Seed notes**
> - Running `npm run seed` more than once is safe: it skips products when
>   the table is already populated and uses `ON CONFLICT DO NOTHING` for the
>   demo user.
> - Pass `--reset` (`node seed.js --reset`) to truncate the products table and
>   reload all fixtures from scratch (cascades to `cart_items` and
>   `order_items`).
> - Demo credentials: **email** `demo@sodastore.example` / **password** `DemoPass123!`

## Testing

The project uses Node's built-in test runner. Run the suite with:

```bash
npm test
```

A healthy run reports **11 passing, 0 failing, 0 skipped**. Coverage includes:

- Schema setup and every `CHECK` constraint, against a real database
- The full `register → add-to-cart → checkout` flow over HTTP
- The seed script (15 products + demo user, including `--reset`)
- An Express smoke test for `/health` and the 404 handler
- Auth, cart, order and user services against a mocked data layer

The database-backed tests create and drop their own throwaway databases, so a
local PostgreSQL server and a role with `CREATEDB` are required. Watch the
**skipped** count as well as the failures — the integration tests skip
themselves when they cannot reach PostgreSQL, so `pass 9 / skipped 2` is green
without having tested the purchase flow.

See [TESTING.md](TESTING.md) for configuration, cleanup and troubleshooting.

## Linting and formatting

ESLint (flat config, `eslint.config.js`) and Prettier run in CI on every pull
request:

```bash
npm run lint            # ESLint
npm run format-check    # Prettier, check only
npm run format          # Prettier, rewrite in place
```

The server prints its URL on boot (default <http://localhost:4001>).
Interactive docs:

- **Scalar** (recommended): <http://localhost:4001/reference>
- **Swagger UI**: <http://localhost:4001/api-docs>

> ℹ️ Scalar loads its render bundle from a CDN, so `/reference` needs internet
> access at runtime. Swagger UI is fully self-hosted and works offline.

## Environment variables

See [`example.env`](example.env). Key ones:

| Variable         | Purpose                                       | Default                 |
| ---------------- | --------------------------------------------- | ----------------------- |
| `PORT`           | HTTP port                                     | `4001`                  |
| `DATABASE_URL`   | Full connection string; wins over `DB_*`      | _unset_                 |
| `DB_USER`        | PostgreSQL role (`PGUSER` also accepted)      | `postgres`              |
| `DB_HOST`        | PostgreSQL host (`PGHOST`)                    | `localhost`             |
| `DB_NAME`        | Application database (`PGDATABASE`)           | `soda_store`            |
| `DB_PASSWORD`    | PostgreSQL password (`PGPASSWORD`)            | `postgres`              |
| `DB_PORT`        | PostgreSQL port (`PGPORT`)                    | `5432`                  |
| `JWT_SECRET`     | Secret used to sign tokens                    | _change me_             |
| `JWT_EXPIRES_IN` | Token lifetime                                | `1d`                    |
| `CORS_ORIGIN`    | Allowed frontend origin(s), comma-separated   | `http://localhost:3000` |

> ⚠️ `DATABASE_URL` takes precedence over the individual `DB_*` variables for
> the application, but the **test suite reads `DB_*` / `PG*` only**. If you
> configure with `DATABASE_URL`, set the `DB_*` variables to match or `npm test`
> will connect elsewhere. See [TESTING.md](TESTING.md).

## API quick reference

All routes are prefixed with `/api`. 🔒 = requires `Authorization: Bearer <token>`.

| Method | Endpoint                     | Description                     |
| ------ | ---------------------------- | ------------------------------- |
| POST   | `/auth/register`             | Create account, get token       |
| POST   | `/auth/login`                | Log in, get token               |
| GET    | `/products`                  | List / search sodas             |
| GET    | `/products/:id`              | Single drink details            |
| POST   | `/products` 🔒               | Create product (admin only)     |
| PUT    | `/products/:id` 🔒           | Update product (admin only)     |
| DELETE | `/products/:id` 🔒           | Delete product (admin only)     |
| GET    | `/cart` 🔒                   | View cart                       |
| POST   | `/cart/items` 🔒             | Add item to cart                |
| PUT    | `/cart/items/:productId` 🔒  | Set quantity (0 removes)        |
| DELETE | `/cart/items/:productId` 🔒  | Remove item                     |
| DELETE | `/cart` 🔒                   | Empty cart                      |
| POST   | `/orders` 🔒                 | Checkout (cart → order)         |
| GET    | `/orders` 🔒                 | Order history                   |
| GET    | `/orders/:id` 🔒             | Single order + items            |
| GET    | `/users/me` 🔒               | Your profile                    |
| PUT    | `/users/me` 🔒               | Update profile                  |

Auth routes are rate-limited. If the limit is exceeded, the API returns:

```json
{
  "error": "Too many authentication attempts, please try again later.",
  "code": "AUTH_RATE_LIMITED"
}
```

with HTTP status `429 Too Many Requests`.

### Example: register → browse → add to cart → checkout

```bash
# Register (returns { user, token })
curl -X POST http://localhost:4001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Renee","email":"renee@example.com","password":"hunter2"}'

TOKEN=... # copy the token from the response

# Browse sodas
curl http://localhost:4001/api/products

# Add product #1 to cart
curl -X POST http://localhost:4001/api/cart/items \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"productId":1,"quantity":2}'

# Checkout
curl -X POST http://localhost:4001/api/orders \
  -H "Authorization: Bearer $TOKEN"
```

## Team & roles

| Role                | Owner         | Area                                        |
| ------------------- | ------------- | ------------------------------------------- |
| Team Lead           | Hector & Eraj | Review / merge, timeline                    |
| Database Engineer   | Renee         | `db/`, `setupDatabase.js`, `models/`, ERD   |
| Back-End Developer  | Kyle          | `loaders/`, `routes/`, `services/`, swagger |
| Front-End Developer | Dubem         | Frontend app (separate repo) → this API     |
| Docs + GitHub Lead  | Goodness      | `.gitignore`, `README.md`, guides           |

## License

MIT
