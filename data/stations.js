import { getDb } from '../config/mongoConnection.js';

// Helper to get the "stations" collection from the database
const getStationsCollection = async () => {
  const db = await getDb();
  return db.collection('stations');
};

// 1. Get all stations (used for map / station list views)
export const getAllStations = async () => {
  const col = await getStationsCollection();
  return col.find({}).toArray();
};

// 2. Get a single station by stationId (used for station detail page)
export const getStationById = async (stationId) => {
  const col = await getStationsCollection();
  const station = await col.findOne({ stationId: String(stationId) });
  if (!station) {
    throw new Error(`Station with id ${stationId} not found`);
  }
  return station;
};

// 3. Get all accessible stations (for filters / accessibility views)
export const getAccessibleStations = async () => {
  const col = await getStationsCollection();
  return col.find({ adaStatus: 'accessible' }).toArray();
};
