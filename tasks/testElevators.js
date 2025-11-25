import {
  getAllElevators,
  getElevatorById,
  getElevatorsByStationId
} from '../data/elevators.js';
import { closeConnection } from '../config/mongoConnection.js';

const main = async () => {
  try {
    console.log('All elevators:');
    const all = await getAllElevators();
    console.log(all);

    console.log('---');

    if (all.length > 0) {
      console.log('First elevator by id:');
      const e = await getElevatorById(all[0].elevatorId);
      console.log(e);

      console.log('---');

      console.log('Elevators for stationId =', all[0].stationId);
      const byStation = await getElevatorsByStationId(all[0].stationId);
      console.log(byStation);
    }
  } catch (e) {
    console.error('Error in testElevators:', e);
  } finally {
    await closeConnection();
  }
};

main();
