import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { migrate } from './db/migrate.ts';

const config = loadConfig();
await migrate(config.databaseUrl, (msg) => console.log(msg));
const app = await buildApp(config);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ port: config.port, host: '0.0.0.0' });
