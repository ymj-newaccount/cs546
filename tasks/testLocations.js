// tasks/testLocations.js
// Sanity check script for location-based helpers (APS and curb ramps).
// It prints the total counts, small samples, and verifies that the
// "nearby" queries behave sensibly.

import {
  getAllAPS,
  getNearbyAPS,
  getAllCurbRamps,
  getNearbyCurbRamps
} from '../data/locations.js';
import { closeConnection } from '../config/mongoConnection.js';

const main = async () => {
  try {
    // --- APS (Accessible Pedestrian Signals) ---

    const apsAll = await getAllAPS();
    console.log('Total APS records:', apsAll.length);

    // Only print a small sample, not the entire array.
    console.log('First 5 APS:');
    console.log(apsAll.slice(0, 5));

    if (apsAll.length > 0) {
      const sampleAPS = apsAll[0];
      console.log('---');
      console.log(
        'APS within 100m of a sample APS location (should include that APS):'
      );

      const nearAPS = await getNearbyAPS({
        lat: sampleAPS.location.lat,
        lng: sampleAPS.location.lng,
        radiusMeters: 100
      });

      // Again, only show a few results.
      console.log(nearAPS.slice(0, 5));
    } else {
      console.log('No APS records found; skipping nearby APS test.');
    }

    console.log('---');

    // --- Curb ramps ---

    const rampsAll = await getAllCurbRamps();
    console.log('Total curb ramp records:', rampsAll.length);

    // Only print a small sample.
    console.log('First 5 curb ramps:');
    console.log(rampsAll.slice(0, 5));

    if (rampsAll.length > 0) {
      const sampleRamp = rampsAll[0];
      console.log('---');
      console.log(
        'Curb ramps within 100m of a sample ramp location (should include that ramp):'
      );

      const nearRamps = await getNearbyCurbRamps({
        lat: sampleRamp.location.lat,
        lng: sampleRamp.location.lng,
        radiusMeters: 100
      });

      console.log(nearRamps.slice(0, 5));
    } else {
      console.log('No curb ramp records found; skipping nearby ramp test.');
    }
  } catch (e) {
    console.error('Error in testLocations:', e);
  } finally {
    await closeConnection();
  }
};

main();
