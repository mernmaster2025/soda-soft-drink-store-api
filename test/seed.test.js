'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { Pool } = require('pg');

const repoRoot = path.resolve(__dirname, '..');
const setupScript = path.join(repoRoot, 'setupDatabase.js');
const seedScript = path.join(repoRoot, 'seed.js');

const adminConfig = {
  user: process.env.DB_USER || process.env.PGUSER || 'postgres',
  host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'postgres',
  port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10) || 5432,
};

function createTestDatabaseName() {
  createTestDatabaseName.counter = (createTestDatabaseName.counter || 0) + 1;
  return `soda_soft_drink_store_seed_test_${Date.now()}_${process.pid}_${createTestDatabaseName.counter}`;
}

async function dropDatabase(databaseName) {
  const adminPool = new Pool({ ...adminConfig, database: 'postgres' });
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

test('seed.js inserts 15 products and a demo user into a fresh database', async () => {
  let databaseName;
  let pool;

  try {
    databaseName = createTestDatabaseName();
    const env = { ...process.env, DB_NAME: databaseName };

    // First, create the schema.
    const setupResult = spawnSync(process.execPath, [setupScript], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
    });
    assert.equal(
      setupResult.status,
      0,
      `setupDatabase.js failed\nstdout:\n${setupResult.stdout}\nstderr:\n${setupResult.stderr}`
    );

    // Run the seed script.
    const seedResult = spawnSync(process.execPath, [seedScript], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
    });
    assert.equal(
      seedResult.status,
      0,
      `seed.js failed\nstdout:\n${seedResult.stdout}\nstderr:\n${seedResult.stderr}`
    );

    pool = new Pool({ ...adminConfig, database: databaseName });

    // Verify product count.
    const { rows: productRows } = await pool.query('SELECT COUNT(*) AS cnt FROM products');
    assert.equal(Number(productRows[0].cnt), 15, 'Expected 15 seeded products');

    // Verify demo user exists.
    const { rows: userRows } = await pool.query('SELECT email, name FROM users WHERE email = $1', [
      'demo@sodastore.example',
    ]);
    assert.equal(userRows.length, 1, 'Expected demo user to exist');
    assert.equal(userRows[0].name, 'Demo User');

    // Verify idempotency: running seed again should not add duplicate products.
    const seedAgain = spawnSync(process.execPath, [seedScript], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
    });
    assert.equal(
      seedAgain.status,
      0,
      `seed.js (second run) failed\nstdout:\n${seedAgain.stdout}\nstderr:\n${seedAgain.stderr}`
    );

    const { rows: afterSecondRun } = await pool.query('SELECT COUNT(*) AS cnt FROM products');
    assert.equal(
      Number(afterSecondRun[0].cnt),
      15,
      'Expected product count to remain 15 after second seed run'
    );

    const { rows: afterSecondUserRun } = await pool.query(
      'SELECT COUNT(*) AS cnt FROM users WHERE email = $1',
      ['demo@sodastore.example']
    );
    assert.equal(
      Number(afterSecondUserRun[0].cnt),
      1,
      'Expected only one demo user after second seed run'
    );

    // Verify --reset flag re-populates products.
    const seedReset = spawnSync(process.execPath, [seedScript, '--reset'], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
    });
    assert.equal(
      seedReset.status,
      0,
      `seed.js --reset failed\nstdout:\n${seedReset.stdout}\nstderr:\n${seedReset.stderr}`
    );

    const { rows: afterReset } = await pool.query('SELECT COUNT(*) AS cnt FROM products');
    assert.equal(Number(afterReset[0].cnt), 15, 'Expected 15 products after --reset');
  } finally {
    if (pool) {
      await pool.end();
    }
    if (databaseName) {
      await dropDatabase(databaseName);
    }
  }
});
