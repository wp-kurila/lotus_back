import { config } from './config.js';
import { openDb } from './db.js';
import { createBot } from './bot.js';
import { createServer } from './server.js';

const db = openDb(config.dbPath);
const bot = createBot(config.botToken, config.adminIds, db);
const server = await createServer(config, db, (click) => void bot.notify(click));

if (config.adminIds.length === 0) {
  server.log.warn('ADMIN_IDS пуст: уведомления никуда не уйдут. Напиши боту /start, чтобы узнать свой ID');
}

await server.listen({ host: config.host, port: config.port });

bot.start().catch((err) => {
  server.log.fatal(err, 'Бот не запустился');
  process.exit(1);
});

async function shutdown() {
  await server.close();
  await bot.stop();
  db.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
