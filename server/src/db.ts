import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

// Схема хранится одной миграцией: проект на стадии первой версии.
// Новые изменения добавляются отдельными шагами в MIGRATIONS.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('client','specialist')),
    timezone      TEXT NOT NULL DEFAULT 'Europe/Moscow',
    created_at    TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE specialist_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    title   TEXT NOT NULL DEFAULT '',
    about   TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE invitations (
    id            TEXT PRIMARY KEY,
    specialist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    TEXT NOT NULL UNIQUE,
    client_hint   TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    accepted_at   TEXT,
    accepted_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    revoked_at    TEXT
  );

  -- Связь клиента со специалистом и согласие на доступ
  CREATE TABLE care_links (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    specialist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitation_id TEXT REFERENCES invitations(id) ON DELETE SET NULL,
    scopes        TEXT NOT NULL,
    consented_at  TEXT NOT NULL,
    revoked_at    TEXT,
    revoked_by    TEXT
  );
  CREATE UNIQUE INDEX care_links_one_active ON care_links(client_id) WHERE revoked_at IS NULL;

  CREATE TABLE specialist_views (
    specialist_id  TEXT NOT NULL,
    client_id      TEXT NOT NULL,
    last_viewed_at TEXT NOT NULL,
    PRIMARY KEY (specialist_id, client_id)
  );

  CREATE TABLE documents (
    id               TEXT PRIMARY KEY,
    owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uploaded_by      TEXT NOT NULL,
    file_name        TEXT NOT NULL,
    mime             TEXT NOT NULL,
    size             INTEGER NOT NULL,
    sha256           TEXT NOT NULL,
    storage_key      TEXT NOT NULL,
    pages            INTEGER,
    lab              TEXT,
    collected_at     TEXT,
    uploaded_at      TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('uploaded','processing','needs_review','confirmed','error')),
    error            TEXT,
    patient_name     TEXT,
    ownership        TEXT NOT NULL DEFAULT 'ok' CHECK (ownership IN ('ok','needs_check','confirmed')),
    recognizer       TEXT,
    confirmed_by     TEXT,
    confirmed_at     TEXT
  );

  CREATE TABLE results (
    id             TEXT PRIMARY KEY,
    document_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position       INTEGER NOT NULL DEFAULT 0,
    analyte_code   TEXT,
    name           TEXT NOT NULL,
    value_num      REAL,
    value_text     TEXT NOT NULL,
    unit           TEXT NOT NULL DEFAULT '',
    ref_low        REAL,
    ref_high       REAL,
    ref_text       TEXT NOT NULL DEFAULT '',
    lab_flag       TEXT NOT NULL DEFAULT '',
    collected_at   TEXT,
    low_confidence TEXT NOT NULL DEFAULT '[]',
    recognized     TEXT,
    source         TEXT NOT NULL CHECK (source IN ('recognized','manual')),
    status         TEXT NOT NULL CHECK (status IN ('draft','confirmed')),
    edited_by      TEXT,
    edited_at      TEXT,
    confirmed_by   TEXT,
    confirmed_at   TEXT
  );
  CREATE INDEX results_owner_code ON results(owner_id, analyte_code);

  CREATE TABLE explanations (
    id            TEXT PRIMARY KEY,
    result_id     TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
    generator     TEXT NOT NULL,
    version       TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    input         TEXT NOT NULL,
    status        TEXT NOT NULL,
    text          TEXT NOT NULL,
    source_title  TEXT,
    source_url    TEXT
  );

  CREATE TABLE comments (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_id   TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('conclusion','internal','question')),
    target_type TEXT NOT NULL CHECK (target_type IN ('general','document','result','analyte')),
    target_id   TEXT,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE schemes (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    specialist_id TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    cancelled_at  TEXT,
    cancel_reason TEXT
  );

  -- Каждая публикация — новая версия. Черновик — версия без published_at.
  CREATE TABLE scheme_versions (
    id             TEXT PRIMARY KEY,
    scheme_id      TEXT NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    number         INTEGER NOT NULL,
    title          TEXT NOT NULL,
    comment        TEXT NOT NULL DEFAULT '',
    start_date     TEXT NOT NULL,
    end_date       TEXT NOT NULL,
    control_date   TEXT,
    effective_from TEXT,
    created_at     TEXT NOT NULL,
    published_at   TEXT,
    published_by   TEXT,
    changes        TEXT
  );
  CREATE UNIQUE INDEX scheme_versions_num ON scheme_versions(scheme_id, number);

  CREATE TABLE scheme_items (
    id               TEXT PRIMARY KEY,
    version_id       TEXT NOT NULL REFERENCES scheme_versions(id) ON DELETE CASCADE,
    group_key        TEXT NOT NULL,
    position         INTEGER NOT NULL,
    name             TEXT NOT NULL,
    product          TEXT NOT NULL DEFAULT '',
    form             TEXT NOT NULL,
    amount           REAL NOT NULL,
    amount_unit      TEXT NOT NULL,
    substance_amount REAL,
    substance_unit   TEXT,
    doses            TEXT NOT NULL,
    frequency        TEXT NOT NULL,
    food             TEXT NOT NULL,
    start_date       TEXT NOT NULL,
    end_date         TEXT NOT NULL,
    instruction      TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE planned_intakes (
    id           TEXT PRIMARY KEY,
    client_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheme_id    TEXT NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    version_id   TEXT NOT NULL REFERENCES scheme_versions(id) ON DELETE CASCADE,
    item_id      TEXT NOT NULL REFERENCES scheme_items(id) ON DELETE CASCADE,
    group_key    TEXT NOT NULL,
    date         TEXT NOT NULL,
    slot         TEXT NOT NULL,
    time_local   TEXT NOT NULL,
    due_at       TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('planned','cancelled','superseded')),
    status_at    TEXT,
    reminded_at  TEXT,
    snooze_until TEXT
  );
  CREATE INDEX planned_client_date ON planned_intakes(client_id, date);
  CREATE INDEX planned_due ON planned_intakes(status, due_at);

  -- Текущая отметка по запланированному приёму; история — в mark_history
  CREATE TABLE intake_marks (
    planned_id  TEXT PRIMARY KEY REFERENCES planned_intakes(id) ON DELETE CASCADE,
    client_id   TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('taken','skipped')),
    taken_at    TEXT,
    reason      TEXT,
    recorded_at TEXT NOT NULL,
    recorded_by TEXT NOT NULL
  );

  CREATE TABLE mark_history (
    id          TEXT PRIMARY KEY,
    planned_id  TEXT NOT NULL REFERENCES planned_intakes(id) ON DELETE CASCADE,
    request_id  TEXT UNIQUE,
    status      TEXT,
    taken_at    TEXT,
    reason      TEXT,
    recorded_at TEXT NOT NULL,
    recorded_by TEXT NOT NULL
  );

  CREATE TABLE self_supplements (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    amount      TEXT NOT NULL DEFAULT '',
    schedule    TEXT NOT NULL DEFAULT '',
    start_date  TEXT,
    end_date    TEXT,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE wellbeing (
    id         TEXT PRIMARY KEY,
    client_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    energy     INTEGER,
    sleep      INTEGER,
    overall    INTEGER,
    symptoms   TEXT NOT NULL DEFAULT '[]',
    adverse    INTEGER NOT NULL DEFAULT 0,
    comment    TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE (client_id, date)
  );

  CREATE TABLE notification_settings (
    user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    quiet_from     TEXT,
    quiet_to       TEXT,
    channel_inapp  INTEGER NOT NULL DEFAULT 1,
    channel_browser INTEGER NOT NULL DEFAULT 0,
    hide_sensitive INTEGER NOT NULL DEFAULT 1,
    intake_reminders INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE notifications (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    public_title TEXT NOT NULL,
    link         TEXT,
    dedupe_key   TEXT UNIQUE,
    created_at   TEXT NOT NULL,
    read_at      TEXT
  );
  CREATE INDEX notifications_user ON notifications(user_id, created_at);

  -- Журнал изменений и событий по клиенту
  CREATE TABLE audit_log (
    id        TEXT PRIMARY KEY,
    at        TEXT NOT NULL,
    actor_id  TEXT,
    client_id TEXT,
    entity    TEXT NOT NULL,
    entity_id TEXT,
    action    TEXT NOT NULL,
    data      TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX audit_client ON audit_log(client_id, at);
  `,
  // Справочные интервалы: источник интервала результата и профиль для их подбора
  `
  ALTER TABLE results ADD COLUMN ref_source TEXT;
  ALTER TABLE results ADD COLUMN ref_note TEXT;
  ALTER TABLE users ADD COLUMN sex TEXT;
  ALTER TABLE users ADD COLUMN birth_date TEXT;
  UPDATE results SET ref_source = 'lab' WHERE ref_low IS NOT NULL OR ref_high IS NOT NULL;
  `,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get() as { v: number } | undefined;
  let v = row?.v ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.prepare('UPDATE schema_version SET v = ?').run(v + 1);
    });
    v++;
  }
}

let depth = 0;
export function tx<T>(db: DB, fn: () => T): T {
  if (depth > 0) {
    depth++;
    try { return fn(); } finally { depth--; }
  }
  db.exec('BEGIN IMMEDIATE');
  depth = 1;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth = 0;
  }
}

export type Row = Record<string, any>;

export function all<T = Row>(db: DB, sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T = Row>(db: DB, sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(db: DB, sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}
