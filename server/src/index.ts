import { join, resolve } from 'node:path';
import { openDb } from './db.ts';
import { FileStore } from './core.ts';
import { createApp } from './app.ts';
import { builtinRecognizer } from './recognition.ts';
import { startScheduler } from './reminders.ts';

const root = resolve(import.meta.dirname, '../..');
const dataDir = process.env.NUTRI_DATA_DIR ?? join(root, 'data');
const port = Number(process.env.PORT ?? 3000);

if (process.env.NODE_ENV === 'production' && !process.env.NUTRI_FILE_KEY) {
  console.error('NUTRI_FILE_KEY обязателен в production: без него файлы анализов шифруются ключом из каталога данных');
  process.exit(1);
}

const db = openDb(join(dataDir, 'nutri.db'));
const files = new FileStore(join(dataDir, 'files'), process.env.NUTRI_FILE_KEY);
const app = createApp({
  db, files, recognizer: builtinRecognizer,
  webDist: join(root, 'web/dist'),
  secureCookies: process.env.NODE_ENV === 'production',
});
startScheduler(db);
app.listen(port, () => console.log(`nutri: http://localhost:${port}`));
