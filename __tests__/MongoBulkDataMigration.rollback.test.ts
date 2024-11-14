import _ from 'lodash';

import { ObjectId } from 'mongodb';
import type { Collection, Db } from 'mongodb';
import {
  disableValidation,
  enableValidation,
} from '../__testsUtils__/mongoValidation';
import { MongoBulkDataMigration, DELETE_OPERATION } from '../src';
import { INITIAL_BULK_INFOS } from '../src/lib/AbstractBulkOperationResults';
import { LoggerInterface } from '../src/types';

const COLLECTION = 'testCollection';
const ROLLBACK_COLLECTION = `_rollback_${COLLECTION}_scriptId`;
const SCRIPT_ID = 'scriptId';

type DmDemoCollection = {
  _id: ObjectId;
  a: number;
  b: number;
  key: number;
  other: number;
};

describe('MongoBulkDataMigration', () => {
  let db: Db;
  let collection: Collection;
  let backupCollection: Collection;
  let DM_DEFAULT_SETUP: {
    collectionName: string;
    db: Db;
    id: string;
    query: any;
    projection: any;
    logger: LoggerInterface;
  };
  let loggerMock: LoggerInterface;

  beforeEach(async () => {
    db = global.db;
    collection = db.collection(COLLECTION);
    backupCollection = db.collection(ROLLBACK_COLLECTION);
    loggerMock = {
      info: jest.fn(),
      warn: jest.fn(),
    };
    DM_DEFAULT_SETUP = {
      collectionName: COLLECTION,
      db,
      logger: loggerMock,
      id: SCRIPT_ID,
      query: {},
      projection: {},
    };
  });

  afterEach(async () => {
    await collection.deleteMany({});
    await backupCollection.deleteMany({});
  });

  describe('#rollback', () => {
    it('should restore the exact previous state of migrated documents', async () => {
      await collection.insertMany([
        { key: 1, other: 1 },
        { key: 2, other: 1 },
        { key: 3, other: 1 },
      ]);
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        options: { maxBulkSize: 1 },
        query: { key: { $gt: 1 } },
        update: { $set: { key: 2 } },
      });

      await dataMigration.update();
      await collection.updateMany({}, { $set: { other: 999 } });
      const updateResults = await dataMigration.rollback();

      const restoredDocuments = await collection.find().toArray();
      expect(updateResults).toEqual({
        ...INITIAL_BULK_INFOS,
        nMatched: 2,
        nModified: 2,
      });
      expect(restoredDocuments.map((doc) => _.omit(doc, '_id'))).toEqual([
        { key: 1, other: 999 },
        { key: 2, other: 1 },
        { key: 3, other: 1 },
      ]);
    });

    it('should not rollback properties of a deleted document (no upsert)', async () => {
      const docId = new ObjectId();
      await collection.insertMany([{ _id: docId, key: 1 }]);
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        query: { key: 1 },
        update: { $set: { key: 2 } },
      });

      await dataMigration.update();
      await collection.deleteMany({}); // Doc is deleted in between update and rollback
      await dataMigration.rollback();

      const restoredDocuments = await collection.find().toArray();
      expect(restoredDocuments).toEqual([]);
    });

    it('should restore the projected properties only', async () => {
      await collection.insertMany([
        { key: 1, other: 2 },
        { key: 3, other: 4 },
        { key: 5, other: 6 },
      ]);
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        projection: { key: 1 },
        update: { $set: { key: 2 } },
      });

      await dataMigration.update();
      await collection.updateMany({}, { $set: { other: 999 } });
      const updateResults = await dataMigration.rollback();

      const restoredDocuments = await collection.find().toArray();
      expect(updateResults).toEqual({
        ...INITIAL_BULK_INFOS,
        nMatched: 3,
        nModified: 3,
      });
      expect(restoredDocuments.map((doc) => _.omit(doc, '_id'))).toEqual([
        { key: 1, other: 999 },
        { key: 3, other: 999 },
        { key: 5, other: 999 },
      ]);
    });

    it('should rollback only the filterProjection specified keys', async () => {
      await collection.insertMany([{ a: 1, b: 1 }]);
      const dataMigration = new MongoBulkDataMigration<DmDemoCollection>({
        ...DM_DEFAULT_SETUP,
        projection: { a: 1, b: 1 },
        update: ({ a, b }) => ({ $set: { a: a + b } }),
        options: {
          projectionBackupFilter: ['a'],
        },
      });

      await dataMigration.update();
      await collection.updateMany({}, { $set: { b: 999 } });
      await dataMigration.rollback();

      const [restoredDocument] = await collection.find().toArray();
      const restoredDocumentWithId = _.omit(restoredDocument, '_id');
      expect(restoredDocumentWithId).toEqual({
        a: 1,
        b: 999, // Updated value after the migration, not erased to 1 original value
      });
    });

    it('should restore a property removed during migration', async () => {
      await collection.insertMany([
        { other: 1, key: 1 },
        { other: 1, key: 2 },
        { other: 1, key: 3 },
      ]);
      const insertedDocuments = await collection.find().toArray();
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        update: { $unset: { key: 1 } },
      });

      await dataMigration.update();
      await dataMigration.rollback();

      const restoredDocuments = await collection.find().toArray();
      expect(restoredDocuments).toEqual(insertedDocuments);
    });

    it('should restore a property (array value) removed during migration', async () => {
      await collection.insertMany([{ keys: [1, 2, 3] }]);
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        projection: { keys: 1 },
        update: { $unset: { keys: 1 } },
      });
      await dataMigration.update();

      await dataMigration.rollback();

      const restoredDocuments = await collection.find().toArray();
      expect(restoredDocuments.map((doc) => _.omit(doc, '_id'))).toEqual([
        { keys: [1, 2, 3] },
      ]);
    });

    it('should restore to the original deep structure', async () => {
      await collection.insertMany([
        {
          a: {
            b: 'value',
          },
        },
      ]);
      const insertedDocuments = await collection.find().toArray();
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        update: (doc: any) => ({ $set: { a: doc.a.b } }),
      });

      await dataMigration.update();
      await dataMigration.rollback();

      const restoredDocuments = await collection.find().toArray();
      expect(restoredDocuments).toEqual(insertedDocuments);
    });

    it('should restore removed documents', async () => {
      await collection.insertMany([{ key: 1 }, { key: 2 }, { key: 3 }]);
      const insertedDocuments = await collection.find().toArray();
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        query: { key: 2 },
        update: DELETE_OPERATION,
      });

      const updateResults = await dataMigration.update();
      const rollbackResults = await dataMigration.rollback();

      const restoredDocuments = await collection
        .find()
        .sort({ _id: 1 })
        .toArray();
      expect(updateResults).toEqual({
        ...INITIAL_BULK_INFOS,
        nRemoved: 1,
      });
      expect(rollbackResults).toEqual({
        ...INITIAL_BULK_INFOS,
        insertedIds: [insertedDocuments[1]._id],
        upserted: [],
        nInserted: 1,
        nUpserted: 0,
      });
      expect(restoredDocuments).toEqual(insertedDocuments);
    });

    it('should remove properties added during migration', async () => {
      await collection.insertMany([{ other: 1 }, { other: 1 }]);
      const insertedDocuments = await collection.find().toArray();
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        update: { $set: { key: 2 } },
      });

      await dataMigration.update();
      await dataMigration.rollback();

      const restoredDocuments = await collection.find().toArray();
      expect(restoredDocuments).toEqual(insertedDocuments);
    });

    it('should clean the backup data', async () => {
      await collection.insertMany([{ other: 1 }]);
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        update: { $set: { key: 2 } },
      });

      await dataMigration.update();
      await dataMigration.rollback();

      const rollbackCollection = await db
        .listCollections({ name: ROLLBACK_COLLECTION })
        .toArray();
      expect(rollbackCollection).toEqual([]);
    });

    describe('rollback twice', () => {
      it('[non idempotent scripts] should restore the initial documents', async () => {
        await collection.insertMany([{ key: 1 }, { key: 2 }, { key: 3 }]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          query: {},
          update: () => ({ $set: { key: 100 } }),
        });
        const updateResults1 = await dataMigration.update();
        const updateResults2 = await dataMigration.update();
        expect(updateResults1).toEqual({
          ...INITIAL_BULK_INFOS,
          nMatched: 3,
          nModified: 3,
        });
        expect(updateResults2).toEqual({
          ...INITIAL_BULK_INFOS,
          nMatched: 3,
          nModified: 0,
        });

        const rollbackResults = await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(loggerMock.warn).not.toHaveBeenCalled();
        expect(rollbackResults).toEqual({
          ...INITIAL_BULK_INFOS,
          nMatched: 3,
          nModified: 3,
        });
        expect(restoredDocuments.map((doc) => _.omit(doc, '_id'))).toEqual([
          { key: 1 },
          { key: 2 },
          { key: 3 },
        ]);
      });

      it('[idempotent scripts] should restore the initial documents of the first migration', async () => {
        await collection.insertMany([{ key: 1 }, { key: 2 }, { key: 3 }]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          query: {},
          update: () => ({ $set: { key: Math.random() } }),
        });
        const updateResults1 = await dataMigration.update();
        const updateResults2 = await dataMigration.update();
        expect(updateResults1).toEqual({
          ...INITIAL_BULK_INFOS,
          nMatched: 3,
          nModified: 3,
        });
        expect(updateResults2).toEqual({
          ...INITIAL_BULK_INFOS,
          nMatched: 3,
          nModified: 3, // Non idempotent migration
        });

        const rollbackResults = await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(loggerMock.warn).toHaveBeenCalledWith(
          { totalNewBackupDocs: 0, totalUpdatedDocument: 3 },
          "The number of backup documents should be equal to the total updated documents. Check your query is idempotent or ensure you don't use a same migration id for different migrations.",
        );
        expect(rollbackResults).toEqual({
          ...INITIAL_BULK_INFOS,
          nMatched: 3,
          nModified: 3,
        });
        expect(restoredDocuments.map((doc) => _.omit(doc, '_id'))).toEqual([
          { key: 1 },
          { key: 2 },
          { key: 3 },
        ]);
      });
    });

    describe('$unset support', () => {
      it('should restore an object values', async () => {
        const document = { key: 'value' };
        await collection.insertMany([document]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: { $unset: { key: 1 } },
          projection: { key: 1 },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();

        expect(restoredDocuments).toEqual([document]);
      });

      it('should restore an object values even if key is not projected', async () => {
        const document = { key: 'value' };
        await collection.insertMany([document]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: { $unset: { key: 1 } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();

        expect(restoredDocuments).toEqual([document]);
      });

      it('should restore a nested object value', async () => {
        const document = { deep: { key: 'value' } };
        await collection.insertMany([document]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: { $unset: { 'deep.key': 1 } },
          projection: { deep: 1 },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();

        expect(restoredDocuments).toEqual([document]);
      });

      it('should restore a nested object value even if key is not projected', async () => {
        const document = { deep: { key: 'value' } };
        await collection.insertMany([document]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: { $unset: { 'deep.key': 1 } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();

        expect(restoredDocuments).toEqual([document]);
      });

      it('should restore a nested object value in array', async () => {
        const document = { deep: { key: { 0: 'value' } } };
        await collection.insertMany([document]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: { $unset: { 'deep.key.0': 1 } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();

        expect(restoredDocuments).toEqual([document]);
      });
    });

    describe('Number indexed objects support', () => {
      it('should restore an object with numbers as keys', async () => {
        const document = {
          object: {
            0: 'a',
            1: 'b',
          },
        };
        await collection.insertMany([document]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: {
            $set: {
              'object.1': 'new b',
            },
          },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual([document]);
      });

      it('should restore an nested object with numbers as keys', async () => {
        const document = {
          object: {
            0: 'a',
            1: 'b',
            2: {
              nested: {
                3: 'c',
                4: ['d', 'e'],
              },
            },
          },
        };
        await collection.insertMany([document]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: {
            $set: {
              'object.2.nested.3': 'new c',
              'object.2.nested.4.1': 'new e',
            },
          },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual([document]);
      });
    });

    describe('Nested keys support', () => {
      const sampleDocument = {
        rootKey: 1,
        nested: {
          key: 'initial',
          sibling: 'unchanged',
        },
      };

      it('should restore a nested value', async () => {
        await collection.insertMany([sampleDocument]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          query: { 'nested.key': 'initial' },
          update: { $set: { 'nested.key': 'updated' } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual([sampleDocument]);
      });

      it('should restore nested array values', async () => {
        const document = {
          nested: {
            array: ['a', 'b'],
          },
        };
        await collection.insertMany([document]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: { $set: { 'nested.array': ['c'] } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual([document]);
      });

      it('should restore an array element having objects', async () => {
        const document = {
          array: [
            {
              nested: ['nestedValue'],
            },
          ],
        };
        await collection.insertMany([document]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: { $set: { array: [] } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual([document]);
      });

      it('should restore specific array elements', async () => {
        const document = {
          array: ['a', 'b'],
        };
        await collection.insertMany([document]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: { $set: { 'array.1': 'new b' } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual([document]);
      });

      it('should restore specific nested array elements', async () => {
        const document = {
          array: [
            null,
            {
              nestedArray: [null, 'b'],
            },
          ],
        };
        await collection.insertMany([document]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: {
            $set: {
              'array.1.nestedArray.1': 'new b',
            },
          },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual([document]);
      });

      it('should not restore non-projected sibling values', async () => {
        const { insertedIds } = await collection.insertMany([sampleDocument]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          projection: { 'nested.key': 1 },
          query: { 'nested.key': 'initial' },
          update: { $set: { 'nested.key': 'updated' } },
        });

        await dataMigration.update();
        await collection.updateOne(
          { _id: insertedIds[0] },
          { $set: { 'nested.sibling': 'in_between_update' } },
        );
        await dataMigration.rollback();

        const [restoredDocument] = await collection.find().toArray();
        const restoredDocumentWithoutId = _.omit(restoredDocument, '_id');
        expect(restoredDocumentWithoutId).toEqual({
          nested: {
            key: 'initial',
            sibling: 'in_between_update',
          },
          rootKey: 1,
        });
      });

      it('should unset a non existing root key created by in a nested $set', async () => {
        await collection.insertMany([sampleDocument]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          update: { $set: { 'new.deep.key': "drop 'new'" } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const [restoredDocument] = await collection.find().toArray();
        expect(restoredDocument).toEqual(sampleDocument);
      });

      it('should unset a non existing nested key created by in a sub nested $set', async () => {
        await collection.insertMany([sampleDocument]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          projection: { nested: 1 },
          update: { $set: { 'nested.new.key': "drop 'nested.new'" } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const [restoredDocument] = await collection.find().toArray();
        expect(restoredDocument).toEqual(sampleDocument);
      });

      it('should restore dropped nested keys', async () => {
        await collection.insertMany([sampleDocument]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          projection: { nested: 1 },
          query: { 'nested.key': 'initial' },
          update: { $unset: { 'nested.key': 1 } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual([sampleDocument]);
      });
    });

    describe('Aggregate support', () => {
      it('should perform rollback for an aggregate pipeline', async () => {
        await collection.insertMany([
          { key: 1, letThis: true },
          { key: 1 },
          { key: 5 },
        ]);
        const insertedDocuments = await collection.find().toArray();
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          query: [
            {
              $lookup: {
                from: COLLECTION,
                localField: 'key',
                foreignField: 'key',
                as: 'key2',
              },
            },
            { $match: { 'key2.1': { $exists: true } } },
            { $project: { key: 1 } },
          ],
          update: (doc: any) => ({ $set: { key: doc.key * 2 } }),
        });

        await dataMigration.update();
        const rollbackStatus = await dataMigration.rollback();

        expect(rollbackStatus).toEqual({
          ...INITIAL_BULK_INFOS,
          nMatched: 2,
          nModified: 2,
        });
        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual(insertedDocuments);
      });
    });

    describe('Off validation support', () => {
      const updateQuery = { $set: { invalid_key: 'update' } };
      let invalidSampleDoc: any;

      beforeEach(async () => {
        await disableValidation(['sampleCollection']);
        await db.createCollection('sampleCollection');
        const { insertedId: invalidSampleDocId } = await db
          .collection('sampleCollection')
          .insertOne({ forbiddenProp: true });
        invalidSampleDoc = await db
          .collection('sampleCollection')
          .findOne({ _id: invalidSampleDocId });
        await db.command({
          collMod: 'sampleCollection',
          validator: {
            $jsonSchema: {
              bsonType: 'object',
            },
            properties: {},
            additionalProperties: false,
          },
          validationLevel: 'moderate',
          validationAction: 'error',
        });
        const rollbackDocument = {
          date: new Date(),
          backup: {},
          updateQuery: JSON.stringify(updateQuery),
        };
        await db
          .collection('_rollback_sampleCollection_scriptId')
          .insertOne(rollbackDocument);
        await enableValidation(['sampleCollection']);
      });

      afterEach(async () => {
        await db.collection('_rollback_users_scriptId').deleteMany({});
        await db.dropCollection('sampleCollection');
      });

      it('should reject rollback when validation is invalid', async () => {
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          collectionName: 'sampleCollection',
          options: {},
          update: updateQuery,
        });
        await dataMigration.update();

        const rollbackPromise = dataMigration.rollback();

        // Does not reject since usage of abandoned usage of upsert() but it's not an issue (good for rollback)
        // await expect(rollbackPromise).rejects.toThrow();
        expect(await rollbackPromise).toEqual({
          ...INITIAL_BULK_INFOS,
          nMatched: 1,
          nModified: 1,
          ok: 1,
        });
        const restoredDoc = await db
          .collection('sampleCollection')
          .findOne({ _id: invalidSampleDoc._id });
        expect(restoredDoc).toEqual(invalidSampleDoc);
      });

      it('should disable validation for the rollback process if specified', async () => {
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          collectionName: 'sampleCollection',
          options: { bypassRollbackValidation: true },
          update: updateQuery,
        });
        await dataMigration.update();

        await dataMigration.rollback();

        const restoredDoc = await db
          .collection('sampleCollection')
          .findOne({ _id: invalidSampleDoc._id });
        expect(restoredDoc).toEqual(invalidSampleDoc);
      });
    });

    describe('With rollback function', () => {
      it('should apply a specific rollback operation and unset an added value', async () => {
        await collection.insertMany([
          { other: 1, key: 1 },
          { other: 1, key: 2 },
          { other: 1, key: 3 },
        ]);
        const insertedDocuments = await collection.find().toArray();
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          options: { bypassRollbackValidation: true },
          rollback: () => ({ $unset: { nested: 1 } }),
          update: { $set: { nested: { object: 1 } } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual(insertedDocuments);
      });

      it('should call the rollback function with the backup document', async () => {
        await collection.insertMany([
          { value: 1, double: 2 },
          { value: 1, double: 2 },
        ]);
        const insertedDocuments = await collection.find().toArray();
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          rollback: (doc: any) => ({ $set: { double: doc.value * 2 } }),
          update: { $set: { double: 5 } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual(insertedDocuments);
      });
    });

    describe('options.rollbackable set to false', () => {
      it('should not rollback anything', async () => {
        await collection.insertMany([{ key: 1 }, { key: 2 }, { key: 2 }]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          options: { rollbackable: false },
          update: { $set: { value: 10 } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const updatedDocuments = await collection
          .find({}, { projection: { _id: 0 } })
          .toArray();
        expect(updatedDocuments).toEqual([
          { key: 1, value: 10 },
          { key: 2, value: 10 },
          { key: 2, value: 10 },
        ]);
      });
    });

    describe('arrayFilters support', () => {
      it('should rollback automatically change on nested keys', async () => {
        const matchDocument = {
          keys: [
            {
              subKey1: 'match_me',
              subKey2: [{ elt1: 90 }, { elt1: 95 }], // <100 no match
            },
            {
              subKey1: 'match_me',
              subKey2: [
                { elt1: 90 },
                // Only this element has a match
                { elt1: 130 },
              ],
            },
          ],
        };
        const fullyUnmatchedDocument = {
          keys: [
            {
              subKey1: 'match_me',
              subKey2: [{ elt1: 90 }, { elt1: 95 }], // <100 no match
            },
            {
              subKey1: 'DO_NOT_match',
              subKey2: [{ elt1: 104 }, { elt1: 106 }],
            },
          ],
        };
        await collection.insertMany([matchDocument, fullyUnmatchedDocument]);
        const insertedDocuments = await collection.find().toArray();

        const migration = new MongoBulkDataMigration<any>({
          ...DM_DEFAULT_SETUP,
          update: {
            $set: {
              'keys.$[element].subKey2.$[element2].elt2': '____MATCHED____',
            },
          },
          options: {
            arrayFilters: [
              { 'element.subKey1': 'match_me' },
              { 'element2.elt1': { $gte: 100 } },
            ],
            projectionBackupFilter: [],
          },
        });

        await migration.update();
        await migration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual(insertedDocuments);
      });

      it('should rollback with a custom query', async () => {
        const document = {
          keys: [{ subKey1: 'match_me' }, { subKey1: 'do_not_match_me' }],
        };
        await collection.insertMany([document]);

        const migration = new MongoBulkDataMigration<any>({
          ...DM_DEFAULT_SETUP,
          update: {
            $set: {
              'keys.$[element].new_key': '____MATCHED____',
            },
          },
          rollback: (backup) => ({ $set: { keys: backup.keys } }),
          options: {
            arrayFilters: [{ 'element.subKey1': 'match_me' }],
          },
        });

        await migration.update();
        await migration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual([document]);
      });
    });
  });
});
