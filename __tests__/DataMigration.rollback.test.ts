import _ from 'lodash';

import type { Collection, Db, ObjectId } from 'mongodb';
import {
  disableValidation,
  enableValidation,
} from '../__testsUtils__/mongoValidation';
import { DataMigration, DELETE_OPERATION } from '../src';
import { INITIAL_BULK_INFOS } from '../src/lib/AbstractBulkOperationResults';

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

describe('DataMigration', () => {
  let db: Db;
  let collection: Collection;
  let backupCollection: Collection;
  let DM_DEFAULT_SETUP: {
    collectionName: string;
    db: Db;
    id: string;
    query: any;
    projection: any;
  };

  beforeEach(async () => {
    db = global.db;
    collection = db.collection(COLLECTION);
    backupCollection = db.collection(ROLLBACK_COLLECTION);
    DM_DEFAULT_SETUP = {
      collectionName: COLLECTION,
      db,
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
      const dataMigration = new DataMigration({
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

    it('should restore the projected properties only', async () => {
      await collection.insertMany([
        { key: 1, other: 2 },
        { key: 3, other: 4 },
        { key: 5, other: 6 },
      ]);
      const dataMigration = new DataMigration({
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
      const dataMigration = new DataMigration<DmDemoCollection>({
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
      const insertResult = await collection.insertMany([
        { other: 1, key: 1 },
        { other: 1, key: 2 },
        { other: 1, key: 3 },
      ]);
      const insertedDocuments = await collection
        .find({ _id: { $in: Object.values(insertResult.insertedIds) } })
        .toArray();
      const dataMigration = new DataMigration({
        ...DM_DEFAULT_SETUP,
        update: { $unset: { key: 1 } },
      });

      await dataMigration.update();
      await dataMigration.rollback();

      const restoredDocuments = await collection.find().toArray();
      expect(restoredDocuments).toEqual(insertedDocuments);
    });

    it('should restore to the original deep structure', async () => {
      const insertResult = await collection.insertMany([
        {
          a: {
            b: 'value',
          },
        },
      ]);
      const insertedDocuments = await collection
        .find({ _id: { $in: Object.values(insertResult.insertedIds) } })
        .toArray();
      const dataMigration = new DataMigration({
        ...DM_DEFAULT_SETUP,
        update: (doc: any) => ({ $set: { a: doc.a.b } }),
      });

      await dataMigration.update();
      await dataMigration.rollback();

      const restoredDocuments = await collection.find().toArray();
      expect(restoredDocuments).toEqual(insertedDocuments);
    });

    it('should restore removed documents', async () => {
      const insertResult = await collection.insertMany([
        { key: 1 },
        { key: 2 },
        { key: 3 },
      ]);
      const insertedDocuments = await collection
        .find({ _id: { $in: Object.values(insertResult.insertedIds) } })
        .toArray();
      const dataMigration = new DataMigration({
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
        upserted: [insertedDocuments[1]._id],
        nUpserted: 1,
      });
      expect(restoredDocuments).toEqual(insertedDocuments);
    });

    it('should remove properties added during migration', async () => {
      const insertResult = await collection.insertMany([
        { other: 1 },
        { other: 1 },
      ]);
      const insertedDocuments = await collection
        .find({ _id: { $in: Object.values(insertResult.insertedIds) } })
        .toArray();
      const dataMigration = new DataMigration({
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
      const dataMigration = new DataMigration({
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
        const dataMigration = new DataMigration({
          ...DM_DEFAULT_SETUP,
          query: { 'nested.key': 'initial' },
          update: { $set: { 'nested.key': 'updated' } },
        });

        await dataMigration.update();
        await dataMigration.rollback();

        const restoredDocuments = await collection.find().toArray();
        expect(restoredDocuments).toEqual([sampleDocument]);
      });

      it('should not restore non-projected sibling values', async () => {
        const { insertedIds } = await collection.insertMany([sampleDocument]);
        const dataMigration = new DataMigration({
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
        const dataMigration = new DataMigration({
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
        const dataMigration = new DataMigration({
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
        const dataMigration = new DataMigration({
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
        const insertResult = await collection.insertMany([
          { key: 1, letThis: true },
          { key: 1 },
          { key: 5 },
        ]);
        const insertedDocuments = await collection
          .find({ _id: { $in: Object.values(insertResult.insertedIds) } })
          .toArray();
        const dataMigration = new DataMigration({
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
        const dataMigration = new DataMigration({
          ...DM_DEFAULT_SETUP,
          collectionName: 'sampleCollection',
          options: {},
          update: updateQuery,
        });

        const rollbackPromise = dataMigration.rollback();

        await expect(rollbackPromise).rejects.toThrow(
          new Error('Document failed validation'),
        );
      });

      it('should disable validation for the rollback process if specified', async () => {
        const dataMigration = new DataMigration({
          ...DM_DEFAULT_SETUP,
          collectionName: 'sampleCollection',
          options: { bypassRollbackValidation: true },
          update: updateQuery,
        });

        await dataMigration.rollback();

        const restoredDoc = await db
          .collection('sampleCollection')
          .findOne({ _id: invalidSampleDoc._id });
        expect(restoredDoc).toEqual(invalidSampleDoc);
      });
    });

    describe('With rollback function', () => {
      it('should apply a specific rollback operation and unset an added value', async () => {
        const insertResult = await collection.insertMany([
          { other: 1, key: 1 },
          { other: 1, key: 2 },
          { other: 1, key: 3 },
        ]);
        const insertedDocuments = await collection
          .find({ _id: { $in: Object.values(insertResult.insertedIds) } })
          .toArray();
        const dataMigration = new DataMigration({
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
        const insertResult = await collection.insertMany([
          { value: 1, double: 2 },
          { value: 1, double: 2 },
        ]);
        const insertedDocuments = await collection
          .find({ _id: { $in: Object.values(insertResult.insertedIds) } })
          .toArray();
        const dataMigration = new DataMigration({
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
  });
});
