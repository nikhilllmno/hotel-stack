export function throwIntegrationSetupFailure(
  phase: string,
  error: unknown,
): never {
  const originalMessage =
    error instanceof Error ? error.message : String(error);
  const hint = getIntegrationSetupHint(phase, originalMessage);
  const banner = formatIntegrationSetupFailureBanner(
    phase,
    originalMessage,
    hint,
  );

  throw new Error(banner);
}

function formatIntegrationSetupFailureBanner(
  phase: string,
  originalMessage: string,
  hint: string,
): string {
  const divider = '═'.repeat(72);

  return [
    divider,
    'INTEGRATION TEST DATABASE SETUP FAILED',
    divider,
    '',
    originalMessage,
    '',
    `Failed during: ${phase}`,
    '',
    hint,
    '',
    divider,
  ].join('\n');
}

function getIntegrationSetupHint(phase: string, message: string): string {
  if (message.includes('Could not find a working container runtime strategy')) {
    return [
      'Docker does not appear to be running or reachable.',
      '- Start Docker Desktop (or your Docker daemon) and retry.',
      '- Run integration tests from the websocket-server directory: npm run test:integration',
    ].join('\n');
  }

  if (message.includes('No host port found for host IP')) {
    return [
      'Docker port mapping failed (common on Windows and some Docker Desktop versions).',
      '- TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1 is set automatically by integrationEnvSetup.ts.',
      '- If this persists, upgrade Docker Desktop to 4.44+ (4.42.x had a port-mapping regression).',
      '- See: https://github.com/testcontainers/testcontainers-node/issues/818',
    ].join('\n');
  }

  if (
    message.includes('Timed out') &&
    (message.includes('container ports') ||
      message.includes('startup') ||
      message.includes('waiting for'))
  ) {
    return [
      'The Postgres container did not become ready in time.',
      '- First run pulls the postgres:16 image and can take up to 2 minutes.',
      '- Ensure Docker has enough CPU/RAM allocated.',
    ].join('\n');
  }

  if (phase === 'knex migrations') {
    return [
      'Knex migrations failed against the test container.',
      '- Run from websocket-server: npm run test:integration',
      '- Ensure ts-jest can load src/migrations/*.ts (no separate build step required).',
    ].join('\n');
  }

  return [
    'Integration test database setup failed.',
    '- See the Testing section in README.md for prerequisites and troubleshooting.',
    '- Set DEBUG=testcontainers* for verbose Testcontainers logs.',
  ].join('\n');
}
