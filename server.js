// server.js: HTTP-Server, REST-API und Lebenszyklus (SSE, Shutdown, Browser oeffnen) fuer done-ban.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDatabase, STATUSES } from './db.js';
import { validateTodo } from './validation.js';

/** Kennung der App, auch Antwort von /api/health. */
const APP_ID = 'done-ban';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const DB_DIR = path.join(HERE, 'database');
const DB_FILE = process.env.TODO_DB || path.join(DB_DIR, 'todos.db');

const PORT = Number(process.env.PORT || 3003);
const HOST = '127.0.0.1';
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS || 5000);
const STARTUP_TIMEOUT_MS = Number(process.env.STARTUP_TIMEOUT_MS || 60000);
const PING_INTERVAL_MS = 20000;

// Der Ordner der Datenbankdatei wird beim Start angelegt, falls er fehlt.
if (DB_FILE !== ':memory:') mkdirSync(path.dirname(DB_FILE), { recursive: true });

const repo = openDatabase(DB_FILE);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// --- Hilfsfunktionen ----------------------------------------------------

/** Offene SSE-Verbindungen. Solange mindestens eine besteht, laeuft der Server. */
const clients = new Set();
let shutdownTimer = null;
let shuttingDown = false;

function cancelShutdown() {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
}

function scheduleShutdown(delay, reason) {
  cancelShutdown();
  shutdownTimer = setTimeout(() => shutdown(reason), delay);
}

/** Meldet allen offenen Tabs, dass sich die Daten geaendert haben. */
function broadcastChange() {
  for (const res of clients) {
    res.write('event: change\ndata: {}\n\n');
  }
}

// --- API ----------------------------------------------------------------

// Zentrale Pruefung der ID: nur positive Ganzzahlen.
app.param('id', (req, res, next, value) => {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    return res.status(400).json({ error: 'Ungültige ID.' });
  }
  req.todoId = Number(value);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ app: APP_ID });
});

app.get('/api/todos', (req, res) => {
  res.json({ todos: repo.listActive(), archivedCount: repo.archivedCount() });
});

app.post('/api/todos', (req, res) => {
  const check = validateTodo(req.body);
  if (!check.ok) return res.status(400).json({ error: check.error });
  const todo = repo.create(check.value);
  broadcastChange();
  res.status(201).json(todo);
});

app.put('/api/todos/:id', (req, res) => {
  const check = validateTodo(req.body);
  if (!check.ok) return res.status(400).json({ error: check.error });
  const todo = repo.update(req.todoId, check.value);
  if (!todo) return res.status(404).json({ error: 'Das To-Do wurde nicht gefunden.' });
  broadcastChange();
  res.json(todo);
});

app.delete('/api/todos/:id', (req, res) => {
  if (!repo.remove(req.todoId)) {
    return res.status(404).json({ error: 'Das To-Do wurde nicht gefunden.' });
  }
  broadcastChange();
  res.status(204).end();
});

app.patch('/api/todos/:id/position', (req, res) => {
  const body = req.body ?? {};
  if (typeof body.status !== 'string' || !STATUSES.includes(body.status)) {
    return res.status(400).json({ error: 'Ungültiger Status.' });
  }
  if (!Number.isInteger(body.index) || body.index < 0) {
    return res.status(400).json({ error: 'Ungültiger Index.' });
  }
  if (!repo.move(req.todoId, body.status, body.index)) {
    return res.status(404).json({ error: 'Das To-Do wurde nicht gefunden.' });
  }
  broadcastChange();
  res.status(204).end();
});

app.post('/api/todos/:id/archive', (req, res) => {
  const result = repo.archive(req.todoId);
  if (result === 'not_found') {
    return res.status(404).json({ error: 'Das To-Do wurde nicht gefunden.' });
  }
  if (result === 'conflict') {
    return res.status(409).json({ error: 'Nur erledigte To-Dos können archiviert werden.' });
  }
  broadcastChange();
  res.status(204).end();
});

