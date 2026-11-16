jest.mock('../../database/connection', () => {
  const { getTestDatabaseKnex } = require('./bindTestDatabase');

  return {
    __esModule: true,
    get default() {
      return getTestDatabaseKnex();
    },
  };
});
