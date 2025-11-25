import { getDb, closeConnection } from '../config/mongoConnection.js';

// Main seeding function
const seed = async () => {
  // 1. Get a reference to the database (shared MongoDB connection)
  const db = await getDb();

  // 2. Get handles for the 4 collections
  const stationsCol = db.collection('stations');
  const elevatorsCol = db.collection('elevators');
  const apsCol = db.collection('aps_locations');
  const rampsCol = db.collection('curb_ramps');

  // 3. Clear all existing data from these collections
  console.log('Clearing old data...');
  await stationsCol.deleteMany({});
  await elevatorsCol.deleteMany({});
  await apsCol.deleteMany({});
  await rampsCol.deleteMany({});

  // Sample station document
  const stationsData = [
    {
      stationId: '70',
      division: 'BMT',
      line: 'West End',
      stationName: 'Bay 50 St',
      daytimeRoutes: ['D'],
      location: {
        lat: 40.588884,
        lng: -73.98388
      },
      adaStatus: 'notAccessible'
    }
  ];

  // Sample elevator document
  const elevatorsData = [
    {
      elevatorId: 'EL426-2015-01',
      borough: 'Queens',
      stationId: '451', // Later this should match a real stationId
      status: 'inService',
      lastUpdated: '2024-10-01T12:00:00Z'
    }
  ];

  // Sample APS (Accessible Pedestrian Signal) document
  const apsData = [
    {
      apsId: 'APS-0001',
      location: {
        lat: 40.61711,
        lng: -73.9852,
        address: '20 Avenue and 64 Street',
        borough: 'Brooklyn'
      },
      installDate: '2021-09-17'
    }
  ];

  // Sample curb ramp document
  const rampsData = [
    {
      rampId: '340375',
      location: {
        lat: 40.789012,
        lng: -73.123456
      },
      borough: 'Bronx',
      streetName: 'Crottona Av',
      attributes: {
        curbReveal: 999,
        rampRun: 5.5,
        downSlopeCondition: 'Good Con'
        // You can add more ramp measurement fields later
      }
    }
  ];

  // 4. Insert the sample data into each collection
  console.log('Inserting sample stations...');
  await stationsCol.insertMany(stationsData);

  console.log('Inserting sample elevators...');
  await elevatorsCol.insertMany(elevatorsData);

  console.log('Inserting sample APS locations...');
  await apsCol.insertMany(apsData);

  console.log('Inserting sample curb ramps...');
  await rampsCol.insertMany(rampsData);

  console.log('Seeding complete!');
};

// Run the seeding function immediately when this file is executed
seed()
  .catch((err) => {
    // If anything goes wrong, log the error
    console.error('Error during seeding:', err);
  })
  .finally(async () => {
    // Always close the MongoDB connection at the end
    await closeConnection();
  });
