import { getDb } from '../config/mongoConnection.js';

const getElevatorsCollection = async () => {
  const db = await getDb();
  return db.collection('elevators');
};

// Get all elevators (e.g., for an /elevators listing page)
export const getAllElevators = async () => {
  const col = await getElevatorsCollection();
  return col.find({}).toArray();
};

// Get a single elevator by elevatorId (e.g., for a detail view or debugging)
export const getElevatorById = async (elevatorId) => {
  const col = await getElevatorsCollection();
  const elevator = await col.findOne({ elevatorId: String(elevatorId) });
  if (!elevator) throw new Error(`Elevator ${elevatorId} not found`);
  return elevator;
};

// Get all elevators for a given stationId (e.g., for a station detail page)
export const getElevatorsByStationId = async (stationId) => {
  const col = await getElevatorsCollection();
  return col.find({ stationId: String(stationId) }).toArray();
};
