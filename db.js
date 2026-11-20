// db.js: Schema, Prepared Statements, Sortierlogik und Repository-Objekt fuer done-ban.

import Database from 'better-sqlite3';

/** Die fuenf erlaubten Status-Schluessel in Board-Reihenfolge. */
export const STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'ON_HOLD', 'BACKLOG'];

/** Zuordnung der frueheren deutschen Schluessel auf die heutigen. */
const ALTE_STATUS = {
  OFFEN: 'OPEN',
  IN_ARBEIT: 'IN_PROGRESS',
  CANCELED: 'BACKLOG'
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS todos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL,
  tag         TEXT,
  links       TEXT    NOT NULL DEFAULT '[]',
  due_date    TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'OPEN'
              CHECK (status IN ('OPEN','IN_PROGRESS','DONE','ON_HOLD','BACKLOG')),
  position    INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_todos_board ON todos (archived_at, status, position);
`;

/**
 * Ergaenzt fehlende Spalten in einer aelteren Datenbank. Die Daten bleiben erhalten:
 * fuer Eintraege ohne Titel wird die erste Zeile der Beschreibung uebernommen.
 */
function migrate(db) {
  migrateStatusKeys(db);
  const columns = db.prepare('PRAGMA table_info(todos)').all().map((column) => column.name);
  if (!columns.includes('title')) {
    db.exec("ALTER TABLE todos ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.includes('tag')) {
    db.exec('ALTER TABLE todos ADD COLUMN tag TEXT');
  }
  const ohneTitel = db.prepare("SELECT id, description FROM todos WHERE title = ''").all();
  if (ohneTitel.length > 0) {
    const setTitle = db.prepare('UPDATE todos SET title = ? WHERE id = ?');
    db.transaction(() => {
      for (const row of ohneTitel) setTitle.run(titleFromDescription(row.description), row.id);
    })();
  }
}

/**
 * Stellt eine Datenbank mit den frueheren deutschen Status-Schluesseln um.
 * SQLite kann eine CHECK-Bedingung nicht aendern, deshalb wird die Tabelle neu
 * aufgebaut und dabei jede Zeile uebernommen: OFFEN wird OPEN, IN_ARBEIT wird
 * IN_PROGRESS, CANCELED wird BACKLOG. Positionen und Archiv bleiben erhalten.
 */
function migrateStatusKeys(db) {
  const tabelle = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'todos'")
    .get();
  if (!tabelle || !tabelle.sql.includes("'OFFEN'")) return;

  const spalten = db
    .prepare('PRAGMA table_info(todos)')
    .all()
    .map((spalte) => spalte.name);
  const faelle = Object.entries(ALTE_STATUS)
    .map(([alt, neu]) => `WHEN '${alt}' THEN '${neu}'`)
    .join(' ');
  const uebernahme = spalten
    .map((name) => (name === 'status' ? `CASE status ${faelle} ELSE status END` : name))
    .join(', ');

  db.transaction(() => {
    db.exec(SCHEMA.replace('todos (', 'todos_neu (').replace(/CREATE INDEX[^;]+;/, ''));
    db.exec(`INSERT INTO todos_neu (${spalten.join(', ')}) SELECT ${uebernahme} FROM todos`);
    db.exec('DROP TABLE todos');
    db.exec('ALTER TABLE todos_neu RENAME TO todos');
  })();
  db.exec(SCHEMA);
}

/** Leitet einen Titel aus der Beschreibung ab: erste nicht leere Zeile, gekuerzt. */
function titleFromDescription(description) {
  const line = String(description ?? '')
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part !== '');
  if (!line) return 'Ohne Titel';
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/**
 * Wandelt eine Datenbankzeile (snake_case) in das API-Objekt (camelCase) um.
 * Die Links werden dabei aus dem JSON-Text in ein Array umgewandelt.
 */
function toDto(row) {
  if (!row) return null;
  let links = [];
  try {
    const parsed = JSON.parse(row.links);
    if (Array.isArray(parsed)) links = parsed;
  } catch {
    links = [];
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tag: row.tag ?? null,
    links,
    dueDate: row.due_date,
    status: row.status,
    position: row.position,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Oeffnet die Datenbank, legt das Schema an und liefert das Repository.
 * @param {string} file Pfad zur SQLite-Datei oder ':memory:'
 */
export function openDatabase(file) {
  const db = new Database(file);
  db.exec(SCHEMA);
  migrate(db);

  const stmt = {
    byId: db.prepare('SELECT * FROM todos WHERE id = ?'),
    active: db.prepare(
      'SELECT * FROM todos WHERE archived_at IS NULL ORDER BY position, id'
    ),
    column: db.prepare(
      'SELECT id, due_date FROM todos WHERE archived_at IS NULL AND status = ? ORDER BY position, id'
    ),
    columnByDateDesc: db.prepare(
      'SELECT id FROM todos WHERE archived_at IS NULL AND status = ? ORDER BY due_date DESC, id ASC'
    ),
    columnByDateAsc: db.prepare(
      'SELECT id FROM todos WHERE archived_at IS NULL AND status = ? ORDER BY due_date ASC, id ASC'
    ),
    insert: db.prepare(
      'INSERT INTO todos (title, description, tag, links, due_date, status) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    update: db.prepare(
      `UPDATE todos SET title = ?, description = ?, tag = ?, links = ?, due_date = ?, status = ?,
       updated_at = datetime('now') WHERE id = ?`
    ),
    setStatus: db.prepare(
      `UPDATE todos SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ),
    setPosition: db.prepare('UPDATE todos SET position = ? WHERE id = ?'),
    archive: db.prepare(
      `UPDATE todos SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ),
    archived: db.prepare(
      'SELECT * FROM todos WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, id DESC'
    ),
    archivedCount: db.prepare(
      'SELECT COUNT(*) AS n FROM todos WHERE archived_at IS NOT NULL'
    ),
    deleteArchived: db.prepare('DELETE FROM todos WHERE archived_at IS NOT NULL'),
    deleteById: db.prepare('DELETE FROM todos WHERE id = ?')
  };

  /** Schreibt die Positionen einer Spalte lueckenlos neu (0, 1, 2, ...). */
  function writePositions(ids) {
    ids.forEach((id, index) => stmt.setPosition.run(index, id));
  }

  /**
   * Regel R1/R2: Die Karte kommt vor die erste Karte der Spalte,
   * deren Zieldatum kleiner ist. Gibt es keine, kommt sie ans Ende.
   */
  function placeByDate(id, status, dueDate) {
    const others = stmt.column.all(status).filter((row) => row.id !== id);
    let index = others.findIndex((row) => row.due_date < dueDate);
    if (index === -1) index = others.length;
    const ids = others.map((row) => row.id);
    ids.splice(index, 0, id);
    writePositions(ids);
  }

  const create = db.transaction((input) => {
    const status = input.status ?? STATUSES[0];
    const info = stmt.insert.run(
      input.title,
      input.description,
      input.tag ?? null,
      JSON.stringify(input.links ?? []),
      input.dueDate,
      status
    );
    const id = Number(info.lastInsertRowid);
    placeByDate(id, status, input.dueDate);
    return toDto(stmt.byId.get(id));
  });

  const update = db.transaction((id, input) => {
    const row = stmt.byId.get(id);
    if (!row || row.archived_at) return null;
    const status = input.status ?? row.status;
    stmt.update.run(
      input.title,
      input.description,
      input.tag ?? null,
      JSON.stringify(input.links ?? []),
      input.dueDate,
      status,
      id
    );
    // R3: Nur bei geaendertem Status oder Zieldatum wird neu einsortiert.
    if (status !== row.status || input.dueDate !== row.due_date) {
      placeByDate(id, status, input.dueDate);
    }
    return toDto(stmt.byId.get(id));
  });

  // R4: Die Karte wird an Index i der Zielspalte eingefuegt.
  const move = db.transaction((id, status, index) => {
    const row = stmt.byId.get(id);
    if (!row || row.archived_at) return false;
    stmt.setStatus.run(status, id);
    const others = stmt.column.all(status).filter((r) => r.id !== id);
    const target = Math.min(Math.max(index, 0), others.length);
    const ids = others.map((r) => r.id);
    ids.splice(target, 0, id);
    writePositions(ids);
    return true;
  });

  // R5: Die ganze Spalte wird nach Zieldatum neu nummeriert, absteigend oder aufsteigend.
  const sortColumn = db.transaction((status, direction = 'desc') => {
    const query = direction === 'asc' ? stmt.columnByDateAsc : stmt.columnByDateDesc;
    writePositions(query.all(status).map((row) => row.id));
  });

  // Loescht ein To-Do endgueltig. Die Positionen der Spalte werden neu geschrieben,
  // damit keine Luecken zurueckbleiben.
  const remove = db.transaction((id) => {
    const row = stmt.byId.get(id);
    if (!row) return false;
    stmt.deleteById.run(id);
    if (!row.archived_at) {
      writePositions(stmt.column.all(row.status).map((entry) => entry.id));
    }
    return true;
  });

  const archive = db.transaction((id) => {
    const row = stmt.byId.get(id);
    if (!row || row.archived_at) return 'not_found';
    if (row.status !== 'DONE') return 'conflict';
    stmt.archive.run(id);
    return 'ok';
  });

  return {
    /** Alle aktiven To-Dos, sortiert nach Position und ID. */
    listActive: () => stmt.active.all().map(toDto),
    /** Anzahl der archivierten Eintraege. */
    archivedCount: () => stmt.archivedCount.get().n,
    getById: (id) => toDto(stmt.byId.get(id)),
    create,
    update,
    move,
    remove,
    sortColumn,
    archive,
    listArchive: () => stmt.archived.all().map(toDto),
    clearArchive: () => stmt.deleteArchived.run().changes,
    close: () => db.close()
  };
}
