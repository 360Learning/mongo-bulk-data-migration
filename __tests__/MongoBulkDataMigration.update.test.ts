import _ from 'lodash';
import type { Collection, Db, Document, ObjectId, UpdateFilter } from 'mongodb';
import { MongoBulkDataMigration, DELETE_OPERATION } from '../src';
import { INITIAL_BULK_INFOS } from '../src/lib/AbstractBulkOperationResults';
import { LoggerInterface } from '../src/types';

const COLLECTION = 'testCollection';
const SCRIPT_ID = 'scriptId';

describe('MongoBulkDataMigration', () => {
  let db: Db;
  let collection: Collection;
  let rollbackCollection: Collection;
  let DM_DEFAULT_SETUP: {
    collectionName: string;
    db: Db;
    id: string;
    query: any;
    logger: LoggerInterface;
    projection: any;
  };

  beforeEach(async () => {
    db = global.db;
    collection = db.collection(COLLECTION);
    rollbackCollection = db.collection('_rollback_testCollection_scriptId');
    loggerMock = {
      info: jest.fn(),
      warn: jest.fn(),
    };
    DM_DEFAULT_SETUP = {
      collectionName: COLLECTION,
      db,
      id: SCRIPT_ID,
      query: {},
      logger: loggerMock,
      projection: {},
    };
  });
  let loggerMock: jest.Mocked<LoggerInterface>;

  afterEach(async () => {
    await db.collection('testCollection').deleteMany({});
    await db.collection('_rollback_testCollection_scriptId').deleteMany({});
  });

  describe('#update', () => {
    it('should perform the migration successfully', async () => {
      await collection.insertMany([{ key: 1 }, { key: 2 }, { key: 3 }]);
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        update: () => ({ $set: { key: 2 } }),
      });

      const updateResults = await dataMigration.update();

      const updatedDocuments = await collection
        .find({}, { projection: { _id: 0 } })
        .toArray();
      expect(updateResults).toEqual({
        ...INITIAL_BULK_INFOS,
        nMatched: 3,
        nModified: 2, // Second document were already { key: 2 }
      });
      expect(updatedDocuments).toEqual([{ key: 2 }, { key: 2 }, { key: 2 }]);
    });

    it('should perform the migration successfully without changing other properties', async () => {
      const insertResult = await collection.insertMany([
        { key: 1, other: 1 },
        { key: 2, other: 1 },
        { key: 3, other: 1 },
      ]);
      const insertedDocuments = await collection
        .find({ _id: { $in: Object.values(insertResult.insertedIds) } })
        .toArray();
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        update: () => ({ $set: { key: 2 } }),
      });

      await dataMigration.update();

      const updatedDocuments = await collection
        .find()
        .sort({ _id: 1 })
        .toArray();
      expect(updatedDocuments).toEqual([
        { key: 2, other: 1, _id: insertedDocuments[0]._id },
        { key: 2, other: 1, _id: insertedDocuments[1]._id },
        { key: 2, other: 1, _id: insertedDocuments[2]._id },
      ]);
    });

    it('should allow to continue a not ended migration', async () => {
      const insertResult = await collection.insertMany([
        { key: 1 },
        { key: 2 },
        { key: 3 },
      ]);
      const insertedDocuments = await collection
        .find({ _id: { $in: Object.values(insertResult.insertedIds) } })
        .toArray();
      let updateStubRunCount = 0;
      const udpateStub = jest.fn().mockImplementation(() => {
        updateStubRunCount++;
        if (updateStubRunCount === 2) {
          throw new Error('Migration error');
        } else {
          return { $set: { key: 10 } };
        }
      });
      const dataMigration = new MongoBulkDataMigration({
        ...DM_DEFAULT_SETUP,
        options: { maxBulkSize: 1 },
        update: udpateStub,
      });

      // First run
      const update1Promise = dataMigration.update();
      await expect(update1Promise).rejects.toThrow(
        new Error('Migration error'),
      );
      const backupedDocumentsAfterFailure = await rollbackCollection
        .find()
        .toArray();

      // Second run
      const update2Results = await dataMigration.update();

      const backupedDocuments = await rollbackCollection.find().toArray();
      expect(update2Results).toEqual({
        ...INITIAL_BULK_INFOS,
        nMatched: 3,
        nModified: 2,
      });
      expect(backupedDocumentsAfterFailure.length).toEqual(1);
      expect(backupedDocumentsAfterFailure[0].backup).toEqual(
        insertedDocuments[0],
      );
      expect(backupedDocuments.length).toEqual(3);
      expect(backupedDocuments.map(({ backup }) => backup)).toEqual(
        insertedDocuments,
      );
    });

    describe('Asynchronous updates', () => {
      let resolutionIndex: number;
      let updateStub: jest.SpyInstance;
      let updateQuery: any;

      beforeEach(() => {
        resolutionIndex = 0;
        updateQuery = async (doc: any) => {
          await new Promise((resolve) => setTimeout(resolve, doc.delay));
          return { $set: { returnPosition: ++resolutionIndex } };
        };
        updateStub = jest.fn().mockImplementation(updateQuery);
      });

      it('should perform async update one by one', async () => {
        await collection.insertMany([{ delay: 10 }, { delay: 0 }]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          options: { maxConcurrentUpdateCalls: 1 },
          update: updateStub,
        });

        await dataMigration.update();

        const promisedResults = updateStub.mock.results.map((res) => res.value);
        expect(await Promise.all(promisedResults)).toEqual([
          { $set: { returnPosition: 1 } },
          { $set: { returnPosition: 2 } },
        ]);
      });

      it('should perform parallel update', async () => {
        // Following comments illustrate concurrency cumulated delays: <BLOCKING_DELAY> [+ <BLOCKING_DELAY>] + TASK_TIME
        await collection.insertMany([
          { delay: 10 }, // ->10ms (0+10)
          { delay: 2 }, // ->  5ms (0+5)
          { delay: 1 }, // ->  6ms (5+1)
        ]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          options: { maxConcurrentUpdateCalls: 2 },
          update: updateStub,
        });

        await dataMigration.update();

        const promisedResults = updateStub.mock.results.map((res) => res.value);
        expect(await Promise.all(promisedResults)).toEqual([
          { $set: { returnPosition: 3 } },
          { $set: { returnPosition: 1 } },
          { $set: { returnPosition: 2 } },
        ]);
      });

      it('should stop parallelization everytime a bulk operation is executed', async () => {
        await collection.insertMany([
          { delay: 5 },
          { delay: 0 },
          { delay: 1 }, // Executed in the 2nd bulk ops
        ]);
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          options: {
            maxConcurrentUpdateCalls: 5,
            maxBulkSize: 2,
          },
          update: updateStub,
        });

        await dataMigration.update();

        const promisedResults = updateStub.mock.results.map((res) => res.value);
        const returnValues = await Promise.all(promisedResults);
        expect(
          returnValues
            .slice(0, 2)
            .sort((a, b) => a.$set.returnPosition - b.$set.returnPosition),
        ).toEqual([
          { $set: { returnPosition: 1 } },
          { $set: { returnPosition: 2 } },
        ]);
        expect(returnValues.slice(2, 3)).toEqual([
          { $set: { returnPosition: 3 } },
        ]);
      });
    });

    describe('Bulk splitting', () => {
      const END_OF_BULK_LOG = 'Documents migration is successful';
      let update: UpdateFilter<{ value: number }>;
      beforeEach(async () => {
        await collection.insertMany(
          Array.from({ length: 100 }, (_, i) => ({ value: i + 1 })),
        );
        update = ({ value }) => ({
          $set: { value: value * 2 },
        });
      });

      it('should perform updates in batches', async () => {
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          options: {
            maxBulkSize: 30,
            maxConcurrentUpdateCalls: 1000,
            rollbackable: false,
          },
          update,
        });

        await dataMigration.update();

        const batchSizes = loggerMock.info.mock.calls
          .filter(([_, msg]) => msg === END_OF_BULK_LOG)
          .map(([{ nModified }]) => nModified);
        expect(batchSizes).toEqual([30, 30, 30, 10]);
      });

      it('should perform updates in batches, event when not rollbackable', async () => {
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          options: {
            maxBulkSize: 30,
            maxConcurrentUpdateCalls: 1000,
            rollbackable: true,
          },
          update,
        });

        await dataMigration.update();

        const batchSizes = loggerMock.info.mock.calls
          .filter(([_, msg]) => msg === END_OF_BULK_LOG)
          .map(([{ nModified }]) => nModified);
        expect(batchSizes).toEqual([30, 30, 30, 10]);
      });
    });

    describe('Aggregate support', () => {
      it('should perform update for an aggregate pipeline', async () => {
        await collection.insertMany([
          { key: 1, letThis: true },
          { key: 1 },
          { key: 5 },
        ]);
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
          ],
          update: (doc: any) => ({ $set: { key: doc.key * 2 } }),
        });

        const updateResults = await dataMigration.update();

        const updatedDocuments = await collection
          .find({}, { projection: { _id: 0 } })
          .toArray();
        expect(updateResults).toEqual({
          ...INITIAL_BULK_INFOS,
          nMatched: 2,
          nModified: 2,
        });
        expect(updatedDocuments).toEqual([
          { key: 2, letThis: true },
          { key: 2 },
          { key: 5 },
        ]);
      });

      it('should concat projection to the pipeline', async () => {
        const insertResult = await collection.insertMany([{ a: 1, b: 2 }]);
        const incUpdateStub = jest.fn().mockResolvedValue({ $set: { b: 99 } });
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          projection: { b: 1 },
          query: [{ $match: { a: { $exists: true } } }],
          update: incUpdateStub,
        });

        await dataMigration.update();

        expect(incUpdateStub).toHaveBeenCalledWith({
          _id: insertResult.insertedIds[0],
          b: 2,
        });
      });

      it('should work even with zero matching documents', async () => {
        // test needed because the aggregation stage "$count" returns null when there is no document from the previous stage
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          query: [{ $match: {} }],
          update: () => ({ $set: { key: 1 } }),
        });

        const updateResults = await dataMigration.update();

        expect(updateResults).toEqual({
          ...INITIAL_BULK_INFOS,
          nMatched: 0,
          nModified: 0,
        });
      });
    });

    describe('Off validation support', () => {
      let invalidSampleDocId: ObjectId;

      beforeEach(async () => {
        await db.createCollection('sampleCollection');
        ({ insertedId: invalidSampleDocId } = await db
          .collection('sampleCollection')
          .insertOne({ forbiddenProp: true }));

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
      });
      afterEach(async () => {
        await db.dropCollection('sampleCollection');
      });

      it.skip('should reject update when validation is invalid', async () => {
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          collectionName: 'sampleCollection',
          update: { $set: { invalid_key: 'update' } },
        });

        const updatePromise = dataMigration.update();

        await expect(updatePromise).rejects.toThrow(
          new Error('Document failed validation'),
        );
      });

      it('should disable validation for the update process if specified', async () => {
        const dataMigration = new MongoBulkDataMigration({
          ...DM_DEFAULT_SETUP,
          collectionName: 'sampleCollection',
          update: { $set: { invalid_key: 'update' } },
          options: { bypassUpdateValidation: true },
        });

        await dataMigration.update();

        const updatedDoc = await db
          .collection('sampleCollection')
          .findOne({ _id: invalidSampleDocId });
        expect((updatedDoc as any).invalid_key).toEqual('update');
      });
    });

    describe('options.continueOnBulkWriteError set to true', () => {
      it('should continue on MongoBulkWriteError and keep writeErrors', async () => {
        await collection.insertMany([{ key: 1 }, { key: 2 }, { key: 2 }]);
        const dataMigration = new MongoBulkDataMigration<Document>({
          ...DM_DEFAULT_SETUP,
          options: { continueOnBulkWriteError: true, maxBulkSize: 1 },
          update: ({ key }) => {
            if (key === 2) {
              return { $set: { $nonAllowedChar: 'any' } };
            }
            return { $set: { key: 10 } };
          },
        });

        const updatePromise = dataMigration.update();

        const updateResponse = await updatePromise;
        expect(_.pick(updateResponse, ['nMatched', 'nModified', 'ok'])).toEqual(
          {
            nMatched: 3,
            nModified: 1,
            ok: 1,
          },
        );
        expect(updateResponse.writeErrors.length).toEqual(2);
        expect(updateResponse.writeErrors[0].err.errmsg).toContain(
          "The dollar ($) prefixed field '$nonAllowedChar' in '$nonAllowedChar' is not allowed in the context",
        );
      });
    });

    describe('options.rollbackable set to false', () => {
      it('should not insert any backup documents', async () => {
        await collection.insertMany([{ key: 1 }, { key: 2 }, { key: 2 }]);
        const dataMigration = new MongoBulkDataMigration<Document>({
          ...DM_DEFAULT_SETUP,
          options: { rollbackable: false },
          update: { $set: { value: 10 } },
        });

        await dataMigration.update();

        const rollbackCollectionSize = await rollbackCollection.count();
        expect(rollbackCollectionSize).toEqual(0);
        expect(loggerMock.warn).not.toHaveBeenCalled();
      });
    });
  });

  describe('#delete', () => {
    it('should perform the delete operation', async () => {
      await collection.insertMany([{ key: 1 }, { key: 2 }, { key: 3 }]);
      const dataMigration = new MongoBulkDataMigration({
        ..._.omit(DM_DEFAULT_SETUP, 'projection'),
        query: { key: 2 },
        update: DELETE_OPERATION,
      });

      const updateResults = await dataMigration.update();

      const updatedDocuments = await collection
        .find({}, { projection: { _id: 0 } })
        .toArray();
      expect(updateResults).toEqual({
        ...INITIAL_BULK_INFOS,
        nRemoved: 1,
      });
      expect(updatedDocuments).toEqual([{ key: 1 }, { key: 3 }]);
    });
  });
});
