// tasks/testLocations.js
import {
  getAllAPS,
  getNearbyAPS,
  getAllCurbRamps,
  getNearbyCurbRamps
} from '../data/locations.js';
import { closeConnection } from '../config/mongoConnection.js';

const main = async () => {
  try {
    console.log('All APS:');
    const apsAll = await getAllAPS();
    console.log(apsAll);

    console.log('---');

    console.log('APS within 100m of its own location (should find at least 1):');
    const oneAps = apsAll[0];
    const nearAPS = await getNearbyAPS({
      lat: oneAps.location.lat,
      lng: oneAps.location.lng,
      radiusMeters: 100
    });
    console.log(nearAPS);

    console.log('---');

    console.log('All curb ramps:');
    const rampsAll = await getAllCurbRamps();
    console.log(rampsAll);

    console.log('---');

    console.log('Curb ramps within 100m of its own location (should find at least 1):');
    const oneRamp = rampsAll[0];
    const nearRamps = await getNearbyCurbRamps({
      lat: oneRamp.location.lat,
      lng: oneRamp.location.lng,
      radiusMeters: 100
    });
    console.log(nearRamps);
  } catch (e) {
    console.error('Error in testLocations:', e);
  } finally {
    await closeConnection();
  }
};

main();
