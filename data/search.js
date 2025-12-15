// data/search.js
// Data-layer helpers for Home (/search) lookups.
// Keeps route handlers thin and preserves the “3-layer” structure.
//
// Collections used (per your current seed/import):
//   - stations
//   - aps_locations
//   - curb_ramps
//
// Design notes:
// - IDs in the datasets are often uppercase (e.g., "R01"), while users may type "r01".
//   We handle common casing differences via small ID-variant matching.
// - For text matching we escape RegExp input to avoid regex injection.
// - Curb ramp collections can be large; fuzzy search is guarded to reduce heavy scans.

import { getDb } from '../config/mongoConnection.js';

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

/** Normalize user input used for queries. */
function normalizeQuery(q) {
  return String(q ?? '').replace(/\s+/g, ' ').trim();
}

/** Escape a string so it can be safely used inside a RegExp. */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" regex. */
function makeContainsRegex(q) {
  return new RegExp(escapeRegex(q), 'i');
}

/** Clamp the maximum number of returned results. */
function clampLimit(limit, fallback = DEFAULT_LIMIT) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/**
 * Return ID variants to handle common user input casing differences.
 * Example: "r01" -> ["r01", "R01", "r01"] (de-duped)
 */
function makeIdVariants(id) {
  const raw = normalizeQuery(id);
  if (!raw) return [];

  const variants = new Set([raw, raw.toUpperCase(), raw.toLowerCase()]);
  return Array.from(variants).filter(Boolean);
}

/**
 * Heuristic: treat queries with no whitespace and a reasonable length as "ID-like".
 * Used to decide when to attempt exact-ID lookups on very large collections.
 */
function isIdLike(q) {
  const qq = normalizeQuery(q);
  return Boolean(qq) && !/\s/.test(qq) && qq.length <= 40;
}

// ------------------------------
// Exact find helpers (return null if not found)
// ------------------------------

export async function findStationById(stationId) {
  const variants = makeIdVariants(stationId);
  if (variants.length === 0) return null;

  const db = await getDb();
  return db.collection('stations').findOne(
    { stationId: { $in: variants } },
    { projection: { _id: 0, stationId: 1, stationName: 1 } }
  );
}

export async function findAPSById(apsId) {
  const variants = makeIdVariants(apsId);
  if (variants.length === 0) return null;

  const db = await getDb();
  return db.collection('aps_locations').findOne(
    { apsId: { $in: variants } },
    { projection: { _id: 0, apsId: 1 } }
  );
}

export async function findRampById(rampId) {
  const variants = makeIdVariants(rampId);
  if (variants.length === 0) return null;

  const db = await getDb();
  return db.collection('curb_ramps').findOne(
    { rampId: { $in: variants } },
    { projection: { _id: 0, rampId: 1 } }
  );
}

// ------------------------------
// Fuzzy search helpers (small result sets)
// ------------------------------

export async function searchStations(q, limit = DEFAULT_LIMIT) {
  const qq = normalizeQuery(q);
  if (qq.length < 2) return [];

  const db = await getDb();
  const col = db.collection('stations');

  const rx = makeContainsRegex(qq);
  const idVariants = makeIdVariants(qq);

  const or = [];
  if (idVariants.length) or.push({ stationId: { $in: idVariants } });
  or.push({ stationName: { $regex: rx } });

  return col
    .find(
      { $or: or },
      {
        projection: {
          _id: 0,
          stationId: 1,
          stationName: 1,
          borough: 1,
          line: 1,
          adaStatus: 1
        }
      }
    )
    .limit(clampLimit(limit))
    .toArray();
}

export async function searchAPS(q, limit = DEFAULT_LIMIT) {
  const qq = normalizeQuery(q);
  if (qq.length < 2) return [];

  const db = await getDb();
  const col = db.collection('aps_locations');

  const rx = makeContainsRegex(qq);
  const idVariants = makeIdVariants(qq);

  // Seed format expected:
  //   { apsId, location: { address, borough, lat, lng } }
  const or = [];
  if (idVariants.length) or.push({ apsId: { $in: idVariants } });
  or.push({ 'location.address': { $regex: rx } });
  // Optional: allow borough matches (low-cost, useful when users type borough names)
  or.push({ 'location.borough': { $regex: rx } });

  return col
    .find(
      { $or: or },
      {
        projection: {
          _id: 0,
          apsId: 1,
          location: 1
        }
      }
    )
    .limit(clampLimit(limit))
    .toArray();
}

export async function searchCurbRamps(q, limit = DEFAULT_LIMIT) {
  const qq = normalizeQuery(q);
  if (qq.length < 2) return [];

  const db = await getDb();
  const col = db.collection('curb_ramps');

  const or = [];

  // Guardrail #1:
  // Only attempt rampId matching when the query is "ID-like".
  if (isIdLike(qq)) {
    const idVariants = makeIdVariants(qq);
    if (idVariants.length) or.push({ rampId: { $in: idVariants } });
  }

  // Guardrail #2:
  // Only allow streetName "contains" matching if the query includes letters and is >= 3 chars.
  const allowStreetFuzzy = /[a-z]/i.test(qq) && qq.length >= 3;
  if (allowStreetFuzzy) {
    const rx = makeContainsRegex(qq);
    or.push({ streetName: { $regex: rx } });
  }

  if (or.length === 0) return [];

  return col
    .find(
      { $or: or },
      {
        projection: {
          _id: 0,
          rampId: 1,
          streetName: 1,
          borough: 1
        }
      }
    )
    .limit(clampLimit(limit))
    .toArray();
}

/**
 * Optional: call once during startup or after seeding to improve lookup performance.
 * Note: regex "contains" queries will not fully benefit from indexes, but exact ID lookups will.
 */
export async function ensureSearchIndexes() {
  const db = await getDb();

  await Promise.all([
    db.collection('stations').createIndex({ stationId: 1 }, { unique: true, name: 'stations_stationId_uq' }),
    db.collection('aps_locations').createIndex({ apsId: 1 }, { unique: true, name: 'aps_locations_apsId_uq' }),
    db.collection('curb_ramps').createIndex({ rampId: 1 }, { unique: true, name: 'curb_ramps_rampId_uq' })
  ]);
}
