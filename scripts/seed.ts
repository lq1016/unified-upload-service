import { hashPassword } from '../src/security/password.js';
import { getDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { newId } from '../src/utils/index.js';

/**
 * 初始化 2 个测试账号（验收标准 #9）：
 *   user1 / Test@123456  （普通用户，role=user）
 *   admin / Admin@123456 （管理员，role=admin）
 * 密码仅用于测试环境演示，生产请通过环境变量/管理接口创建。
 */
export function seed(): void {
  migrate();
  const db = getDb();
  const accounts = [
    { username: 'user1', password: 'Test@123456', role: 'user' },
    { username: 'admin', password: 'Admin@123456', role: 'admin' },
  ];
  const insert = db.prepare('INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)');
  for (const a of accounts) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(a.username);
    if (existing) {
      db.prepare('UPDATE users SET password_hash = ?, role = ?, active = 1 WHERE username = ?').run(hashPassword(a.password), a.role, a.username);
      console.log(`[seed] 更新测试账号: ${a.username}`);
    } else {
      insert.run(newId('u_'), a.username, hashPassword(a.password), a.role);
      console.log(`[seed] 创建测试账号: ${a.username}`);
    }
  }
  console.log('\n测试账号:');
  console.log('  user1 / Test@123456  (user)');
  console.log('  admin / Admin@123456 (admin)');
}

if (process.argv[1] && /(^|\/)seed(\.ts)?$/.test(process.argv[1])) {
  seed();
}
