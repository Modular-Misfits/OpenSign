import pg from 'pg';

const { Client } = pg;

const migrations = [
  {
    name: 'normalized_email_unique_1',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "opensign_user_normalized_email_unique"
          ON "_User" ("normalizedEmail")
          WHERE "normalizedEmail" IS NOT NULL`,
  },
  {
    name: 'contact_lookup_postgres_1',
    sql: `CREATE INDEX IF NOT EXISTS "opensign_contact_lookup"
          ON "contracts_Contactbook" ("CreatedBy", LOWER("Email"))
          WHERE COALESCE("IsDeleted", FALSE) = FALSE`,
  },
  {
    name: 'document_creator_recent_completed_postgres_1',
    sql: `CREATE INDEX IF NOT EXISTS "opensign_docs_creator_recent_completed"
          ON "contracts_Document" ("CreatedBy", "updatedAt" DESC)
          WHERE "IsCompleted" = TRUE`,
  },
  {
    name: 'document_signers_postgres_1',
    sql: `CREATE INDEX IF NOT EXISTS "opensign_docs_signers_gin"
          ON "contracts_Document" USING GIN ("Signers")`,
  },
  {
    name: 'portal_request_id_unique_postgres_1',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "opensign_portal_request_id_unique"
          ON "contracts_Document" ("PortalRequestId")
          WHERE "PortalRequestId" IS NOT NULL`,
  },
  {
    name: 'portal_telnyx_failover_events_postgres_1',
    sql: `CREATE TABLE IF NOT EXISTS portal_telnyx_failover_events (
            event_id TEXT PRIMARY KEY,
            raw_payload TEXT NOT NULL,
            telnyx_signature TEXT NOT NULL,
            telnyx_timestamp TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'delivered')),
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            delivered_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS portal_telnyx_failover_pending
            ON portal_telnyx_failover_events (next_attempt_at, received_at)
            WHERE status = 'pending'`,
  },
];

export default async function runDbMigrations() {
  const databaseUri = process.env.DATABASE_URI;
  if (!databaseUri?.startsWith('postgres')) {
    throw new Error('DATABASE_URI must be a PostgreSQL connection string');
  }

  const client = new Client({ connectionString: databaseUri });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS opensign_schema_migrations (
      name TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    for (const migration of migrations) {
      const existing = await client.query(
        'SELECT 1 FROM opensign_schema_migrations WHERE name = $1',
        [migration.name]
      );
      if (existing.rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO opensign_schema_migrations (name) VALUES ($1)', [
          migration.name,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}
