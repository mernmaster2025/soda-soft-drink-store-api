'use strict';

/**
 * End-to-end integration tests for the purchase flow.
 *
 * These tests drive the full register → add-to-cart → checkout path over
 * HTTP against a real, temporary PostgreSQL database that is created before
 * the suite runs and dropped afterwards.  They are skipped automatically when
 * PostgreSQL is not reachable so that the suite can still pass in environments
 * without a database (e.g. a developer laptop running only unit tests).
 *
 * Environment variables used (fall back to the same defaults as config.js):
 *   DB_USER / PGUSER, DB_HOST / PGHOST, DB_PASSWORD / PGPASSWORD,
 *   DB_PORT / PGPORT, JWT_SECRET
 *
 * The test database name is derived from DB_NAME / PGDATABASE with a
 * "_integration_test" suffix plus a per-process uniquifier so it never
 * collides with the application database.
 */

// Provide a stable JWT secret for the test run if none is set.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'integration_test_secret_do_not_use_in_production';
}
process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { Pool } = require('pg');

const repoRoot = path.resolve(__dirname, '..');
const setupScript = path.join(repoRoot, 'setupDatabase.js');
const baseName = process.env.DB_NAME || process.env.PGDATABASE || 'soda_store';
const modulePathsToReset = [
  '../config',
  '../db',
  '../routes',
  '../routes/auth',
  '../routes/product',
  '../routes/cart',
  '../routes/order',
  '../routes/user',
  '../loaders',
  '../loaders/express',
  '../loaders/passport',
  '../loaders/swagger',
  '../services/AuthService',
  '../services/ProductService',
  '../services/CartService',
  '../services/OrderService',
  '../services/UserService',
];

function createTestDatabaseName() {
  createTestDatabaseName.counter = (createTestDatabaseName.counter || 0) + 1;
  return `${baseName}_integration_test_${Date.now()}_${process.pid}_${createTestDatabaseName.counter}`;
}

/** Connection options for the PostgreSQL admin user (connects to `postgres`). */
const pgAdmin = {
  user: process.env.DB_USER || process.env.PGUSER || 'postgres',
  host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'postgres',
  port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
};

/** Returns true when a PostgreSQL server is reachable, false otherwise. */
async function pgAvailable() {
  const pool = new Pool({ ...pgAdmin, database: 'postgres' });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

/** Create the isolated test database. */
async function createTestDb(databaseName) {
  const pool = new Pool({ ...pgAdmin, database: 'postgres' });
  try {
    await pool.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await pool.end();
  }
}

/**
 * Drop the isolated test database, terminating any lingering connections
 * first so that the DROP succeeds even if a connection is still open.
 */
async function dropTestDb(databaseName) {
  const pool = new Pool({ ...pgAdmin, database: 'postgres' });
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName]
    );
    await pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await pool.end();
  }
}

/**
 * Run setupDatabase.js as a child process so that it sees the test DB name
 * via the environment variables already set on `process.env`.
 */
