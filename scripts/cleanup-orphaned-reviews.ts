/**
 * Cleanup: Delete orphaned review rows blocking the FK migration.
 * Uses pg directly to avoid adapter complexity.
 */
import { Pool } from "pg";

// Load .env
const envPath = new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const fs = await import("fs");
const envContent = fs.readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const [key, ...rest] = trimmed.split("=");
  if (!process.env[key]) process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();

  try {
    // Find orphaned repo IDs in review table
    const result = await client.query(`
      SELECT DISTINCT r."repositoryId"
      FROM "review" r
      LEFT JOIN "repository" repo ON repo.id = r."repositoryId"
      WHERE repo.id IS NULL
    `);

    console.log(`Found ${result.rows.length} orphaned repositoryIds`);

    if (result.rows.length === 0) {
      console.log("✅ No orphaned reviews — DB is clean!");
      return;
    }

    for (const row of result.rows) {
      const del = await client.query(
        `DELETE FROM "review" WHERE "repositoryId" = $1`,
        [row.repositoryId]
      );
      console.log(`  🗑  Deleted ${del.rowCount} reviews for missing repo: ${row.repositoryId}`);
    }

    console.log("\n✅ Done! Now retry: bunx prisma db push");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
