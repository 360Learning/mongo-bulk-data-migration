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

  // Test on inserted data [doc1, doc2...]
  // Note: docs can be mis-sorted
  assertDeepHaveMembers(
    expect,
    JSON.parse(JSON.stringify(documentsAfterRollback)),
    JSON.parse(JSON.stringify(initialDocuments)),
  );

  // Test on Bulk status { nUpdated: 0, ... }
  // Test on inserted data
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

function assertDeepHaveMembers(
  expect: any,
  effectiveDocs: any,
  expectedDocs: any,
) {
  const compareObjectId = (objA, objB) => {
    const sortedIds = [objA, objB].sort();
    return sortedIds[0] === objA ? -1 : 1;
  };
  const sortedEffectiveDocs = _.clone(effectiveDocs).sort(
    (docA: any, docB: any) =>
      compareObjectId(docA._id.toString(), docB._id.toString()),
  );
  const sortedExpectedDocs = _.clone(expectedDocs).sort(
    (docA: any, docB: any) =>
      compareObjectId(docA._id.toString(), docB._id.toString()),
  );

  return assertDeepEquals(expect, sortedEffectiveDocs, sortedExpectedDocs);
}

function assertDeepEquals(expect: any, input: any, expected: any) {
  const jestOrChai = assertAndGetChaiOrChai(expect);

  if (jestOrChai === 'jest') {
    expect(input).toEqual(expected);
  } else {
    expect(input).to.deep.equal(expected);
  }
}

function assertAndGetChaiOrChai(expect: any) {
  if (expect === null) {
    throw new Error(
      'MongoBulkDataMigration error: expect lib is not set, use setGlobalExpect once in a global pre test hook, or specify it alongside doRollbackAndAssertForInitialState',
    );
  }

  const isJest = !!expect.anything;
  const isChai = !!expect.fail;
  if (!isJest && !isChai) {
    throw new Error(
      'MongoBulkDataMigration error: expect lib does not look to be Jest or Chai supported libs',
    );
  }

  return isJest ? 'jest' : 'chai';
}
