import { getDb } from '../config/mongoConnection.js';

// Helper to get the "stations" collection from the database
const getStationsCollection = async () => {
  const db = await getDb();
  return db.collection('stations');
};

// Helper function to calculate distance between two lat/lng points (in km)
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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

// 4. Get nearby APS crossings for a station
export const getNearbyCrossings = async (stationLat, stationLng, maxDistance = 0.3) => {
  const db = await getDb();
  const apsCollection = db.collection('aps_locations');
  
  // Get all APS locations
  const allAPS = await apsCollection.find({}).toArray();
  
  // Calculate distances and filter
  const nearbyCrossings = allAPS
    .map(aps => {
      if (!aps.location?.lat || !aps.location?.lng) return null;
      
      const distance = calculateDistance(
        stationLat,
        stationLng,
        aps.location.lat,
        aps.location.lng
      );
      
      return {
        apsId: aps.apsId,
        address: aps.location.address,
        distance: parseFloat(distance.toFixed(4))
      };
    })
    .filter(aps => aps !== null && aps.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
  
  return nearbyCrossings;
};