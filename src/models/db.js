const { readDatabase } = require('../config/runtime');
const config = readDatabase();
// DB seçimi açıktır; bağlantı hatası veri deposunu değiştirmez.
module.exports = config.mock
  ? require('./mock').createMockDatabase()
  : require('./mysql').createMysqlDatabase(config.options);
