const { createMockDatabase } = require('../src/models/mock');
const { dataContract } = require('./data-contract');
describe('mock data contract', () => { const db = createMockDatabase(); dataContract(() => db); });
