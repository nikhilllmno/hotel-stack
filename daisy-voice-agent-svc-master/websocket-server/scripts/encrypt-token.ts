import 'dotenv/config';
import { encrypt } from '../src/utils/encryption';

const plaintext = process.argv[2];

if (!plaintext) {
  console.error('Usage: ts-node scripts/encrypt-token.ts <token>');
  process.exit(1);
}

if (!process.env.ENCRYPTION_SECRET) {
  console.error('Missing ENCRYPTION_SECRET env var');
  process.exit(1);
}

console.log(encrypt(plaintext));
