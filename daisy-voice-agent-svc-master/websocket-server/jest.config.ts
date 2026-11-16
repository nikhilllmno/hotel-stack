const setupFiles = [
  '<rootDir>/src/test/integrationEnvSetup.ts',
  '<rootDir>/src/test/setup.ts',
  '<rootDir>/src/test/mocks/registerExternalMocks.ts',
  '<rootDir>/src/test/db/registerTestDatabaseMock.ts',
];

const unitSetupFiles = setupFiles.filter(
  (file) => !file.includes('integrationEnvSetup'),
);

const moduleNameMapper = {
  '^@/(.*)$': '<rootDir>/src/$1',
};

export default {
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      moduleNameMapper,
      roots: ['<rootDir>/src'],
      testMatch: [
        '**/__tests__/**/*.test.ts',
        '**/*.test.ts',
      ],
      testPathIgnorePatterns: ['\\.test\\.integration\\.ts$'],
      setupFiles: unitSetupFiles,
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      moduleNameMapper,
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/**/*.test.integration.ts'],
      setupFiles,
      setupFilesAfterEnv: ['<rootDir>/src/test/integrationJestSetup.ts'],
      maxWorkers: 1,
    },
  ],
};
