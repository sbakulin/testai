import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { migrate, openDb } from '../../api/src/db.ts';
import { loadSeed } from '../../api/src/seed.ts';

/** Заменяет данные в api/data/app.db содержимым seed. Файл базы не удаляется. */
export function loadSeedIntoDb(root, seed) {
  const dir = join(root, 'api', 'data');
  mkdirSync(dir, { recursive: true });
  const db = openDb(join(dir, 'app.db'));
  try {
    migrate(db);
    loadSeed(db, seed);
  } finally {
    db.close();
  }
}
