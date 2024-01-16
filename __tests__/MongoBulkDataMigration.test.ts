import { MongoError, MongoInvalidArgumentError } from 'mongodb';

import type { Collection, Db } from 'mongodb';
import { MongoBulkDataMigration } from '../src';

const COLLECTION = 'testCollection';
const SCRIPT_ID = 'scriptId';

describe('MongoBulkDataMigration', () => {
  let db: Db;
  let collection: Collection;
  let DM_DEFAULT_SETUP: {
    collectionName: string;
    db: Db;
    id: string;
    query: any;
    projection: any;
  };
  expect.anything();

  beforeEach(async () => {
    db = global.db;
    collection = db.collection(COLLECTION);
    DM_DEFAULT_SETUP = {
      collectionName: COLLECTION,
      db,
      id: SCRIPT_ID,
      query: {},
      projection: {},
    };
  });

  afterEach(async () => {
    await db.collection('testCollection').deleteMany({});
    await db.collection('_rollback_testCollection_scriptId').deleteMany({});
  });

  it('should directly reject for invalid queries', async () => {
    await collection.insertMany([{ key: 1 }]);
    const invalidUpdateQuery: any = () => null;
    const dataMigration = new MongoBulkDataMigration({
      ...DM_DEFAULT_SETUP,
      update: invalidUpdateQuery,
    });

    const updatePromise = dataMigration.update();

    await expect(updatePromise).rejects.toThrow(
      new MongoInvalidArgumentError(
        'Document must be a valid JavaScript object',
      ),
    );
  });

  it('should directly reject for invalid aggregate pipelines (empty from)', async () => {
    await collection.insertMany([{ key: 1 }]);
    const invalidAggregatePipeline: any = [{ $lookup: { invalidKey: true } }];
    const dataMigration = new MongoBulkDataMigration({
      ...DM_DEFAULT_SETUP,
      query: invalidAggregatePipeline,
      update: {},
    });

    const updatePromise = dataMigration.update();

    await expect(updatePromise).rejects.toThrow(
      new MongoError("must specify 'pipeline' when 'from' is empty"),
    );
  });

  describe('#clean', () => {
    it('should not do anything if no backup is available', async () => {
      const migration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        update: {},
      });

      await migration.clean();

      const collections = await db
        .listCollections({ name: '_rollback_testCollection_scriptId' })
        .toArray();
      expect(collections).toEqual([]);
    });

    it('should drop the rollback collection', async () => {
      await collection.insertMany([{ key: 1 }, { key: 2 }, { key: 3 }]);
      const migration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        update: { $set: { key: 2 } },
      });
      await migration.update();

      await migration.clean();

      const collections = await db
        .listCollections({ name: '_rollback_testCollection_scriptId' })
        .toArray();
      expect(collections).toEqual([]);
    });
  });
});
