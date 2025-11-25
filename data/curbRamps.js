import { getDb } from '../config/mongoConnection.js';

// Get a handle to the `curb_ramps` collection.
// All other functions reuse this to avoid repeating code.
const getRampsCollection = async () => {
  const db = await getDb();
  return db.collection('curb_ramps');
};

// Return all curb ramp documents in the collection.
// Useful for debugging, admin views, or bulk processing.
export const getAllCurbRamps = async () => {
  const col = await getRampsCollection();
  return col.find({}).toArray();
};

// Find a single curb ramp by its rampId.
// rampId is stored as a string in the database, so we cast to String here.
// Throws an error if no matching document is found.
export const getCurbRampById = async (rampId) => {
  const col = await getRampsCollection();
  const ramp = await col.findOne({ rampId: String(rampId) });
  if (!ramp) throw new Error(`Curb ramp with id ${rampId} not found`);
  return ramp;
};

// Return all curb ramps in a given borough.
// Example: getCurbRampsByBorough("Bronx") will return all ramps in the Bronx.
export const getCurbRampsByBorough = async (borough) => {
  const col = await getRampsCollection();
  return col.find({ borough }).toArray();
};
