import 'dotenv/config';
import knex from 'knex';
import crypto from 'crypto';

const DATABASE_URL = '' // db
const ENCRYPTION_SECRET = ''// secret
const HOTEL_IDS: string[] = [
  // IDs
];

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL env var');
  process.exit(1);
}
if (!ENCRYPTION_SECRET) {
  console.error('Missing ENCRYPTION_SECRET env var');
  process.exit(1);
}

function decrypt(ciphertext: string): string {
  const key = crypto.createHash('sha256').update(ENCRYPTION_SECRET!).digest();
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

async function main() {
  const db = knex({ client: 'pg', connection: DATABASE_URL });

  try {
    const query = db('hotel_configurations')
      .join('hotels', 'hotels.id', 'hotel_configurations.hotel_id')
      .whereNull('hotel_configurations.deleted_at')
      .whereNotNull('hotel_configurations.api_token')
      .select('hotels.id as hotel_id', 'hotels.name as hotel_name', 'hotel_configurations.api_token');

    if (HOTEL_IDS.filter(Boolean).length) {
      query.whereIn('hotels.id', HOTEL_IDS.filter(Boolean));
    }

    const rows = await query;

    if (!rows.length) {
      console.log('No hotels with stored api_token found.');
      return;
    }

    for (const row of rows) {
      try {
        const token = decrypt(row.api_token);
        console.log(`\n--- ${row.hotel_name} (${row.hotel_id}) ---`);
        console.log(token);
      } catch (err) {
        console.error(`Failed to decrypt token for ${row.hotel_name} (${row.hotel_id}):`, err);
      }
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
