// tasks/seedSampleReports.js
// Inserts a couple of sample reports so that the /admin moderation
// UI has something to display.

import { getDb, closeConnection } from '../config/mongoConnection.js';

const main = async () => {
  try {
    const db = await getDb();
    const reportsCol = db.collection('reports');

    // Optional: clear existing sample reports with the same IDs.
    await reportsCol.deleteMany({
      reportId: { $in: ['R1', 'R2'] }
    });

    const now = new Date();

    await reportsCol.insertMany([
      {
        reportId: 'R1',
        targetType: 'elevator',
        targetId: 'EL426-2015-01',
        text: 'Elevator seems out of service.',
        status: 'open',
        createdAt: now
      },
      {
        reportId: 'R2',
        targetType: 'station',
        targetId: '317',
        text: 'Signage unclear at Times Sq-42 St.',
        status: 'open',
        createdAt: now
      }
    ]);

    console.log('Sample reports R1 / R2 inserted into the "reports" collection.');
  } catch (err) {
    console.error('Error seeding sample reports:', err);
  } finally {
    await closeConnection();
  }
};

main();
