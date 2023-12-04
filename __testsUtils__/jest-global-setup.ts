import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

export default async function globalSetup() {
  const mongoServer = await MongoMemoryServer.create();
  const mongoClient = new MongoClient(mongoServer.getUri());
  await mongoClient.connect();
  const db = mongoClient.db();

  global.mongoServer = mongoServer;
  global.mongoClient = mongoClient;
  global.db = db;
}
