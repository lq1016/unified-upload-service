import config from './config/index.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`[upload-service] 已启动: http://${config.host}:${config.port}`);
  console.log(`[upload-service] 存储驱动: ${config.storage.driver}`);
  console.log(`[upload-service] 健康检查: GET /api/health`);
});

// 优雅关停
function shutdown(signal: string): void {
  console.log(`[upload-service] 收到 ${signal}，正在关闭...`);
  server.close(() => {
    console.log('[upload-service] 已关闭');
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
