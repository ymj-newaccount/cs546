// data/users.js
// Users data-access layer (aligned with config/mongoConnection.js getDb()).

import { getDb } from '../config/mongoConnection.js';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

// Ensure indexes are created only once per process.
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

// Used for login: do not enforce min length (avoid leaking rules), only enforce bcrypt limit + non-empty
function validatePasswordForLogin(password) {
  const p = assertNonEmptyString(password, 'password');
  const bytes = Buffer.byteLength(p, 'utf8');
  if (bytes > 72) throw makeError('password is too long (max 72 bytes for bcrypt)', 400);
  return p;
}

function ensureObjectId(id, fieldName = 'id') {
  const s = assertNonEmptyString(id, fieldName);
  if (!ObjectId.isValid(s)) throw makeError(`${fieldName} is not a valid ObjectId`, 400);
  return new ObjectId(s);
}

async function usersCollection() {
  const db = await getDb();
  const col = db.collection('users');

  if (!_indexesReady) {
    _indexesReady = (async () => {
      await col.createIndex({ usernameLower: 1 }, { unique: true });
      await col.createIndex({ emailLower: 1 }, { unique: true });
      await col.createIndex({ createdAt: -1 });
      await col.createIndex({ role: 1 });
    })();
  }
  await _indexesReady;

  return col;
}

function sanitizeUser(doc) {
  if (!doc) return doc;
  const out = { ...doc };
  if (out._id) out._id = out._id.toString();
  if(out.reputation === undefined || out.reputation === null)
  {
    out.reputation = 1;
  }
  out.reputation = Number(out.reputation);
  if(!Number.isFinite(out.reputation) || out.reputation < 0)
  {
    out.reputation = 1;
  }
  delete out.hashedPassword;
  delete out.usernameLower;
  delete out.emailLower;
  return out;
}

// ---------------------------
// Public API
// ---------------------------

export async function createUser(username, email, password) {
  const { username: u, usernameLower } = normalizeUsername(username);
  const { email: e, emailLower } = normalizeEmail(email);
  const p = validatePasswordForCreate(password);

  const col = await usersCollection();

  // Bootstrap: if no users exist yet, make the first user an admin
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
    reputation: 1,
    bookmarks: [],
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
  const sid = assertNonEmptyString(stationId, 'stationId');

  const col = await usersCollection();

  const result = await col.updateOne(
    { _id },
    { $addToSet: { bookmarks: sid }, $set: { updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) throw makeError('User not found', 404);
  return await getUserById(userId);
}

export async function removeBookmark(userId, stationId) {
  const _id = ensureObjectId(userId, 'userId');
  const sid = assertNonEmptyString(stationId, 'stationId');

  const col = await usersCollection();

  const result = await col.updateOne(
    { _id },
    { $pull: { bookmarks: sid }, $set: { updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) throw makeError('User not found', 404);
  return await getUserById(userId);
}

export async function setAlerts(userId, alertsArray) {
  const _id = ensureObjectId(userId, 'userId');

  if (!Array.isArray(alertsArray)) throw makeError('alerts must be an array', 400);
  if (alertsArray.length > 200) throw makeError('alerts array is too large', 400);

  const normalizedAlerts = alertsArray.map((a, idx) => {
    if (typeof a === 'string') return a.trim();
    if (isPlainObject(a)) return a;
    throw makeError(`alerts[${idx}] must be a string or a plain object`, 400);
  });

  const col = await usersCollection();

  const result = await col.updateOne(
    { _id },
    { $set: { alerts: normalizedAlerts, updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) throw makeError('User not found', 404);
  return await getUserById(userId);
}

//update reputation 
export async function updateReputation(userId, newRep)
{
  const id = ensureObjectId(userId, "userId");
  const rep = Number(newRep);
  if(!Number.isFinite(rep) || rep < 0)
  {
    throw makeError("Reputation must be a number >= 0", 400);
  }
  const users = await usersCollection();
  const result = await users.updateOne(
    {_id},
    { $set: {reputation: rep, updatedat: new Date()}}
  );
  if(result.matchedCount === 0)
  {
    throw makeError("User does not exist", 404);
  }
  return await getUserById(userId);
}
