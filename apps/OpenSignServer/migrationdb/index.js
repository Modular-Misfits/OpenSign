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
