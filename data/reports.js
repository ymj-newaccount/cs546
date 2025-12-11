import { ObjectId } from 'mongodb';
import { getDb } from '../config/mongoConnection.js';

// Create a new report
export async function createReport(reportData) {
  try {
    const db = await getDb();
    const reportsCollection = db.collection('reports');
    
    const newReport = {
      targetType: reportData.targetType, // 'station', 'elevator', 'crossing'
      targetId: reportData.targetId,
      text: reportData.text,
      userId: reportData.userId || 'anonymous',
      status: 'open',
      trustScore: 0,
      createdAt: new Date()
    };
    
    const result = await reportsCollection.insertOne(newReport);
    
    // Use MongoDB's _id as the reportId (converted to string for consistency)
    newReport._id = result.insertedId;
    newReport.reportId = result.insertedId.toString();
    
    return newReport;
  } catch (error) {
    console.error('Error creating report:', error);
    throw error;
  }
}

// Get all reports for a specific target (station, elevator, or crossing)
export async function getReportsByTarget(targetType, targetId) {
  try {
    const db = await getDb();
    const reportsCollection = db.collection('reports');
    
    const reports = await reportsCollection
      .find({ targetType, targetId })
      .sort({ createdAt: -1 })
      .toArray();
    
    return reports;
  } catch (error) {
    console.error('Error fetching reports:', error);
    throw error;
  }
}

// Update report status (open, verified, resolved, disputed)
export async function updateReportStatus(reportId, newStatus) {
  try {
    const db = await getDb();
    const reportsCollection = db.collection('reports');
    
    const result = await reportsCollection.updateOne(
      { reportId },
      { $set: { status: newStatus, updatedAt: new Date() } }
    );
    
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error updating report status:', error);
    throw error;
  }
}