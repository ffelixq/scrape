import { createServer } from 'node:http';
import { createApp } from './app.js';
import { closeCache } from './services/cache.js';
import { closeResearchQueue } from './services/research-queue.js';
import { investigationRepository } from './services/repository.js';
import { appConfig } from './config.js';

const server = createServer(createApp());

server.listen(appConfig.port, () => {
  console.log(`Proofline API listening on http://localhost:${appConfig.port}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received; closing Proofline API`);
  server.close();
  await Promise.all([closeResearchQueue(), closeCache(), investigationRepository.close()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
