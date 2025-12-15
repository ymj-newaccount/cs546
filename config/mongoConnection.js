// config/mongoConnection.js
// Single MongoDB client/connection for the whole app.
// - getDb() reuses the same connection
// - concurrent calls share one in-flight connection attempt
// - closeConnection() gracefully closes and resets cached refs

import { MongoClient } from 'mongodb';
import 'dotenv/config';

const mongoConfig = {
  serverUrl: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017',
  database: process.env.MONGO_DB_NAME || 'CommuteAbleNYC'
};

let _client;
let _db;
let _dbPromise; // ensures only one connect happens even if getDb() is called concurrently

export const getDb = async () => {
  if (_db) return _db;
  if (_dbPromise) return _dbPromise;

  _client = new MongoClient(mongoConfig.serverUrl, {
    // Optional but helpful for clearer failures in dev/CI environments
    serverSelectionTimeoutMS: 5000
  });

  _dbPromise = _client
    .connect()
    .then(() => {
      _db = _client.db(mongoConfig.database);
      console.log('Connected to MongoDB:', mongoConfig.database);
      return _db;
    })
    .catch((err) => {
      // allow retry on next getDb() call
      _dbPromise = undefined;
      throw err;
    });

  return _dbPromise;
};

export const closeConnection = async () => {
  if (_client) {
    await _client.close();
  }

  _client = undefined;
  _db = undefined;
  _dbPromise = undefined;

  console.log('MongoDB connection closed');
};
