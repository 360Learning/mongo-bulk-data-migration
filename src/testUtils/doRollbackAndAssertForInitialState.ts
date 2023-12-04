import _ from 'lodash';
import MongoBulkDataMigration from '../MongoBulkDataMigration';
import { BulkOperationResult } from '../lib/AbstractBulkOperationResults';

let globalExpect = null;

export function setGlobalExpect(expect: any) {
  globalExpect = expect;
}

export async function doRollbackAndAssertForInitialState(
  dataMigration: MongoBulkDataMigration<any>,
  initialDocuments: any[],
  {
    expect = globalExpect,
    expectedRollbackStatus = {},
  }: {
    expect: any;
    expectedRollbackStatus?: Partial<BulkOperationResult>;
  } = { expect: globalExpect, expectedRollbackStatus: {} },
): Promise<void> {
  const { collectionName, migrationInfos } = dataMigration.getInfos();
  const rollbackStatus = await dataMigration.rollback();
  const documentsAfterRollback = await migrationInfos.db
    .collection(collectionName)
    .find({})
    .toArray();

  assertDeepEquals(
    expect,
    JSON.parse(JSON.stringify(documentsAfterRollback)),
    JSON.parse(JSON.stringify(initialDocuments)),
  );
  const expectedPartialRollback = _.pick(
    rollbackStatus,
    Object.keys(expectedRollbackStatus),
  );
  assertDeepEquals(expect, expectedPartialRollback, expectedRollbackStatus);

  // Safe to rollback twice
  const rollbackStatus2 = await dataMigration.rollback();
  const expectedRollbackProps = _.pick(rollbackStatus2, [
    'nModified',
    'nMatched',
  ]);
  assertDeepEquals(expect, expectedRollbackProps, {
    nModified: 0,
    nMatched: 0,
  });
}

function assertDeepEquals(expect: any, input: any, expected: any) {
  if (expect === null) {
    throw new Error(
      'MongoBulkDataMigration error: expect lib is not set, use setGlobalExpect once in a global pre test hook, or specify it alongside doRollbackAndAssertForInitialState',
    );
  }

  const isJest = !!expect.anything;
  const isChai = !!expect.to;
  if (!isJest && !isChai) {
    throw new Error(
      'MongoBulkDataMigration error: expect lib does not look to be Jest or Chai supported libs',
    );
  }

  if (isJest) {
    expect(input).toEqual(expected);
  } else {
    expect(input).to.deep.equal(expected);
  }
}
