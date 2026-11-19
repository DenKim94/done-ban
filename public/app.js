// app.js: Frontend-Logik von done-ban (Board, Drag-and-Drop, Dialoge, Live-Verbindung).

/** Die Spalten des Boards. Einzige Stelle, an der die Stati im Frontend stehen. */
const COLUMNS = [
  { key: 'OFFEN', label: 'Offen' },
  { key: 'IN_ARBEIT', label: 'In Arbeit' },
  { key: 'ON_HOLD', label: 'On Hold' },
  { key: 'CANCELED', label: 'Canceled' },
  { key: 'DONE', label: 'Done' }
];

const TAB_STORAGE_KEY = 'done-ban.activeStatus';
const TOAST_MS = 4000;

// --- Icons ---------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Icon-Satz aus dem Design-System: 24er Raster, Strichstaerke 2, currentColor. */
const ICONS = {
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  archive: [
    ['rect', { x: 3, y: 4, width: 18, height: 5, rx: 1 }],
    ['path', { d: 'M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4' }]
  ],
  edit: [['path', { d: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4' }]],
  link: [
    ['path', { d: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1' }],
    ['path', { d: 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1' }]
  ],
  calendar: [
    ['rect', { x: 3, y: 5, width: 18, height: 16, rx: 2 }],
    ['path', { d: 'M3 10h18M8 3v4M16 3v4' }]
  ],
  warning: [
    ['path', { d: 'M12 3.5 21.5 20h-19L12 3.5z' }],
    ['path', { d: 'M12 10v4M12 17h.01' }]
  ],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7' }]],
  sort: [['path', { d: 'M7 4v16M3 16l4 4 4-4M14 6h7M14 12h5M14 18h3' }]],
  sortAsc: [['path', { d: 'M7 20V4M3 8l4-4 4 4M14 6h3M14 12h5M14 18h7' }]],
  close: [['path', { d: 'M6 6l12 12M18 6 6 18' }]],
  trash: [
    ['path', { d: 'M4 7h16M10 11v6M14 11v6' }],
    ['path', { d: 'M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3' }]
  ]
};

/** Baut ein Inline-SVG aus dem Icon-Satz. */
function createIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attributes] of ICONS[name] ?? []) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [name_, value] of Object.entries(attributes)) {
      shape.setAttribute(name_, String(value));
    }
    svg.append(shape);
  }
  return svg;
}

/** Ersetzt alle Platzhalter <span data-icon="..."> durch das jeweilige Icon. */
function renderIconSlots(root) {
  for (const slot of root.querySelectorAll('[data-icon]')) {
    slot.replaceWith(createIcon(slot.dataset.icon));
  }
}

// --- API-Helfer ----------------------------------------------------------

/**
 * Kapselt fetch: setzt den Content-Type, wirft bei Fehlern die Servermeldung
 * und liefert bei 204 den Wert null.
 */
async function api(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    let message = `Der Server hat mit Fehler ${response.status} geantwortet.`;
    try {
      const data = await response.json();
      if (data && typeof data.error === 'string') message = data.error;
    } catch {
      // Die Antwort war kein JSON, die Standardmeldung bleibt bestehen.
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

// --- Datum und Links -----------------------------------------------------

/** Wandelt 'YYYY-MM-DD' in 'TT.MM.JJJJ' um, ohne Zeitzonen-Umrechnung. */
function formatDate(iso) {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

/** Heutiges Datum als lokaler ISO-String fuer den Vergleich mit dueDate. */
function todayIso() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Rechnet einen UTC-Zeitstempel aus SQLite in Ortszeit um. */
function formatTimestamp(value) {
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Ueberfaellig: Zieldatum vor heute und noch nicht abgeschlossen. */
function isOverdue(todo) {
  return (
    todo.status !== 'DONE' &&
    todo.status !== 'CANCELED' &&
    todo.dueDate < todayIso()
  );
}

/** Liefert die URL nur zurueck, wenn sie sicher ist (nur http und https). */
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// --- Zustand -------------------------------------------------------------

const elements = {
  board: document.getElementById('board'),
  tabs: document.getElementById('status-tabs'),
  banner: document.getElementById('connection-banner'),
  archiveButton: document.getElementById('archive-button'),
  archiveCount: document.getElementById('archive-count'),
  newButton: document.getElementById('new-button'),
  todoDialog: document.getElementById('todo-dialog'),
  todoForm: document.getElementById('todo-form'),
  todoTitle: document.getElementById('todo-dialog-title'),
  todoError: document.getElementById('todo-error'),
  todoErrorText: document.getElementById('todo-error-text'),
  todoCancel: document.getElementById('todo-cancel'),
  title: document.getElementById('field-title'),
  description: document.getElementById('field-description'),
  tag: document.getElementById('field-tag'),
  dueDate: document.getElementById('field-due-date'),
  status: document.getElementById('field-status'),
  statusWrapper: document.getElementById('field-status-wrapper'),
  dateRow: document.getElementById('field-row-date'),
  links: document.getElementById('field-links'),
  archiveDialog: document.getElementById('archive-dialog'),
  archiveTitle: document.getElementById('archive-dialog-title'),
  archiveBody: document.getElementById('archive-body'),
  archiveClear: document.getElementById('archive-clear'),
  archiveClose: document.getElementById('archive-close'),
  detailDialog: document.getElementById('detail-dialog'),
  detailTitle: document.getElementById('detail-title'),
  detailTag: document.getElementById('detail-tag'),
  detailDescription: document.getElementById('detail-description'),
  detailLinks: document.getElementById('detail-links'),
  detailMeta: document.getElementById('detail-meta'),
  detailClose: document.getElementById('detail-close'),
  tagbar: document.getElementById('tagbar'),
  tagbarList: document.getElementById('tagbar-list'),
  confirmDialog: document.getElementById('confirm-dialog'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmQuestion: document.getElementById('confirm-question'),
  confirmSubject: document.getElementById('confirm-subject'),
  confirmHint: document.getElementById('confirm-hint'),
  confirmCancel: document.getElementById('confirm-cancel'),
  confirmOk: document.getElementById('confirm-ok')
};

/** Die zuletzt geladenen To-Dos, Schluessel ist die ID. */
let todosById = new Map();
let editingId = null;
let activeStatus = readActiveStatus();
/** Sortierrichtung je Spalte, Standard ist absteigend (spaetestes Datum oben). */
const sortDirections = new Map(COLUMNS.map((column) => [column.key, 'desc']));
/** Aktiver Tag-Filter, null bedeutet: alle Karten sichtbar. */
let activeTag = null;
let dragState = null;
let placeholder = null;
let reloadPending = false;
let wasDisconnected = false;
let toastTimer = null;
/* Die Verbindung wird in einer Variablen gehalten. Ohne eigene Referenz darf der
   Browser ein EventSource ohne message-Listener nach einem Abbruch verwerfen,
   dann gaebe es weder einen Wiederverbindungsversuch noch das Verbindungs-Banner. */
let eventSource = null;

/** Liest den zuletzt gewaehlten Status-Tab, Standard ist OFFEN. */
function readActiveStatus() {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored && COLUMNS.some((column) => column.key === stored)) return stored;
  } catch {
    // localStorage kann gesperrt sein, dann gilt der Standard.
  }
  return 'OFFEN';
}

// --- Board aufbauen ------------------------------------------------------

/** Erzeugt Tabs und Spalten einmalig aus COLUMNS. */
function buildBoard() {
  for (const column of COLUMNS) {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.dataset.status = column.key;
    tab.append(document.createTextNode(`${column.label} `));
    const count = document.createElement('span');
    count.className = 'tab__count';
    count.dataset.tabCount = column.key;
    count.textContent = '0';
    tab.append(count);
    tab.addEventListener('click', () => setActiveStatus(column.key));
    elements.tabs.append(tab);

    const section = document.createElement('section');
    section.className = 'column';
    section.dataset.status = column.key;
    const titleId = `column-title-${column.key.toLowerCase()}`;
    section.setAttribute('aria-labelledby', titleId);

    const head = document.createElement('header');
    head.className = 'column__head';
    const title = document.createElement('h2');
    title.className = 'column__title';
    title.id = titleId;
    title.textContent = column.label;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.columnCount = column.key;
    badge.textContent = '0';
    const sortButton = document.createElement('button');
    sortButton.className = 'btn btn--ghost btn--sm column__sort';
    sortButton.type = 'button';
    sortButton.dataset.sort = column.key;
    sortButton.addEventListener('click', () => sortColumn(column.key));
    head.append(title, badge, sortButton);

    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.dataset.cards = column.key;

    section.append(head, cards);
    attachDropHandlers(section, column.key);
    elements.board.append(section);
    // Erst jetzt beschriften: vorher findet die Suche im Board den Button nicht.
    updateSortButton(column.key);

    const option = document.createElement('option');
    option.value = column.key;
    option.textContent = column.label;
    elements.status.append(option);
  }
  setActiveStatus(activeStatus);
}

/** Schaltet in der schmalen Ansicht auf eine andere Spalte um. */
function setActiveStatus(status) {
  activeStatus = status;
  try {
    localStorage.setItem(TAB_STORAGE_KEY, status);
  } catch {
    // Ohne localStorage geht nur die Erinnerung an den Tab verloren.
  }
  for (const tab of elements.tabs.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.status === status));
  }
  for (const section of elements.board.querySelectorAll('.column')) {
    section.classList.toggle('is-active', section.dataset.status === status);
  }
}

// --- Karten --------------------------------------------------------------

/** Baut die Karte eines To-Dos. Nutzerdaten nur ueber textContent. */
function createCard(todo) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = String(todo.id);
  card.draggable = true;
  card.tabIndex = 0;
  const overdue = isOverdue(todo);
  if (overdue) card.classList.add('card--overdue');
  if (todo.status === 'DONE') card.classList.add('card--done');
  if (todo.status === 'CANCELED') card.classList.add('card--canceled');

  // Auf der Uebersicht steht nur der Titel, die Beschreibung zeigt der Dialog.
  const title = document.createElement('p');
  title.className = 'card__desc';
  if (todo.status === 'DONE') title.append(createIcon('check'));
  title.append(document.createTextNode(todo.title));
  if (todo.description) card.title = todo.description;
  card.append(title);

  if (todo.tag) {
    const tag = document.createElement('span');
    tag.className = 'card__tag';
    tag.textContent = `#${todo.tag}`;
    card.append(tag);
  }

  const links = todo.links.map((value) => [value, safeUrl(value)]).filter(([, url]) => url);
  if (links.length > 0) {
    const list = document.createElement('ul');
    list.className = 'card__links';
    for (const [value, url] of links) {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.className = 'card__link';
      anchor.href = url.href;
      anchor.title = value;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.draggable = false;
      anchor.append(createIcon('link'), document.createTextNode(url.hostname));
      item.append(anchor);
      list.append(item);
    }
    card.append(list);
  }

  const footer = document.createElement('div');
  footer.className = 'card__footer';
  const date = document.createElement('span');
  date.className = 'card__date';
  date.append(createIcon(overdue ? 'warning' : 'calendar'));
  date.append(document.createTextNode(`Zieldatum: ${formatDate(todo.dueDate)}`));
  if (overdue) {
    const hint = document.createElement('span');
    hint.className = 'sr-only';
    hint.textContent = ', überfällig';
    date.append(hint);
  }

  const actions = document.createElement('div');
  actions.className = 'card__actions';
  const editButton = document.createElement('button');
  editButton.className = 'btn btn--ghost btn--sm';
  editButton.type = 'button';
  editButton.textContent = 'Bearbeiten';
  editButton.addEventListener('click', () => openTodoDialog(todo.id));
  actions.append(editButton);
  if (todo.status === 'DONE') {
    const archiveButton = document.createElement('button');
    archiveButton.className = 'btn btn--ghost btn--sm';
    archiveButton.type = 'button';
    archiveButton.textContent = 'Archivieren';
    archiveButton.addEventListener('click', () => archiveTodo(todo.id));
    actions.append(archiveButton);
  }
  const deleteButton = document.createElement('button');
  deleteButton.className = 'btn btn--ghost btn--ghost-danger btn--sm';
  deleteButton.type = 'button';
  deleteButton.title = 'To-Do löschen';
  deleteButton.setAttribute('aria-label', `To-Do löschen: ${todo.title}`);
  deleteButton.append(createIcon('trash'));
  deleteButton.addEventListener('click', () => deleteTodo(todo));
  actions.append(deleteButton);
  footer.append(date, actions);
  card.append(footer);

  card.addEventListener('dblclick', () => openTodoDialog(todo.id));
  card.addEventListener('dragstart', (event) => {
    dragState = { id: todo.id, element: card };
    card.classList.add('is-dragging');
    event.dataTransfer.setData('text/plain', String(todo.id));
    event.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', endDrag);
  return card;
}

// --- Daten laden und anzeigen -------------------------------------------

async function loadBoard() {
  let data;
  try {
    data = await api('/api/todos');
  } catch (error) {
    showToast(error.message);
    return;
  }
  todosById = new Map(data.todos.map((todo) => [todo.id, todo]));
  renderBoard(data.todos);
  renderArchiveCount(data.archivedCount);
}

function renderBoard(todos) {
  for (const column of COLUMNS) {
    const list = elements.board.querySelector(`[data-cards="${column.key}"]`);
    const cards = todos.filter((todo) => todo.status === column.key);
    // Alle Karten bleiben im DOM, gefilterte werden nur ausgeblendet.
    // So stimmt der Zielindex beim Verschieben auch bei aktivem Filter.
    const elemente = cards.map((todo) => {
      const card = createCard(todo);
      if (activeTag !== null && todo.tag !== activeTag) card.classList.add('card--hidden');
      return card;
    });
    list.replaceChildren(...elemente);
    const sichtbar = activeTag === null ? cards.length : cards.filter((t) => t.tag === activeTag).length;
    list.classList.toggle('cards--filtered-empty', cards.length > 0 && sichtbar === 0);
    elements.board.querySelector(`[data-column-count="${column.key}"]`).textContent = String(sichtbar);
    elements.tabs.querySelector(`[data-tab-count="${column.key}"]`).textContent = String(sichtbar);
  }
  renderTagbar(todos);
}

/** Baut die Leiste mit allen vergebenen Tags. Ein Klick filtert das Board. */
function renderTagbar(todos) {
  const counts = new Map();
  for (const todo of todos) {
    if (todo.tag) counts.set(todo.tag, (counts.get(todo.tag) ?? 0) + 1);
  }
  if (counts.size === 0) {
    elements.tagbar.hidden = true;
    elements.tagbarList.replaceChildren();
    // Ein Filter auf einen Tag, den es nicht mehr gibt, wird aufgehoben.
    if (activeTag !== null) activeTag = null;
    return;
  }
  if (activeTag !== null && !counts.has(activeTag)) activeTag = null;
  elements.tagbar.hidden = false;

  const chips = [];
  const alle = document.createElement('button');
  alle.className = 'tagchip';
  alle.type = 'button';
  alle.setAttribute('aria-pressed', String(activeTag === null));
  alle.append(document.createTextNode('Alle'));
  alle.addEventListener('click', () => setActiveTag(null));
  chips.push(alle);

  for (const [tag, anzahl] of [...counts].sort((a, b) => a[0].localeCompare(b[0], 'de'))) {
    const chip = document.createElement('button');
    chip.className = 'tagchip';
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(activeTag === tag));
    chip.append(document.createTextNode(`#${tag}`));
    const count = document.createElement('span');
    count.className = 'tagchip__count';
    count.textContent = String(anzahl);
    chip.append(count);
    // Ein erneuter Klick auf den aktiven Tag hebt den Filter wieder auf.
    chip.addEventListener('click', () => setActiveTag(activeTag === tag ? null : tag));
    chips.push(chip);
  }
  elements.tagbarList.replaceChildren(...chips);
}

/** Setzt den Tag-Filter und zeichnet das Board neu. */
function setActiveTag(tag) {
  activeTag = tag;
  renderBoard([...todosById.values()]);
}

function renderArchiveCount(count) {
  elements.archiveCount.textContent = String(count);
  elements.archiveButton.setAttribute(
    'aria-label',
    count === 1 ? 'Archiv, 1 Eintrag' : `Archiv, ${count} Einträge`
  );
}

// --- Aktionen ------------------------------------------------------------

/** Beschriftet den Sortier-Button mit der Richtung, die der naechste Klick herstellt. */
function updateSortButton(status) {
  const button = elements.board.querySelector(`[data-sort="${status}"]`);
  if (!button) return;
  const aufsteigend = sortDirections.get(status) === 'asc';
  button.replaceChildren(
    createIcon(aufsteigend ? 'sortAsc' : 'sort'),
    document.createTextNode(aufsteigend ? 'Älteste zuerst' : 'Neueste zuerst')
  );
  button.title = aufsteigend
    ? 'Nach Zieldatum sortieren: älteste zuerst'
    : 'Nach Zieldatum sortieren: neueste zuerst';
}

/** Sortiert die Spalte und schaltet die Richtung fuer den naechsten Klick um. */
async function sortColumn(status) {
  const direction = sortDirections.get(status) ?? 'desc';
  try {
    await api(`/api/columns/${status}/sort`, 'POST', { direction });
    sortDirections.set(status, direction === 'desc' ? 'asc' : 'desc');
    updateSortButton(status);
  } catch (error) {
    showToast(error.message);
  }
  await loadBoard();
}

async function archiveTodo(id) {
  try {
    await api(`/api/todos/${id}/archive`, 'POST');
  } catch (error) {
    showToast(error.message);
  }
  await loadBoard();
}

/** Loescht ein To-Do endgueltig, nach einer Sicherheitsabfrage. */
async function deleteTodo(todo) {
  const confirmed = await askConfirm({
    heading: 'To-Do löschen',
    question: 'Soll dieses To-Do endgültig gelöscht werden?',
    subject: todo.title,
    confirmLabel: 'Löschen'
  });
  if (!confirmed) return;
  try {
    await api(`/api/todos/${todo.id}`, 'DELETE');
  } catch (error) {
    showToast(error.message);
  }
  await loadBoard();
}

// --- Drag-and-Drop -------------------------------------------------------

/** Haengt die Drop-Behandlung an die ganze Spalte, nicht nur an die Kartenliste. */
function attachDropHandlers(section, status) {
  const list = section.querySelector('.cards');

  section.addEventListener('dragover', (event) => {
    if (!dragState) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    section.classList.add('column--drop');
    const next = cardAfterPoint(list, event.clientY);
    const marker = ensurePlaceholder();
    if (next) list.insertBefore(marker, next);
    else list.append(marker);
  });

  section.addEventListener('dragleave', (event) => {
    if (!section.contains(event.relatedTarget)) section.classList.remove('column--drop');
  });

  section.addEventListener('drop', (event) => {
    if (!dragState) return;
    event.preventDefault();
    void dropCard(list, status);
  });
}

/** Erste Karte, deren vertikale Mitte unterhalb des Zeigers liegt. */
function cardAfterPoint(list, clientY) {
  const cards = [...list.querySelectorAll('.card:not(.is-dragging)')];
  return (
    cards.find((card) => {
      const box = card.getBoundingClientRect();
      return clientY < box.top + box.height / 2;
    }) ?? null
  );
}

/** Platzhalter in der Hoehe der gezogenen Karte. */
function ensurePlaceholder() {
  if (!placeholder) {
    placeholder = document.createElement('div');
    placeholder.className = 'placeholder';
  }
  const height = dragState.element.getBoundingClientRect().height;
  placeholder.style.setProperty('--placeholder-h', `${Math.round(height)}px`);
  return placeholder;
}

async function dropCard(list, status) {
  const card = dragState.element;
  const id = dragState.id;
  let index = 0;
  for (const child of list.children) {
    if (child === placeholder) break;
    if (child.classList.contains('card') && child !== card) index += 1;
  }
  // Optimistisch an die Stelle des Platzhalters setzen.
  if (placeholder && placeholder.parentNode) placeholder.replaceWith(card);
  else list.append(card);
  endDrag();
  try {
    await api(`/api/todos/${id}/position`, 'PATCH', { status, index });
  } catch (error) {
    showToast(error.message);
  }
  await loadBoard();
}

function endDrag() {
  if (dragState) dragState.element.classList.remove('is-dragging');
  if (placeholder && placeholder.parentNode) placeholder.remove();
  for (const section of elements.board.querySelectorAll('.column--drop')) {
    section.classList.remove('column--drop');
  }
  dragState = null;
  if (reloadPending) {
    reloadPending = false;
    void loadBoard();
  }
}

// --- Dialog zum Anlegen und Bearbeiten -----------------------------------

function openTodoDialog(id = null) {
  editingId = id;
  const todo = id === null ? null : todosById.get(id);
  elements.todoTitle.textContent = todo ? 'To-Do bearbeiten' : 'Neues To-Do';
  // Neue To-Dos starten immer in Offen, deshalb entfaellt die Auswahl hier.
  // Beim Bearbeiten bleibt sie: Per Tastatur und auf schmalen Bildschirmen
  // ist sie der einzige Weg, den Status zu aendern.
  elements.statusWrapper.hidden = !todo;
  elements.dateRow.classList.toggle('field-row--single', !todo);
  elements.title.value = todo ? todo.title : '';
  elements.tag.value = todo && todo.tag ? `#${todo.tag}` : '';
  elements.description.value = todo ? todo.description : '';
  elements.dueDate.value = todo ? todo.dueDate : '';
  elements.status.value = todo ? todo.status : 'OFFEN';
  elements.links.value = todo ? todo.links.join('\n') : '';
  hideFormError();
  elements.todoDialog.showModal();
  elements.title.focus();
}

function showFormError(message) {
  elements.todoErrorText.textContent = message;
  elements.todoError.hidden = false;
}

function hideFormError() {
  elements.todoErrorText.textContent = '';
  elements.todoError.hidden = true;
}

async function submitTodo(event) {
  event.preventDefault();
  const payload = {
    title: elements.title.value,
    description: elements.description.value,
    tag: elements.tag.value,
    dueDate: elements.dueDate.value,
    // Links werden bewusst ungeprueft gesendet, damit die Servermeldung erscheint.
    links: elements.links.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  };
  // Ohne Angabe legt der Server das To-Do in Offen an.
  if (editingId !== null) payload.status = elements.status.value;
  try {
    if (editingId === null) await api('/api/todos', 'POST', payload);
    else await api(`/api/todos/${editingId}`, 'PUT', payload);
  } catch (error) {
    showFormError(error.message);
    return;
  }
  elements.todoDialog.close();
  await loadBoard();
}

// --- Archiv-Dialog -------------------------------------------------------

async function openArchive() {
  let entries;
  try {
    entries = await api('/api/archive');
  } catch (error) {
    showToast(error.message);
    return;
  }
  renderArchive(entries);
  elements.archiveDialog.showModal();
}

function renderArchive(entries) {
  elements.archiveTitle.textContent = `Archiv (${entries.length})`;
  elements.archiveClear.disabled = entries.length === 0;
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const text = document.createElement('p');
    text.style.margin = '0';
    text.textContent = 'Das Archiv ist leer.';
    empty.append(createIcon('check'), text);
    elements.archiveBody.replaceChildren(empty);
    return;
  }
  elements.archiveBody.replaceChildren(...entries.map(createArchiveCard));
}

/** Baut eine anklickbare Karte fuer einen archivierten Eintrag. */
function createArchiveCard(entry) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card card--archive';
  card.dataset.id = String(entry.id);
  card.setAttribute('aria-label', `${entry.title} – Details anzeigen`);

  const title = document.createElement('p');
  title.className = 'card__desc';
  title.append(createIcon('check'), document.createTextNode(entry.title));
  card.append(title);

  if (entry.tag) {
    const tag = document.createElement('span');
    tag.className = 'card__tag';
    tag.textContent = `#${entry.tag}`;
    card.append(tag);
  }

  const footer = document.createElement('div');
  footer.className = 'card__footer';
  const due = document.createElement('span');
  due.className = 'card__date';
  due.append(createIcon('calendar'), document.createTextNode(`Zieldatum: ${formatDate(entry.dueDate)}`));
  const archived = document.createElement('span');
  archived.className = 'card__date';
  archived.append(
    createIcon('archive'),
    document.createTextNode(`Archiviert: ${formatTimestamp(entry.archivedAt)}`)
  );
  footer.append(due, archived);
  card.append(footer);

  card.addEventListener('click', () => openDetail(entry));
  return card;
}

/** Zeigt einen archivierten Eintrag mit seiner vollen Beschreibung. */
function openDetail(entry) {
  elements.detailTitle.textContent = entry.title;

  elements.detailTag.textContent = entry.tag ? `#${entry.tag}` : '';
  elements.detailTag.hidden = !entry.tag;

  const hasDescription = Boolean(entry.description);
  elements.detailDescription.textContent = hasDescription
    ? entry.description
    : 'Keine Beschreibung hinterlegt.';
  elements.detailDescription.classList.toggle('detail__description--empty', !hasDescription);

  const links = entry.links.map((value) => [value, safeUrl(value)]).filter(([, url]) => url);
  elements.detailLinks.replaceChildren(
    ...links.map(([value, url]) => {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.className = 'card__link';
      anchor.href = url.href;
      anchor.title = value;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.append(createIcon('link'), document.createTextNode(url.hostname));
      item.append(anchor);
      return item;
    })
  );
  elements.detailLinks.hidden = links.length === 0;

  const meta = [
    ['Zieldatum', formatDate(entry.dueDate)],
    ['Archiviert', formatTimestamp(entry.archivedAt)]
  ];
  elements.detailMeta.replaceChildren(
    ...meta.flatMap(([label, value]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const definition = document.createElement('dd');
      definition.textContent = value;
      return [term, definition];
    })
  );

  elements.detailDialog.showModal();
  elements.detailClose.focus();
}

async function clearArchive() {
  const confirmed = await askConfirm({
    heading: 'Archiv leeren',
    question: 'Archiv endgültig leeren?',
    confirmLabel: 'Archiv leeren'
  });
  if (!confirmed) return;
  try {
    await api('/api/archive', 'DELETE');
  } catch (error) {
    showToast(error.message);
    return;
  }
  renderArchive([]);
  await loadBoard();
}

// --- Sicherheitsabfrage --------------------------------------------------

/**
 * Zeigt die Sicherheitsabfrage im Design der Anwendung und wartet auf die Antwort.
 * @returns {Promise<boolean>} true, wenn bestaetigt wurde
 */
function askConfirm({ heading, question, subject, confirmLabel }) {
  elements.confirmTitle.textContent = heading;
  elements.confirmQuestion.textContent = question;
  elements.confirmSubject.textContent = subject ?? '';
  elements.confirmSubject.hidden = !subject;
  elements.confirmHint.textContent = 'Das kann nicht rückgängig gemacht werden.';
  elements.confirmOk.textContent = confirmLabel;

  return new Promise((resolve) => {
    const beenden = (antwort) => {
      elements.confirmCancel.removeEventListener('click', beiAbbruch);
      elements.confirmOk.removeEventListener('click', beiBestaetigung);
      elements.confirmDialog.removeEventListener('close', beiSchliessen);
      if (elements.confirmDialog.open) elements.confirmDialog.close();
      resolve(antwort);
    };
    const beiAbbruch = () => beenden(false);
    const beiBestaetigung = () => beenden(true);
    // Deckt auch die Escape-Taste ab, die der Browser selbst behandelt.
    const beiSchliessen = () => beenden(false);
    elements.confirmCancel.addEventListener('click', beiAbbruch);
    elements.confirmOk.addEventListener('click', beiBestaetigung);
    elements.confirmDialog.addEventListener('close', beiSchliessen);
    elements.confirmDialog.showModal();
    elements.confirmCancel.focus();
  });
}

// --- Toast ---------------------------------------------------------------

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast toast--fixed';
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), TOAST_MS);
}

// --- Live-Verbindung -----------------------------------------------------

function connect() {
  eventSource = new EventSource('/api/events');
  eventSource.addEventListener('change', () => {
    // Waehrend eines laufenden Drags wird das Neuladen verschoben.
    if (dragState) reloadPending = true;
    else void loadBoard();
  });
  eventSource.addEventListener('open', () => {
    elements.banner.hidden = true;
    if (wasDisconnected) {
      wasDisconnected = false;
      void loadBoard();
    }
  });
  eventSource.addEventListener('error', () => {
    wasDisconnected = true;
    elements.banner.hidden = false;
  });
}

// --- Start ---------------------------------------------------------------

renderIconSlots(document.body);
buildBoard();
elements.newButton.addEventListener('click', () => openTodoDialog(null));
elements.todoForm.addEventListener('submit', submitTodo);
elements.todoCancel.addEventListener('click', () => elements.todoDialog.close());
elements.archiveButton.addEventListener('click', openArchive);
elements.archiveClear.addEventListener('click', clearArchive);
elements.archiveClose.addEventListener('click', () => elements.archiveDialog.close());
elements.detailClose.addEventListener('click', () => elements.detailDialog.close());
void loadBoard();
connect();
