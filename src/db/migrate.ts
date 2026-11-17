import path from 'node:path';
import { getDb } from './index.js';
import { SCHEMA_SQL } from './schema.js';

/** 幂等建表。SQL 定义在 schema.ts，编译后仍可用。 */
export function migrate(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);
  console.log('[migrate] 数据库建表完成');
}

// 允许直接执行：tsx src/db/migrate.ts
if (process.argv[1] && path.resolve(process.argv[1]).includes('migrate')) {
  migrate();
}
