// db.js — tiny MongoDB connection helper.
// The database name lives in your MONGODB_URI (e.g. .../smartef?...), so we
// just call client.db() with no argument and it uses that default database.

const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
let client;
let dbPromise;

function getDb() {
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set. Add it in Render → your service → Environment.');
  }
  if (!dbPromise) {
    client = new MongoClient(uri);
    dbPromise = client.connect().then((c) => c.db());
  }
  return dbPromise;
}

module.exports = { getDb };
