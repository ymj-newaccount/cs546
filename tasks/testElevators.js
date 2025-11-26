// tasks/testElevators.js
// Simple sanity check script for the elevators data-access layer.
// It prints the total number of elevator records, a small sample,
// and verifies that getElevatorById / getElevatorsByStationId work.

import {
  getAllElevators,
  getElevatorById,
  getElevatorsByStationId
} from '../data/elevators.js';
import { closeConnection } from '../config/mongoConnection.js';

const main = async () => {
  try {
    // Previously we logged all elevators directly, which is too large now
    // (tens of thousands of records). Instead, only print a small sample.
    const all = await getAllElevators();
    console.log('Total elevator records:', all.length);

    // Print only the first few records to avoid flooding the console.
    console.log('First 5 elevators:');
    console.log(all.slice(0, 5));

    console.log('---');

    if (all.length > 0) {
      const first = all[0];

      // Test fetching a single elevator by its elevatorId.
      console.log('First elevator by id:', first.elevatorId);
      const e = await getElevatorById(first.elevatorId);
      console.log(e);

      console.log('---');

      // Some elevator records may not have a stationId (null in the dataset),
      // so we guard against that before calling getElevatorsByStationId.
      if (first.stationId) {
        console.log('Elevators for stationId =', first.stationId);
        const byStation = await getElevatorsByStationId(first.stationId);
        // Again, only show a small sample.
        console.log(byStation.slice(0, 5));
      } else {
        console.log(
          'First elevator has no stationId (null); skipping stationId-based test.'
        );
      }
    } else {
      console.log('No elevators found in the database.');
    }
  } catch (e) {
    console.error('Error in testElevators:', e);
  } finally {
    await closeConnection();
  }
};

main();
