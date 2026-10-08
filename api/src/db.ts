import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function migrate(db: DatabaseSync): void {
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
}

/**
 * Выполняет fn в одной транзакции; при исключении откатывает.
 * Если транзакция уже открыта, fn выполняется внутри неё: коммит и откат за внешним вызовом.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // исходная ошибка важнее ошибки отката
    }
    throw err;
  }
}
