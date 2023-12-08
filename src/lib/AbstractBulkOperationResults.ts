import _ from 'lodash';

import type { LoggerInterface } from '../types';
import type {
  ObjectId,
  Collection,
  UnorderedBulkOperation,
  Document,
  WriteConcernError,
  WriteError,
} from 'mongodb';

export const INITIAL_BULK_INFOS = {
  insertedIds: [],
  nInserted: 0,
  nMatched: 0,
  nModified: 0,
  nRemoved: 0,
  nUpserted: 0,
  ok: 1,
  upserted: [],
  writeConcernErrors: [],
  writeErrors: [],
};

export interface BulkOperationResult {
  insertedIds: ObjectId[];
  nInserted: number;
  nMatched: number;
  nModified: number;
  nRemoved: number;
  nUpserted: number;
  ok: number;
  upserted: ObjectId[];
  writeConcernErrors: WriteConcernError[];
  writeErrors: WriteError[];
}

export const NO_COUNT_AVAILABLE = -1;

export abstract class AbstractBulkOperationResults<TSchema extends Document> {
  protected readonly collection: Collection<TSchema>;
  protected readonly results: BulkOperationResult;
  protected bulk: UnorderedBulkOperation;
  protected totalBulkOps: number;
  protected readonly totalOperations: number | typeof NO_COUNT_AVAILABLE;
  protected readonly logger: LoggerInterface;

  constructor(
    collection: Collection<TSchema>,
    logger: LoggerInterface,
    totalOperations: number,
  ) {
    this.collection = collection;
    this.totalOperations = totalOperations;
    this.logger = logger;
    this.totalBulkOps = 0;
    this.results = _.cloneDeep(INITIAL_BULK_INFOS);
    this.initialize();
  }

  abstract logExecutionStatus(executionResults: BulkOperationResult): this;

  get size() {
    return this.totalBulkOps;
  }

  get progress(): number {
    if (this.totalOperations === NO_COUNT_AVAILABLE) {
      return Infinity;
    }
    return (this.totalOperationsDone / this.totalOperations) * 100;
  }

  get totalOperationsDone() {
    return (
      this.results.nMatched + this.results.nUpserted + this.results.nInserted
    );
  }

  private initialize(): this {
    this.bulk = this.collection.initializeUnorderedBulkOp();
    this.totalBulkOps = 0;
    return this;
  }

  public async execute(continueOnBulkWriteError = false): Promise<this> {
    if (this.totalBulkOps === 0) {
      return this;
    }

    const bulkResponse = await this.bulk.execute().catch((err) => {
      if (
        continueOnBulkWriteError &&
        err?.constructor.name === 'MongoBulkWriteError'
      ) {
        return err.result;
      }
      throw err;
    });

    // map data for backward compatibility when migrating from driver v4 to v5
    const resultPartial = {
      insertedIds: Object.values(bulkResponse.insertedIds) as ObjectId[],
      nInserted: bulkResponse.insertedCount,
      nMatched: bulkResponse.matchedCount,
      nModified: bulkResponse.modifiedCount,
      nRemoved: bulkResponse.deletedCount,
      nUpserted: bulkResponse.upsertedCount,
      ok: bulkResponse.ok,
      upserted: Object.values(bulkResponse.upsertedIds) as ObjectId[],
      writeConcernErrors: [bulkResponse.getWriteConcernError()].filter(
        isDefined,
      ),
      writeErrors: bulkResponse.getWriteErrors(),
    };
    this.mergeResults(resultPartial);
    this.logExecutionStatus(resultPartial);

    return this.initialize();
  }

  private mergeResults(resultB: BulkOperationResult): this {
    this.results.nInserted += resultB.nInserted;
    this.results.nMatched += resultB.nMatched;
    this.results.nModified += resultB.nModified;
    this.results.nRemoved += resultB.nRemoved;
    this.results.nUpserted += resultB.nUpserted;
    this.results.ok = this.results.ok && resultB.ok;

    /**
     * ObjectId are not returned by default in production scripts for memory concern
     * Count ~1Gb memory every 1 million entries to store ObjectIds
     */
    if (process.env.NODE_ENV === 'test') {
      this.results.insertedIds.push(...resultB.insertedIds);
      this.results.upserted.push(...resultB.upserted);
    }
    this.results.writeConcernErrors.push(...resultB.writeConcernErrors);
    this.results.writeErrors.push(...resultB.writeErrors);
    this.results.nMatched += resultB.writeErrors.length;
    return this;
  }

  public getResults(): BulkOperationResult {
    return this.results;
  }

  protected buildLogObject(executionResults: BulkOperationResult) {
    const usefulLogEntries = Object.entries(executionResults)
      .filter(([key]) => !['insertedIds', 'upserted'].includes(key))
      .filter(([, value]) => !_.isEmpty(value) || value > 0);
    const progress = this.progress;
    const formattedPercent = Number.isFinite(progress)
      ? progress.toFixed(2)
      : 'N/A';

    return {
      ...Object.fromEntries(usefulLogEntries),
      progress: {
        totalOperationsDone: this.totalOperationsDone,
        estimatedTotalOperations:
          this.totalOperations === NO_COUNT_AVAILABLE
            ? 'N/A'
            : this.totalOperations,
        percent: formattedPercent,
      },
    };
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
