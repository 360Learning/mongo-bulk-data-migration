import { MongoError, MongoInvalidArgumentError, ObjectId } from 'mongodb';

import type { Collection, Db } from 'mongodb';
import { MongoBulkDataMigration, DELETE_COLLECTION } from '../src';

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
    try {
      await db.dropCollection('testCollection');
    } catch {
      /* empty */
    }
    try {
      await db.dropCollection('_rollback_testCollection_scriptId');
    } catch {
      /* empty */
    }
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

  describe('delete collection', () => {
    const sampleDoc = { _id: new ObjectId(), test: 1 };
    let migration: MongoBulkDataMigration<any>;
    beforeEach(async () => {
      migration = new MongoBulkDataMigration({
        collectionName: COLLECTION,
        db,
        id: SCRIPT_ID,
        operation: DELETE_COLLECTION,
      });
      await collection.insertMany([sampleDoc]);
    });

    it('should delete collection', async () => {
      const updateStatus = await migration.update();

      expect(updateStatus).toEqual({ ok: 1 });
      const collections = await db
        .listCollections({ name: '_rollback_testCollection_scriptId' })
        .toArray();
      expect(collections).toHaveLength(1);
      const rollbackDocs = await db
        .collection('_rollback_testCollection_scriptId')
        .find({})
        .toArray();
      expect(JSON.stringify(rollbackDocs[0])).toEqual(
        JSON.stringify(sampleDoc),
      );
    });

    it('should be safe to run twice', async () => {
      const updateStatus1 = await migration.update();
      const updateStatus2 = await migration.update();

      expect(updateStatus1).toEqual({ ok: 1 });
      expect(updateStatus2).toEqual({ ok: 0 });
    });

    it('should rename backup collection', async () => {
      await migration.update();

      const rollbackStatus = await migration.rollback();

      expect(rollbackStatus).toEqual({ ok: 1 });
      const collections = await db
        .listCollections({ name: '_rollback_testCollection_scriptId' })
        .toArray();
      expect(collections).toEqual([]);
      const rollbackDocs = await db
        .collection('testCollection')
        .find({})
        .toArray();
      expect(JSON.stringify(rollbackDocs[0])).toEqual(
        JSON.stringify(sampleDoc),
      );
    });

    it('should do nothing when it rollback twice', async () => {
      await migration.update();

      const rollbackStatus1 = await migration.rollback();
      const rollbackStatus2 = await migration.rollback();

      expect(rollbackStatus1).toEqual({ ok: 1 });
      expect(rollbackStatus2).toEqual({ ok: 0 });
    });
  });
});
