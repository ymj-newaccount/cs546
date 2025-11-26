// tasks/testStations.js
// Sanity check script for the stations data-access layer.
// It prints the total number of stations, a small sample,
// and verifies that getStationById works using a real ID.

import { getAllStations, getStationById } from '../data/stations.js';
import { closeConnection } from '../config/mongoConnection.js';

const main = async () => {
  try {
    // Fetch all stations from the database.
    const all = await getAllStations();
    console.log('Total stations:', all.length);

    // Only print a small sample instead of the entire array.
    console.log('First 5 stations:');
    console.log(all.slice(0, 5));

    if (all.length > 0) {
      // Use the stationId of the first station as a real example,
      // instead of hard-coding an ID like '70'.
      const firstId = all[0].stationId;
      console.log('---');
      console.log(`Station ${firstId}:`);
      const s = await getStationById(firstId);
      console.log(s);
    } else {
      console.log('No stations found in the database.');
    }
  } catch (e) {
    console.error('Error in testStations:', e);
  } finally {
    await closeConnection();
  }
};

main();
