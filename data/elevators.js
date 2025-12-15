// data/elevators.js
import { getDb } from '../config/mongoConnection.js';

const DEFAULT_LOW_RISK_MAX = 5;

const getElevatorsCollection = async () => {
  const db = await getDb();
  return db.collection('elevators');
};

// Ensure indexes are created only once per process.
let _indexesReady = null;

function makeError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertNonEmptyString(v, name, maxLen = 200) {
  if (v === undefined || v === null) {
    throw makeError(`${name} is required`, 400);
  }

  const s = String(v).trim();

  if (!s) throw makeError(`${name} cannot be empty`, 400);
  if (s.length > maxLen) throw makeError(`${name} is too long (max ${maxLen})`, 400);

  // Guard against common accidental coercions
  if (s === 'undefined' || s === 'null') {
    throw makeError(`${name} is invalid`, 400);
  }

  return s;
}

function coerceRiskThreshold(value, defaultValue = DEFAULT_LOW_RISK_MAX) {
  if (value === undefined || value === null || value === '') return defaultValue;

  const n = Number(value);
  if (!Number.isFinite(n)) throw makeError('maxRiskScore must be a finite number', 400);
  if (n < 0 || n > 100) throw makeError('maxRiskScore must be between 0 and 100', 400);

  // riskScore is stored as an integer in seed; keep threshold integer-friendly.
  return Math.round(n);
}

async function ensureIndexes() {
  if (_indexesReady) return _indexesReady;

  _indexesReady = (async () => {
    const col = await getElevatorsCollection();

    await col.createIndex({ elevatorId: 1 }, { name: 'elevatorId_1' });
    await col.createIndex({ stationId: 1 }, { name: 'stationId_1' });

    // Speeds up low-risk lookups; excludes docs without numeric riskScore.
    await col.createIndex(
      { riskScore: 1, stationId: 1 },
      {
        name: 'riskScore_1_stationId_1',
        partialFilterExpression: { riskScore: { $type: 'number' } }
      }
    );
  })();

  return _indexesReady;
}

// Get all elevators (e.g., for /explore when the elevators layer is enabled)
export const getAllElevators = async () => {
  await ensureIndexes();
  const col = await getElevatorsCollection();
  return col.find({}).toArray();
};

// Get a single elevator by elevatorId (e.g., for a detail view or debugging)
export const getElevatorById = async (elevatorId) => {
  await ensureIndexes();
  const id = assertNonEmptyString(elevatorId, 'elevatorId');

  const col = await getElevatorsCollection();
  const elevator = await col.findOne({ elevatorId: id });
  if (!elevator) throw makeError(`Elevator ${id} not found`, 404);

  return elevator;
};

// Get all elevators for a given stationId (e.g., for a station detail page)
// Optional: pass { onlyLowRisk: true, maxRiskScore: 5 } to filter by riskScore.
export const getElevatorsByStationId = async (
  stationId,
  { onlyLowRisk = false, maxRiskScore = DEFAULT_LOW_RISK_MAX } = {}
) => {
  await ensureIndexes();
  const sid = assertNonEmptyString(stationId, 'stationId');

  const query = { stationId: sid };

  if (onlyLowRisk) {
    const max = coerceRiskThreshold(maxRiskScore, DEFAULT_LOW_RISK_MAX);
    query.riskScore = { $type: 'number', $lte: max };
  }

  const col = await getElevatorsCollection();
  return col.find(query).toArray();
};

// Get all low-risk elevators (numeric riskScore <= maxRiskScore).
export const getLowRiskElevators = async (maxRiskScore = DEFAULT_LOW_RISK_MAX) => {
  await ensureIndexes();
  const max = coerceRiskThreshold(maxRiskScore, DEFAULT_LOW_RISK_MAX);

  const col = await getElevatorsCollection();
  return col.find({ riskScore: { $type: 'number', $lte: max } }).toArray();
};

// Used by /explore/api to filter stations even when the elevators layer is not enabled.
// Returns unique stationId values for stations that have at least one low-risk elevator.
export const getStationIdsWithLowRiskElevators = async (maxRiskScore = DEFAULT_LOW_RISK_MAX) => {
  await ensureIndexes();
  const max = coerceRiskThreshold(maxRiskScore, DEFAULT_LOW_RISK_MAX);

  const col = await getElevatorsCollection();
  const docs = await col
    .find(
      {
        riskScore: { $type: 'number', $lte: max },
        stationId: { $type: 'string', $ne: '' }
      },
      { projection: { stationId: 1 } }
    )
    .toArray();

  const out = new Set();
  for (const d of docs) {
    if (d?.stationId) out.add(String(d.stationId));
  }
  return [...out];
};
