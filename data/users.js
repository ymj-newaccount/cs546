// data/users.js
// Users data-access layer (aligned with config/mongoConnection.js getDb()).

import { getDb } from '../config/mongoConnection.js';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

const DEFAULT_REPUTATION = 1;
const MIN_REPUTATION = 0;

const MAX_ALERTS = 200;

// Ensure indexes are created only once per process.
// If index creation fails once, reset so a future call can retry.
let _indexesReady = null;

function makeError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string') throw makeError(`${fieldName} must be a string`, 400);
  const v = value.trim();
  if (!v) throw makeError(`${fieldName} cannot be empty`, 400);
  return v;
}

function normalizeUsername(username) {
  const u = assertNonEmptyString(username, 'username');
  if (u.length < 3 || u.length > 30) {
    throw makeError('username must be between 3 and 30 characters', 400);
  }
  if (!/^[a-zA-Z0-9_]+$/.test(u)) {
    throw makeError('username may only contain letters, numbers, and underscore', 400);
  }
  return { username: u, usernameLower: u.toLowerCase() };
}

function normalizeEmail(email) {
  const e = assertNonEmptyString(email, 'email');
  if (e.length > 254) throw makeError('email is too long', 400);
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  if (!ok) throw makeError('email is not valid', 400);
  return { email: e, emailLower: e.toLowerCase() };
}

// Used only for account creation
function validatePasswordForCreate(password) {
  const p = assertNonEmptyString(password, 'password');
  const bytes = Buffer.byteLength(p, 'utf8');
  if (bytes > 72) throw makeError('password is too long (max 72 bytes for bcrypt)', 400);
  if (p.length < 8) throw makeError('password must be at least 8 characters', 400);
  return p;
}

// Used for login: do not enforce min length, only enforce bcrypt limit + non-empty
function validatePasswordForLogin(password) {
  const p = assertNonEmptyString(password, 'password');
  const bytes = Buffer.byteLength(p, 'utf8');
  if (bytes > 72) throw makeError('password is too long (max 72 bytes for bcrypt)', 400);
  return p;
}

function ensureObjectId(id, fieldName = 'id') {
  if (id instanceof ObjectId) return id;
  const s = assertNonEmptyString(String(id ?? ''), fieldName);
  if (!ObjectId.isValid(s)) throw makeError(`${fieldName} is not a valid ObjectId`, 400);
  return new ObjectId(s);
}

function normalizeReputation(value, def = DEFAULT_REPUTATION) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_REPUTATION) return def;
  return n;
}

function normalizeCrossingKind(kind) {
  const k = assertNonEmptyString(kind, 'kind').toLowerCase();
  if (!['aps', 'ramp'].includes(k)) throw makeError('kind must be aps or ramp', 400);
  return k;
}

async function usersCollection(dbParam) {
  const db = dbParam || (await getDb());
  const col = db.collection('users');

  if (!_indexesReady) {
    _indexesReady = (async () => {
      await col.createIndex({ usernameLower: 1 }, { unique: true });
      await col.createIndex({ emailLower: 1 }, { unique: true });
      await col.createIndex({ createdAt: -1 });
      await col.createIndex({ role: 1 });
    })().catch((err) => {
      _indexesReady = null;
      throw err;
    });
  }

  await _indexesReady;
  return col;
}

function sanitizeUser(doc) {
  if (!doc) return doc;

  // Clone to avoid mutating the MongoDB document reference
  const out = { ...doc };

  // Normalize _id to string for consistent consumption in routes/views
  if (out._id && typeof out._id === 'object' && typeof out._id.toString === 'function') {
    out._id = out._id.toString();
  }

  // Normalize reputation to a safe default
  out.reputation = normalizeReputation(out.reputation, DEFAULT_REPUTATION);

  // Ensure bookmarks and alerts exist as arrays (defensive for legacy/dirty data)
  if (!Array.isArray(out.bookmarks)) out.bookmarks = [];
  if (!Array.isArray(out.alerts)) out.alerts = [];

  // Ensure crossingBookmarks has the expected plain-object shape
  // and always contains array fields for both aps and ramp.
  if (!isPlainObject(out.crossingBookmarks)) {
    out.crossingBookmarks = { aps: [], ramp: [] };
  } else {
    if (!Array.isArray(out.crossingBookmarks.aps)) out.crossingBookmarks.aps = [];
    if (!Array.isArray(out.crossingBookmarks.ramp)) out.crossingBookmarks.ramp = [];
  }

  // Remove sensitive/internal fields
  delete out.hashedPassword;
  delete out.usernameLower;
  delete out.emailLower;

  return out;
}

