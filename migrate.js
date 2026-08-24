import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceUrl = 'postgresql://postgres:cZzHwRxnKmtFYfFiFpxdznncQUdVtEfe@nozomi.proxy.rlwy.net:48808/railway';
const targetUrl = process.env.DATABASE_URL;

async function migrate() {
  if (!targetUrl) {
    console.error('DATABASE_URL is not set. Skipping migration.');
    return;
  }
  
  // We can track if migration has already been run by creating a flag table.
  const check = new Client({ connectionString: targetUrl });
  await check.connect();
  const { rows } = await check.query("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'migration_flag')");
  if (rows[0].exists) {
    console.log('Migration already completed previously. Skipping.');
    await check.end();
    return;
  }
  await check.end();

  console.log('Connecting to Source (Railway)...');
  const source = new Client({ connectionString: sourceUrl });
  await source.connect();
  
  console.log('Connecting to Target (Coolify)...');
  const target = new Client({ connectionString: targetUrl });
  await target.connect();

  console.log('Disabling foreign keys on target...');
  await target.query('SET session_replication_role = replica;');

  try {
    console.log('Resetting target schema...');
    await target.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    console.log('Applying schema.sql...');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'server', 'schema.sql'), 'utf8');
    await target.query(schemaSql);

    const res = await source.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const tables = res.rows.map(r => r.table_name);
    console.log(`Found ${tables.length} tables:`, tables.join(', '));

    for (const table of tables) {
      console.log(`Migrating table: ${table}...`);
      const data = await source.query(`SELECT * FROM "${table}"`);
      if (data.rows.length === 0) {
        console.log(`  - 0 rows, skipping.`);
        continue;
      }
      
      const columns = Object.keys(data.rows[0]);
      const colStr = columns.map(c => `"${c}"`).join(', ');
      
      let inserted = 0;
      for (const row of data.rows) {
        const values = columns.map(c => row[c]);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        
        await target.query(
          `INSERT INTO "${table}" (${colStr}) VALUES (${placeholders})`,
          values
        );
        inserted++;
      }
      console.log(`  - Inserted ${inserted} rows.`);
    }

    console.log('Re-enabling foreign keys...');
    await target.query('SET session_replication_role = DEFAULT;');

    console.log('Marking migration as complete...');
    await target.query('CREATE TABLE migration_flag (completed BOOLEAN)');

    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Error during migration:', err);
  } finally {
    await source.end();
    await target.end();
  }
}

migrate();
