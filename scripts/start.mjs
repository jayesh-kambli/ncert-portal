import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Plain .mjs, not .ts — runs with plain `node`, no dev-only tooling
// (tsx/ts-node) required at runtime.

function log(message) {
  console.log(`[startup] ${new Date().toISOString()} ${message}`);
}

function redactedUrl(connectionString) {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = "****";
    return url.toString();
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function waitForDatabase(pool, { retries = 10, delayMs = 3000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query("SELECT 1");
      log(`Database connection OK (attempt ${attempt}/${retries})`);
      return;
    } catch (err) {
      log(`Database not reachable yet (attempt ${attempt}/${retries}): ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main() {
  log("Starting NCERT Portal...");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    log("FATAL: DATABASE_URL is not set.");
    process.exit(1);
  }

  log(`Connecting to database at ${redactedUrl(connectionString)} ...`);
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });

  try {
    await waitForDatabase(pool);
  } catch (err) {
    log(`FATAL: could not reach the database after retries: ${err.message}`);
    log(
      "Check DATABASE_URL in the app's environment variables — in Dokploy, the host " +
        "must be the Postgres service's internal network name, not 'localhost'."
    );
    process.exit(1);
  }

  log("Running database migrations...");
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    log("Migrations applied successfully.");
  } catch (err) {
    log(`FATAL: migration failed: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }

  const port = process.env.PORT || "4055";
  log(`Starting Next.js server on port ${port}...`);

  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  log(`FATAL: unexpected startup error: ${err.stack ?? err.message}`);
  process.exit(1);
});