// MongoDB Node Driver compatibility:
// - Older drivers return { value: <doc>, ... } (ModifyResult)
// - Newer drivers (v6/v7) default to returning <doc> directly when includeResultMetadata is false
function unwrapFindOneAndUpdateResult(res) {
  if (!res) return null;

  const isModifyResult =
    typeof res === 'object' &&
    res !== null &&
    Object.prototype.hasOwnProperty.call(res, 'value') &&
    Object.prototype.hasOwnProperty.call(res, 'lastErrorObject');

  return isModifyResult ? (res.value ?? null) : res;
}

// ---------------------------
// Public API
// ---------------------------

export async function createUser(username, email, password) {
  const { username: u, usernameLower } = normalizeUsername(username);
  const { email: e, emailLower } = normalizeEmail(email);
  const p = validatePasswordForCreate(password);

  const col = await usersCollection();

  // Bootstrap: if no users exist yet, make the first user an admin.
  const userCount = await col.estimatedDocumentCount();
  const role = userCount === 0 ? 'admin' : 'user';

  const hashedPassword = await bcrypt.hash(p, SALT_ROUNDS);

  const now = new Date();
  const newUser = {
    username: u,
    usernameLower,
    email: e,
    emailLower,
    hashedPassword,
    role,
    reputation: DEFAULT_REPUTATION,
    bookmarks: [],
    // Stores followed crossings by kind (aps/ramp)
    crossingBookmarks: { aps: [], ramp: [] },
    alerts: [],
    createdAt: now,
    updatedAt: now
  };

  try {
    const insertInfo = await col.insertOne(newUser);
    if (!insertInfo.acknowledged) throw makeError('Could not add user', 500);

    const created = await col.findOne({ _id: insertInfo.insertedId });
    return sanitizeUser(created);
  } catch (err) {
    if (err && err.code === 11000) {
      throw makeError('Username or email already exists', 400);
    }
    throw err;
  }
}

export async function checkUser(username, password) {
  const { usernameLower } = normalizeUsername(username);
  const p = validatePasswordForLogin(password);

  const col = await usersCollection();

  const user = await col.findOne({ usernameLower });
  if (!user) throw makeError('Either the username or password is invalid', 401);

  const ok = await bcrypt.compare(p, user.hashedPassword);
  if (!ok) throw makeError('Either the username or password is invalid', 401);

  return sanitizeUser(user);
}

export async function getUserById(id) {
  const _id = ensureObjectId(id, 'userId');
  const col = await usersCollection();

  const user = await col.findOne({ _id });
  if (!user) throw makeError('User not found', 404);

  return sanitizeUser(user);
}

