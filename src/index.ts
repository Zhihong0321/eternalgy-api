import { buildServer } from './server.js';
import { config } from './config/env.js';
import { closePool } from './db/pool.js';

async function main() {
  const app = await buildServer();

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(
      `🚀 Eternalgy API Gateway listening on http://${config.HOST}:${config.PORT}`
    );
    app.log.info(`📖 Interactive API Documentation available at http://${config.HOST}:${config.PORT}/docs`);
    app.log.info(`🛡️ Access Control Engine active with Railway internal database integration`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Shutting down gracefully...`);
    try {
      await app.close();
      await closePool();
      app.log.info('Closed HTTP server and PostgreSQL connection pool.');
      process.exit(0);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
