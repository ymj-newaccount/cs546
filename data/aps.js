import { getDb } from '../config/mongoConnection.js';

// Get the MongoDB collection handle for APS locations.
// This is a small internal helper so we don't repeat `getDb().collection(...)` everywhere.
const getApsCollection = async () => {
  const db = await getDb();
  return db.collection('aps_locations');
};

// Return all APS documents in the database.
// Useful for debugging, admin tools, or showing a full list (if ever needed).
export const getAllAPS = async () => {
  const col = await getApsCollection();
  return col.find({}).toArray();
};

// Look up a single APS by its logical ID (apsId field, not Mongo _id).
// Throws an error if the APS cannot be found, so callers can handle the "not found" case explicitly.
export const getAPSById = async (apsId) => {
  const col = await getApsCollection();
  const aps = await col.findOne({ apsId: String(apsId) });
  if (!aps) throw new Error(`APS ${apsId} not found`);
  return aps;
};

// Get all APS devices in a given borough.
// This is a simple filter on the "location.borough" field in each document.
export const getAPSByBorough = async (borough) => {
  const col = await getApsCollection();
  return col
    .find({ 'location.borough': borough })
    .toArray();
};