// Add a station to bookmarks (idempotent)
export async function addBookmark(userId, stationId) {
  const _id = ensureObjectId(userId, 'userId');
  const sid = assertNonEmptyString(String(stationId ?? ''), 'stationId');

  const col = await usersCollection();

  const result = await col.updateOne(
    { _id },
    { $addToSet: { bookmarks: sid }, $set: { updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) throw makeError('User not found', 404);
  return await getUserById(_id);
}

export async function removeBookmark(userId, stationId) {
  const _id = ensureObjectId(userId, 'userId');
  const sid = assertNonEmptyString(String(stationId ?? ''), 'stationId');

  const col = await usersCollection();

  const result = await col.updateOne(
    { _id },
    { $pull: { bookmarks: sid }, $set: { updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) throw makeError('User not found', 404);
  return await getUserById(_id);
}

// Add a crossing bookmark (idempotent) under crossingBookmarks.<kind>
export async function addCrossingBookmark(userId, kind, crossingId) {
  const _id = ensureObjectId(userId, 'userId');
  const k = normalizeCrossingKind(kind);
  const cid = assertNonEmptyString(String(crossingId ?? ''), 'crossingId');

  const col = await usersCollection();
  const path = `crossingBookmarks.${k}`;

  const result = await col.updateOne(
    { _id },
    { $addToSet: { [path]: cid }, $set: { updatedAt: new Date() } }
  );

  if (result.matchedCount === 0)
  {
    throw makeError('User not found', 404);
  }
  return await getUserById(_id);
}

// Remove a crossing bookmark from crossingBookmarks.<kind>
export async function removeCrossingBookmark(userId, kind, crossingId) {
  const _id = ensureObjectId(userId, 'userId');
  const k = normalizeCrossingKind(kind);
  const cid = assertNonEmptyString(String(crossingId ?? ''), 'crossingId');

  const col = await usersCollection();
  const path = `crossingBookmarks.${k}`;

  const result = await col.updateOne(
    { _id },
    { $pull: { [path]: cid }, $set: { updatedAt: new Date() } }
  );

  if (result.matchedCount === 0)
  {
    throw makeError('User not found', 404);
  }
  return await getUserById(_id);
}

export async function setAlerts(userId, alertsArray) {
  const _id = ensureObjectId(userId, 'userId');

  if (!Array.isArray(alertsArray)) throw makeError('alerts must be an array', 400);
  if (alertsArray.length > MAX_ALERTS * 2) throw makeError('alerts array is too large', 400);

  const normalizedAlerts = alertsArray
    .map((a, idx) => {
      if (typeof a === 'string') return a.trim();
      if (isPlainObject(a)) return a;
      throw makeError(`alerts[${idx}] must be a string or a plain object`, 400);
    })
    .filter((a) => (typeof a === 'string' ? a.length > 0 : true));

  if (normalizedAlerts.length > MAX_ALERTS) {
    throw makeError(`alerts array is too large (max ${MAX_ALERTS})`, 400);
  }

  const col = await usersCollection();

  const result = await col.updateOne(
    { _id },
    { $set: { alerts: normalizedAlerts, updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) throw makeError('User not found', 404);
  return await getUserById(_id);
}

// Set the user's reputation to an explicit value (>= 0).
export async function updateReputation(userId, newRep) {
  const _id = ensureObjectId(userId, 'userId');

  const rep = Number(newRep);
  if (!Number.isFinite(rep) || rep < MIN_REPUTATION) {
    throw makeError(`Reputation must be a number >= ${MIN_REPUTATION}`, 400);
  }

  const col = await usersCollection();

  const res = await col.findOneAndUpdate(
    { _id },
    { $set: { reputation: rep, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );

  const doc = unwrapFindOneAndUpdateResult(res);
  if (!doc) throw makeError('User not found', 404);

  return sanitizeUser(doc);
}

/**
 * Adjust reputation by a delta (can be positive or negative).
 * Atomic and clamped to MIN_REPUTATION. Optional max clamp supported.
 *
 * Example usage from routes:
 *   await adjustReputation(authorId, +0.1)
 *   await adjustReputation(authorId, -0.5, { max: 100 })
 */
export async function adjustReputation(userId, delta, options = {}) {
  const _id = ensureObjectId(userId, 'userId');

  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) {
    throw makeError('delta must be a finite non-zero number', 400);
  }

  const max = options?.max;
  const maxNum = max == null ? null : (Number.isFinite(Number(max)) ? Number(max) : null);
  if (max != null && maxNum === null) {
    throw makeError('options.max must be a finite number when provided', 400);
  }

  const col = await usersCollection();
  const now = new Date();

  // Use an aggregation pipeline update for atomic arithmetic + clamping
  const base = { $ifNull: ['$reputation', DEFAULT_REPUTATION] };
  const added = { $add: [base, d] };
  let nextRep = { $max: [MIN_REPUTATION, added] };
  if (maxNum !== null) nextRep = { $min: [maxNum, nextRep] };

  const res = await col.findOneAndUpdate(
    { _id },
    [
      {
        $set: {
          reputation: nextRep,
          updatedAt: now
        }
      }
    ],
    { returnDocument: 'after' }
  );

  const doc = unwrapFindOneAndUpdateResult(res);
  if (!doc) throw makeError('User not found', 404);

  return sanitizeUser(doc);
}
