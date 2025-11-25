// config/mongoConnection.js
// This module creates and reuses a single MongoDB client/connection
// so the rest of the app can call getDb() and closeConnection().

import { MongoClient } from 'mongodb';
import 'dotenv/config'; // Load environment variables from the .env file at the project root

const mongoConfig = {
  serverUrl: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017',
  database: process.env.MONGO_DB_NAME || 'CommuteAbleNYC'
};

let _client;
let _db;

export const getDb = async () => {
  // If we already have a database instance, reuse it
  if (_db) return _db;

  // Create a new MongoDB client and connect to the server
  _client = new MongoClient(mongoConfig.serverUrl);
  await _client.connect();

  // Select the database and cache the reference
  _db = _client.db(mongoConfig.database);
  console.log('Connected to MongoDB:', mongoConfig.database);
  return _db;
};

export const closeConnection = async () => {
  // Close the MongoDB client and clear cached references
  if (_client) {
    await _client.close();
    _client = undefined;
    _db = undefined;
    console.log('MongoDB connection closed');
  }
};
