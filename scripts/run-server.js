const path = require('path');
const server = require(path.join(__dirname, '..', 'out', 'server'));
const port = process.env.COPILOT_API_PORT ? Number(process.env.COPILOT_API_PORT) : 11435;

server
  .startServer(port)
  .then(() => {
    console.log(`[mock-server] started on 127.0.0.1:${port}`);
  })
  .catch((err) => {
    console.error('[mock-server] failed to start', err);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  console.log('[mock-server] stopping...');
  await server.stopServer();
  process.exit(0);
});
