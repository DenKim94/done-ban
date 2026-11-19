// validation.js: Prueft die Eingaben fuer To-Dos (Beschreibung, Zieldatum, Links, Status).

import { STATUSES } from './db.js';

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 1000;
const MAX_LINKS = 20;
const MAX_TAG = 32;

/** Erlaubte Zeichen im Tag: Buchstaben, Ziffern, Bindestrich, Unterstrich. */
const TAG_PATTERN = /^[\p{L}\p{N}_-]+$/u;

/**
 * Normalisiert einen Tag: fuehrende Rauten und Leerzeichen entfallen.
 * Aus "#Arbeit" und "Arbeit" wird einheitlich "Arbeit".
 */
export function normalizeTag(value) {
  return String(value ?? '').trim().replace(/^#+/, '').trim();
}

/** Prueft, ob der String ein real existierendes Datum im Format YYYY-MM-DD ist. */
export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Prueft, ob eine URL geladen werden darf (nur http und https). */
export function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Prueft einen Request-Body fuer POST und PUT.
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function validateTodo(body) {
  const errors = [];
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  // Titel
  let title = '';
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    errors.push('Der Titel fehlt.');
  } else {
    title = input.title.trim();
    if (title.length > MAX_TITLE) {
      errors.push(`Der Titel darf höchstens ${MAX_TITLE} Zeichen lang sein.`);
    }
  }

  // Beschreibung
  let description = '';
  if (typeof input.description !== 'string' || input.description.trim() === '') {
    errors.push('Die Beschreibung fehlt.');
  } else {
    description = input.description.trim();
    if (description.length > MAX_DESCRIPTION) {
      errors.push(`Die Beschreibung darf höchstens ${MAX_DESCRIPTION} Zeichen lang sein.`);
    }
  }

  // Tag (optional, ein einzelnes Schlagwort ohne Raute gespeichert)
  let tag = null;
  if (input.tag !== undefined && input.tag !== null && String(input.tag).trim() !== '') {
    const candidate = normalizeTag(input.tag);
    if (candidate === '') {
      errors.push('Der Tag besteht nur aus Rauten.');
    } else if (candidate.length > MAX_TAG) {
      errors.push(`Der Tag darf höchstens ${MAX_TAG} Zeichen lang sein.`);
    } else if (!TAG_PATTERN.test(candidate)) {
      errors.push('Der Tag darf nur Buchstaben, Ziffern, Bindestrich und Unterstrich enthalten.');
    } else {
      tag = candidate;
    }
  }

  // Zieldatum
  const dueDate = input.dueDate;
  if (!isValidDate(dueDate)) {
    errors.push('Das Zieldatum fehlt oder ist ungültig.');
  }

  // Links
  let links = [];
  if (input.links !== undefined && input.links !== null) {
    if (!Array.isArray(input.links)) {
      errors.push('Die Links müssen als Liste übergeben werden.');
    } else {
      const candidates = input.links
        .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()))
        .filter((entry) => entry !== '');
      const invalid = candidates.filter((entry) => !isValidUrl(entry));
      if (invalid.length > 0) {
        errors.push(`Ungültige Links (nur http/https erlaubt): ${invalid.join(', ')}`);
      }
      if (candidates.length > MAX_LINKS) {
        errors.push(`Es sind höchstens ${MAX_LINKS} Links erlaubt.`);
      }
      links = candidates.filter((entry) => isValidUrl(entry));
    }
  }

  // Status
  let status;
  if (input.status !== undefined && input.status !== null && input.status !== '') {
    if (typeof input.status !== 'string' || !STATUSES.includes(input.status)) {
      errors.push('Ungültiger Status.');
    } else {
      status = input.status;
    }
  }

  if (errors.length > 0) return { ok: false, error: errors.join(' ') };
  return { ok: true, value: { title, description, tag, dueDate, links, status } };
}
