// tasks/seedSampleReports.js
// Inserts a couple of sample reports so that the /admin moderation
// UI has something to display, using REAL target IDs from the DB.

import { getDb, closeConnection } from '../config/mongoConnection.js';

async function pickElevator(db) {
  // Prefer elevators that have a location (so they can appear on the map)
  const doc = await db.collection('elevators').findOne(
    { 'location.lat': { $ne: null }, 'location.lng': { $ne: null } },
    { projection: { elevatorId: 1, equipmentId: 1, stationName: 1, stationId: 1 } }
  );
  if (!doc || !doc.elevatorId) return null;

  return {
    targetType: 'elevator',
    targetId: String(doc.elevatorId),
    label: doc.stationName || doc.stationId || doc.equipmentId || doc.elevatorId
  };
}

async function pickStation(db) {
  const doc = await db.collection('stations').findOne(
    {},
    { projection: { stationId: 1, stationName: 1 } }
  );
  if (!doc || !doc.stationId) return null;

  return {
    targetType: 'station',
    targetId: String(doc.stationId),
    label: doc.stationName || doc.stationId
  };
}

async function pickAPS(db) {
  const doc = await db.collection('aps_locations').findOne(
    {},
    { projection: { apsId: 1, 'location.address': 1, 'location.borough': 1 } }
  );
  if (!doc || !doc.apsId) return null;

  const addr = doc.location?.address || '';
  const boro = doc.location?.borough || '';
  const label = [addr, boro].filter(Boolean).join(', ') || doc.apsId;

  return {
    targetType: 'aps',
    targetId: String(doc.apsId),
    label
  };
}

async function pickRamp(db) {
  const doc = await db.collection('curb_ramps').findOne(
    {},
    { projection: { rampId: 1, streetName: 1, borough: 1 } }
  );
  if (!doc || !doc.rampId) return null;

  const label = [doc.streetName, doc.borough].filter(Boolean).join(', ') || doc.rampId;

  return {
    targetType: 'ramp',
    targetId: String(doc.rampId),
    label
  };
}

const main = async () => {
  let db;
  try {
    db = await getDb();
    const reportsCol = db.collection('reports');

    // Pick real targets from DB (fallback chain)
    const elevatorTarget = await pickElevator(db);
    const stationTarget = await pickStation(db);
    const apsTarget = await pickAPS(db);
    const rampTarget = await pickRamp(db);

    // Build two reports using the best available targets
    // R1 prefers elevator → APS → ramp → station
    const t1 = elevatorTarget || apsTarget || rampTarget || stationTarget;
    // R2 prefers station → ramp → APS → elevator
    const t2 = stationTarget || rampTarget || apsTarget || elevatorTarget;

    if (!t1 || !t2) {
      throw new Error(
        'Could not create sample reports because no target data was found. Run `npm run seed` first.'
      );
    }

    // Optional: clear existing sample reports with the same IDs.
    await reportsCol.deleteMany({ reportId: { $in: ['R1', 'R2'] } });

    const now = new Date();

    const reports = [
      {
        reportId: 'R1',
        targetType: t1.targetType,
        targetId: t1.targetId,
        text: `Sample report: issue observed at ${t1.targetType} (${t1.label}).`,
        status: 'open',
        createdAt: now
      },
      {
        reportId: 'R2',
        targetType: t2.targetType,
        targetId: t2.targetId,
        text: `Sample report: accessibility feedback for ${t2.targetType} (${t2.label}).`,
        status: 'open',
        createdAt: now
      }
    ];

    await reportsCol.insertMany(reports);

    console.log(
      `Sample reports inserted: R1 -> ${t1.targetType}:${t1.targetId}, R2 -> ${t2.targetType}:${t2.targetId}`
    );
  } catch (err) {
    console.error('Error seeding sample reports:', err);
    process.exitCode = 1;
  } finally {
    await closeConnection();
  }
};

main();
