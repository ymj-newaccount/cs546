import { getDb } from '../config/mongoConnection.js';

// --- Utility: compute great-circle distance between two points (meters) ---
const toRad = (deg) => (deg * Math.PI) / 180;

const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // distance in meters
};

// --- APS-related helpers ---

const getApsCollection = async () => {
  const db = await getDb();
  return db.collection('aps_locations');
};

export const getAllAPS = async () => {
  const col = await getApsCollection();
  return col.find({}).toArray();
};

export const getNearbyAPS = async ({ lat, lng, radiusMeters = 200 }) => {
  const col = await getApsCollection();
  const all = await col.find({}).toArray();

  return all.filter((aps) => {
    const d = haversine(lat, lng, aps.location.lat, aps.location.lng);
    return d <= radiusMeters;
  });
};

// --- Curb ramp–related helpers ---

const getRampsCollection = async () => {
  const db = await getDb();
  return db.collection('curb_ramps');
};

export const getAllCurbRamps = async () => {
  const col = await getRampsCollection();
  return col.find({}).toArray();
};

export const getNearbyCurbRamps = async ({ lat, lng, radiusMeters = 200 }) => {
  const col = await getRampsCollection();
  const all = await col.find({}).toArray();

  return all.filter((ramp) => {
    const d = haversine(lat, lng, ramp.location.lat, ramp.location.lng);
    return d <= radiusMeters;
  });
};
