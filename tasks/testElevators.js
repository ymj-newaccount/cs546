// tasks/testElevators.js
// Simple sanity check script for the elevators data-access layer.
// It prints the total number of elevator records, a small sample,
// and verifies that getElevatorById / getElevatorsByStationId work.
//
// Improvement vs previous version:
// - Ensures we actually test getElevatorsByStationId by selecting an elevator
//   that has a non-null stationId when possible.

import {
  getAllElevators,
  getElevatorById,
  getElevatorsByStationId
} from '../data/elevators.js';
import { closeConnection } from '../config/mongoConnection.js';

const main = async () => {
  try {
    const all = await getAllElevators();
    console.log('Total elevator records:', all.length);

    console.log('First 5 elevators:');
    console.log(all.slice(0, 5));

    console.log('---');

    if (all.length === 0) {
      console.log('No elevators found in the database.');
      return;
    }

    // Test fetching a single elevator by its elevatorId.
    const first = all[0];
    console.log('First elevator by id:', first.elevatorId);
    const e = await getElevatorById(first.elevatorId);
    console.log(e);

    console.log('---');

    // Prefer an elevator with a stationId so we can actually test getElevatorsByStationId.
    const withStation = all.find((x) => x && x.stationId);

    if (withStation && withStation.stationId) {
      console.log('Testing getElevatorsByStationId using stationId =', withStation.stationId);
      const byStation = await getElevatorsByStationId(withStation.stationId);

      console.log(`Found ${byStation.length} elevator records for stationId ${withStation.stationId}`);
      console.log('First 5 elevators for that stationId:');
      console.log(byStation.slice(0, 5));
    } else {
      console.log(
        'No elevator records with a non-null stationId were found; skipping stationId-based test.'
      );
    }
  } catch (e) {
    console.error('Error in testElevators:', e);
  } finally {
    await closeConnection();
  }
};

main();
