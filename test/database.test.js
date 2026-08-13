'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { Pool } = require('pg');

const repoRoot = path.resolve(__dirname, '..');
const setupScript = path.join(repoRoot, 'setupDatabase.js');

const adminConfig = {
  user: process.env.DB_USER || process.env.PGUSER || 'postgres',
  host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'postgres',
  port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10) || 5432,
};

function createTestDatabaseName() {
  createTestDatabaseName.counter = (createTestDatabaseName.counter || 0) + 1;
  return `soda_soft_drink_store_test_${Date.now()}_${process.pid}_${createTestDatabaseName.counter}`;
}

async function dropDatabase(databaseName) {
  const adminPool = new Pool({
    ...adminConfig,
    database: 'postgres',
  });

  try {
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [databaseName]
    );
    await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await adminPool.end();
  }
}

async function createTestDatabase() {
  const databaseName = createTestDatabaseName();
  const env = { ...process.env, DB_NAME: databaseName };

  const result = spawnSync(process.execPath, [setupScript], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    `setupDatabase.js failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );

  const pool = new Pool({ ...adminConfig, database: databaseName });
  const cleanup = async () => {
    await pool.end();
    await dropDatabase(databaseName);
  };
  return { pool, cleanup };
}

test('setupDatabase.js creates the expected PostgreSQL tables', async () => {
  let pool;
  let cleanup;

  try {
    ({ pool, cleanup } = await createTestDatabase());

    const { rows } = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );

    assert.deepEqual(
      rows.map((row) => row.table_name),
      ['cart_items', 'carts', 'migrations', 'order_items', 'orders', 'products', 'users']
    );

    const { rows: migrationRows } = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'migrations'`
    );
    assert.equal(migrationRows.length, 1);

    const { rows: productColumnRows } = await pool.query(
      `SELECT character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'name'`
    );
    assert.equal(productColumnRows[0].character_maximum_length, 150);
  } finally {
    if (cleanup) {
      await cleanup();
    }
  }
});

test('CHECK constraints reject invalid values', async () => {
  let pool;
  let cleanup;

  try {
    ({ pool, cleanup } = await createTestDatabase());

    // Seed a user row so FK constraints are satisfied for orders.
    const {
      rows: [user],
    } = await pool.query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ('check@example.com', 'Check User', 'hash')
       RETURNING id`
    );

    // products.price must be >= 0
    await assert.rejects(
      pool.query(`INSERT INTO products (name, price, stock) VALUES ('Bad Price', -1.00, 0)`),
      (err) => {
        assert.match(err.message, /chk_products_price_non_negative|check/i);
        return true;
      }
    );

    // products.stock must be >= 0
    await assert.rejects(
      pool.query(`INSERT INTO products (name, price, stock) VALUES ('Bad Stock', 1.00, -5)`),
      (err) => {
        assert.match(err.message, /chk_products_stock_non_negative|check/i);
        return true;
      }
    );

    // Seed a valid product for FK use.
    const {
      rows: [product],
    } = await pool.query(
      `INSERT INTO products (name, price, stock) VALUES ('Good Soda', 2.00, 10) RETURNING id`
    );

    // orders.status must be one of the allowed values
    await assert.rejects(
      pool.query(`INSERT INTO orders (user_id, total, status) VALUES ($1, 5.00, 'unknown')`, [
        user.id,
      ]),
      (err) => {
        assert.match(err.message, /chk_orders_status_valid|check/i);
        return true;
      }
    );

    // orders.total must be >= 0
    await assert.rejects(
      pool.query(`INSERT INTO orders (user_id, total, status) VALUES ($1, -1.00, 'pending')`, [
        user.id,
      ]),
      (err) => {
        assert.match(err.message, /chk_orders_total_non_negative|check/i);
        return true;
      }
    );

    // Seed a valid order for FK use.
    const {
      rows: [order],
    } = await pool.query(
      `INSERT INTO orders (user_id, total, status) VALUES ($1, 5.00, 'pending') RETURNING id`,
      [user.id]
    );

    // order_items.quantity must be >= 1
    await assert.rejects(
      pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, 0, 2.00)`,
        [order.id, product.id]
      ),
      (err) => {
        assert.match(err.message, /chk_order_items_quantity_positive|check/i);
        return true;
      }
    );

    // order_items.price must be >= 0
    await assert.rejects(
      pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, 1, -0.01)`,
        [order.id, product.id]
      ),
      (err) => {
        assert.match(err.message, /chk_order_items_price_non_negative|check/i);
        return true;
      }
    );

    // Seed a valid cart so FK constraint is satisfied.
    const {
      rows: [cart],
    } = await pool.query(`INSERT INTO carts (user_id) VALUES ($1) RETURNING id`, [user.id]);

    // cart_items.quantity must be >= 1
    await assert.rejects(
      pool.query(
        `INSERT INTO cart_items (cart_id, product_id, quantity)
         VALUES ($1, $2, 0)`,
        [cart.id, product.id]
      ),
      (err) => {
        assert.match(err.message, /chk_cart_items_quantity_positive|check/i);
        return true;
      }
    );
  } finally {
    if (cleanup) {
      await cleanup();
    }
  }
});