app.post('/api/columns/:status/sort', (req, res) => {
  const status = req.params.status;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Ungültiger Status.' });
  }
  // Richtung ist optional, ohne Angabe wird absteigend sortiert.
  const direction = (req.body ?? {}).direction ?? 'desc';
  if (direction !== 'asc' && direction !== 'desc') {
    return res.status(400).json({ error: 'Ungültige Sortierrichtung.' });
  }
  repo.sortColumn(status, direction);
  broadcastChange();
  res.status(204).end();
});

app.get('/api/archive', (req, res) => {
  res.json(repo.listArchive());
});

app.delete('/api/archive', (req, res) => {
  const deleted = repo.clearArchive();
  broadcastChange();
  res.json({ deleted });
});

// Server-Sent Events: haelt die Verbindung zu jedem offenen Tab.
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write('retry: 1000\n\n');
  clients.add(res);
  cancelShutdown();

  const ping = setInterval(() => res.write(': ping\n\n'), PING_INTERVAL_MS);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    if (clients.size === 0 && !shuttingDown) {
      scheduleShutdown(SHUTDOWN_GRACE_MS, 'Der letzte Tab wurde geschlossen.');
    }
  });
});

// Unbekannte API-Pfade antworten als JSON, nicht als HTML.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Unbekannter Endpunkt.' });
});

app.use(express.static(PUBLIC_DIR));

// Zentrale Fehlerbehandlung. Details bleiben in der Konsole.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: 'Ungültiges JSON im Request.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Der Request ist zu groß.' });
  }
  console.error('Interner Fehler:', err);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

// --- Lebenszyklus -------------------------------------------------------

// Eigener HTTP-Server statt app.listen: Express 5 reicht den listen-Callback auch
// an das error-Ereignis weiter, die Startmeldung erschiene sonst auch bei belegtem Port.
const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`${APP_ID} läuft auf ${url}`);
  // Startschutz: Verbindet sich kein Browser, beendet sich der Server wieder.
  scheduleShutdown(STARTUP_TIMEOUT_MS, 'Es hat sich kein Browser verbunden.');
  openBrowser(url);
});

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') {
    console.error('Der Server konnte nicht gestartet werden:', err);
    process.exit(1);
  }
  const url = `http://localhost:${PORT}`;
  if (await isOwnInstance(url)) {
    console.log(`${APP_ID} läuft bereits auf ${url}`);
    openBrowser(url);
    process.exit(0);
  }
  console.error(`Port ${PORT} ist von einem anderen Programm belegt.`);
  console.error(`Anderen Port verwenden, zum Beispiel: PORT=${PORT + 1} ./start.sh`);
  process.exit(1);
});

/** Prueft, ob auf dem Port bereits diese App antwortet. */
async function isOwnInstance(url) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.app === APP_ID;
  } catch {
    return false;
  }
}

/** Oeffnet die Seite im Standardbrowser, je nach Betriebssystem. */
function openBrowser(url) {
  if (process.env.NO_OPEN === '1') return;
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log(`Bitte im Browser öffnen: ${url}`));
    child.unref();
  } catch {
    console.log(`Bitte im Browser öffnen: ${url}`);
  }
}

/** Beendet den Server geordnet. Laeuft nur einmal. */
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  cancelShutdown();
  console.log(`${APP_ID} wird beendet: ${reason}`);
  for (const res of clients) {
    try {
      res.end();
    } catch {
      // Die Verbindung war bereits geschlossen.
    }
  }
  clients.clear();
  server.close(() => {
    try {
      repo.close();
    } catch {
      // Die Datenbank war bereits geschlossen.
    }
    process.exit(0);
  });
  server.closeAllConnections();
  // Notbremse, falls eine Verbindung haengen bleibt.
  setTimeout(() => process.exit(0), 2000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  // Beim Hintergrundstart ueber start.command wird SIGHUP bewusst ignoriert:
  // Das Schliessen des Terminal-Fensters darf den Server nicht beenden.
  // Der leere Handler verhindert die Standardwirkung des Signals.
  if (signal === 'SIGHUP' && process.env.DONE_BAN_DETACHED === '1') {
    process.on('SIGHUP', () => {});
    continue;
  }
  process.on(signal, () => shutdown(`Signal ${signal} empfangen.`));
}