function runSetupDatabase(databaseName) {
  const result = spawnSync(process.execPath, [setupScript], {
    cwd: repoRoot,
    env: { ...process.env, DB_NAME: databaseName, PGDATABASE: databaseName },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `setupDatabase.js exited with status ${result.status}\n` +
        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
}

function loadFreshApp() {
  for (const modulePath of modulePathsToReset) {
    delete require.cache[require.resolve(modulePath)];
  }

  const express = require('express');
  const loaders = require('../loaders');
  const app = express();

  loaders(app);
  return app;
}

/** Insert one soda product directly and return its id. */
async function seedProduct(pool) {
  const { rows } = await pool.query(
    `INSERT INTO products (name, description, price, stock, flavor, size)
     VALUES ('Classic Cola', 'The original cola taste', 2.50, 10, 'cola', '330ml')
     RETURNING id`
  );
  return rows[0].id;
}

async function promoteUserToAdmin(pool, email) {
  await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [email]);
}

// ─────────────────────────────────────────────────────────────────────────────

test('register → add-to-cart → checkout purchase flow', async (t) => {
  if (!(await pgAvailable())) {
    t.skip('PostgreSQL is not reachable — skipping integration tests');
    return;
  }

  await createTestDb();
  runSetupDatabase();

  // Require app modules only AFTER the database has been created and seeded
  // so that the connection pool in db/index.js can reach the test database.
  const supertest = require('supertest');
  const app = loadFreshApp();

  const testPool = new Pool({ ...pgAdmin, database: TEST_DB });
  const productId = await seedProduct(testPool);

  try {
    // ── 1. Register a new account ────────────────────────────────────────────
    const registerRes = await supertest(app)
      .post('/api/auth/register')
      .send({ email: 'buyer@example.com', name: 'Buyer', password: 'secret123' })
      .expect(201);

    const { token } = registerRes.body;
    assert.ok(token, 'register should return a JWT');
    assert.equal(registerRes.body.user.email, 'buyer@example.com');

    // ── 2. Add the seeded product to the cart ─────────────────────────────────
    const authHeader = 'Bearer ' + token;
    const addRes = await supertest(app)
      .post('/api/cart/items')
      .set('Authorization', authHeader)
      .send({ productId, quantity: 2 })
      .expect(201);

    assert.equal(addRes.body.items.length, 1, 'cart should have one line item');
    assert.equal(addRes.body.items[0].quantity, 2);
    assert.equal(addRes.body.total, 5, 'cart total should be 2 × $2.50 = $5.00');

    // ── 3. Checkout ───────────────────────────────────────────────────────────
    const checkoutRes = await supertest(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .expect(201);

    const order = checkoutRes.body;
    assert.ok(order.id, 'checkout should return an order with an id');
    assert.equal(order.total, 5, 'order total should match the cart total');
    assert.equal(order.status, 'pending');
    assert.equal(order.items.length, 1, 'order should have one line item');
    assert.equal(order.items[0].quantity, 2);

    // ── 4. Cart should be empty after checkout ────────────────────────────────
    const cartRes = await supertest(app)
      .get('/api/cart')
      .set('Authorization', authHeader)
      .expect(200);

    assert.equal(cartRes.body.items.length, 0, 'cart should be empty after checkout');
    assert.equal(cartRes.body.total, 0);

    // ── 5. Order history should list the new order ────────────────────────────
    const listRes = await supertest(app)
      .get('/api/orders')
      .set('Authorization', authHeader)
      .expect(200);

    assert.equal(listRes.body.length, 1, 'order list should contain exactly one order');
    assert.equal(listRes.body[0].id, order.id);

    // ── 6. Individual order endpoint should return full item detail ───────────
    const getRes = await supertest(app)
      .get('/api/orders/' + order.id)
      .set('Authorization', authHeader)
      .expect(200);

    assert.equal(getRes.body.id, order.id);
    assert.equal(getRes.body.items.length, 1);
    assert.equal(getRes.body.items[0].product_id, productId);
  } finally {
    // ── Clean up: close all DB connections then drop the test database ────────
    await testPool.end();

    // Close the pool and Sequelize connection opened by db/index.js.
    const db = require('../db');
    await db.pool.end().catch(() => {});
    await db.sequelize.close().catch(() => {});

    await dropTestDb();
  }
});

test('product mutations require admin access', async (t) => {
  if (!(await pgAvailable())) {
    t.skip('PostgreSQL is not reachable — skipping integration tests');
    return;
  }

  await createTestDb();
  runSetupDatabase();

  const supertest = require('supertest');
  const app = loadFreshApp();

  const testPool = new Pool({ ...pgAdmin, database: TEST_DB });

  try {
    const registration = await supertest(app)
      .post('/api/auth/register')
      .send({ email: 'admin@example.com', name: 'Admin User', password: 'secret123' })
      .expect(201);

    await supertest(app)
      .post('/api/products')
      .set('Authorization', 'Bearer ' + registration.body.token)
      .send({ name: 'Cherry Cola', price: 2.75, stock: 12 })
      .expect(403);

    await promoteUserToAdmin(testPool, 'admin@example.com');

    const login = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'secret123' })
      .expect(200);

    const createRes = await supertest(app)
      .post('/api/products')
      .set('Authorization', 'Bearer ' + login.body.token)
      .send({ name: 'Cherry Cola', price: 2.75, stock: 12 })
      .expect(201);

    assert.equal(createRes.body.name, 'Cherry Cola');
    assert.equal(createRes.body.stock, 12);
  } finally {
    await testPool.end();

    const db = require('../db');
    await db.pool.end().catch(() => {});
    await db.sequelize.close().catch(() => {});

    await dropTestDb();
  }
});
