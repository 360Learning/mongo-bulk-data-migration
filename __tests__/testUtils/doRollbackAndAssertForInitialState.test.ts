import type { FindOptions } from 'mongodb';
import { ObjectId } from 'mongodb';
import { MongoBulkDataMigration } from '../../src';
import { doRollbackAndAssertForInitialState } from '../../src/testUtils';

type SampleDoc = {
  prop: string;
};

describe('doRollbackAndAssertForInitialState', () => {
  let dataMigration: MongoBulkDataMigration<any>;

  afterEach(async () => {
    await dataMigration.clean().catch(() => {});
  });

  function buildMigration(
    projection: FindOptions<SampleDoc>['projection'] = { prop: 1 },
  ) {
    const db = global.db;
    const collection = 'sampleCollection';
    const query = { prop: 'invalid' };
    const update = { $set: { prop: 'valid' } };
    return new MongoBulkDataMigration<SampleDoc>({
      db,
      id: 'UID',
      collectionName: collection,
      query,
      projection,
      update,
      options: {},
    });
  }

  it('should resolve for matching documents', async () => {
    dataMigration = buildMigration({ prop: 1 });
    const initialUsers = [{ _id: new ObjectId(), prop: 'invalid' }];
    await global.db.collection('sampleCollection').insertOne(initialUsers[0]);
    await dataMigration.update();

    const doRollbackAndAssertForInitialStatePromise =
      doRollbackAndAssertForInitialState(dataMigration, initialUsers, {
        expect,
      });

    await expect(doRollbackAndAssertForInitialStatePromise).resolves.not.toBe(
      null,
    );
  });

  it('should throw for a wrong projection', async () => {
    dataMigration = buildMigration({ _id: 1 }); // prop is missing
    const initialUsers = [{ _id: new ObjectId(), prop: 'invalid' }];
    await global.db.collection('sampleCollection').insertOne(initialUsers[0]);
    await dataMigration.update();

    const doRollbackAndAssertForInitialStatePromise =
      doRollbackAndAssertForInitialState(dataMigration, initialUsers, {
        expect,
      });

    await expect(doRollbackAndAssertForInitialStatePromise).rejects.toThrow();
  });

  it('should throw if expect is not set', async () => {
    const doRollbackAndAssertForInitialStatePromise =
      doRollbackAndAssertForInitialState(dataMigration, []);

    await expect(doRollbackAndAssertForInitialStatePromise).rejects.toThrow(
      new Error(
        'MongoBulkDataMigration error: expect lib is not set, use setGlobalExpect once in a global pre test hook, or specify it alongside doRollbackAndAssertForInitialState',
      ),
    );
  });
});
