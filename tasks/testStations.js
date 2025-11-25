import { getAllStations, getStationById } from '../data/stations.js';
import { closeConnection } from '../config/mongoConnection.js';

const main = async () => {
  try {
    console.log('All stations:');
    const all = await getAllStations();
    console.log(all);

    console.log('---');

    console.log('Station 70:');
    const s = await getStationById('70');
    console.log(s);
  } catch (e) {
    console.error('Error in testStations:', e);
  } finally {
    await closeConnection();
  }
};

main();
