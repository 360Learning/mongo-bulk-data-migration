export default async function globalTeardown() {
  await global.mongoClient.close();
  await global.mongoServer.stop();
}
