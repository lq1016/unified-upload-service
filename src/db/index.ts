import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config/index.js';

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;
  const dir = path.dirname(config.dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma(`journal_mode = ${config.dbJournalMode}`);
  db.pragma('foreign_keys = ON');
  instance = db;
  return db;
}

/** 测试用：使用内存数据库 */
export function useMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  instance = db;
  return db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export default getDb;
