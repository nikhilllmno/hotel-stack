process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test/test';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.SECURE_URL ??= 'https://pay.test.dextr';
process.env.STRIPE_PAYMENT_LINK_URL ??= 'https://checkout.stripe.com/c/pay';
process.env.ENCRYPTION_SECRET ??= 'test-encryption-secret';
