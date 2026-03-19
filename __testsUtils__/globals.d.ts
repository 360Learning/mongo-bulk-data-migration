import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { MongoClient, Db } from 'mongodb';

declare global {
  var mongoServer: MongoMemoryServer;
  var mongoClient: MongoClient;
  var db: Db;
}
