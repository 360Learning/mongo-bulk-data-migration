/* eslint-disable no-console */
import _ from 'lodash';
import pLimit from 'p-limit';
import { DELETE_OPERATION, MigrationBulk } from './lib/MigrationBulk';
import { BackupBulk } from './lib/BackupBulk';
import type { BulkOperationResult } from './lib/AbstractBulkOperationResults';
import { NO_COUNT_AVAILABLE } from './lib/AbstractBulkOperationResults';
import { RollbackBulk } from './lib/RollbackBulk';
import { computeRollbackQuery } from './lib/computeRollbackQuery';

import type {
  DataMigrationConfig,
  DataMigrationOptions,
  DMInstanceFilter,
  DMInstanceSpecialOperation,
  LoggerInterface,
  MigrationInfos,
  MongoPipeline,
  RollbackableUpdate,
  RollbackDocument,
  RollBackUpdateObject,
} from './types';
import type { Collection, Document, ObjectId, WithId } from 'mongodb';

const DEFAULT_BULK_SIZE = 5000;
const COUNT_TOO_LONG_WARNING_THRESHOLD_MS = 30000;
const COLLECTION_VALIDATION_LEVEL = 'moderate';
/** Fully delete collection, use with operation:DELETE_COLLECTION */
export const DELETE_COLLECTION = Symbol();
const defaultLogger = {
  info: (...args: unknown[]) => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    console.log({ ENV: process.env.NODE_ENV });
    console.log.call(console, args);
  },
  warn: (...args: unknown[]) => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    console.warn.call(console, args);
  },
};

export default class MongoBulkDataMigration<TSchema extends Document>
  implements RollbackableUpdate
{
  private readonly options: DataMigrationOptions<TSchema> = {
    bypassRollbackValidation: false,
    bypassUpdateValidation: false,
    continueOnBulkWriteError: false,
    dontCount: false,
    maxBulkSize: DEFAULT_BULK_SIZE,
    maxConcurrentUpdateCalls: 10,
    rollbackable: true,
    throttle: 0,
  };

  private readonly collectionName: string;
  private readonly id: string;
  private readonly migrationInfos: MigrationInfos<TSchema>;
  private logger: LoggerInterface;

  /**
   * Handles massive migrations, support for rollback.
   * @see <a href="/doc/softwareDesigns/bulkDataMigration/index.md">More information in the software design document</a>
   * @param config
   */
  constructor(config: DataMigrationConfig<TSchema>) {
    this.id = config.id;
    this.collectionName = config.collectionName;
    Object.assign(this.options, { ...config.options });

    this.migrationInfos = {
      db: config.db,
      operation: (config as DMInstanceSpecialOperation<TSchema>).operation,
      projection: (config as DMInstanceFilter<TSchema>).projection,
      rollback: (config as DMInstanceFilter<TSchema>).rollback,
      query: (config as DMInstanceFilter<TSchema>).query,
      update: (config as DMInstanceFilter<TSchema>).update,
    };

    this.logger = config.logger ?? defaultLogger;
  }

  public setLogger(logger: LoggerInterface) {
    this.logger = logger;
  }

  public getInfos() {
    return {
      id: this.id,
      migrationInfos: this.migrationInfos,
      collection: this.getCollection(),
      collectionName: this.collectionName,
    };
  }

  private async getRollbackCollection(): Promise<Collection<TSchema>> {
    return this.migrationInfos.db.collection(this.getRollbackCollectionName());
  }

  private getRollbackCollectionName(): string {
    return `_rollback_${this.collectionName}_${this.id}`;
  }

  private getCollection(): Collection<TSchema> {
    return this.migrationInfos.db.collection(this.collectionName);
  }

  async update(): Promise<BulkOperationResult> {
    const migrationCollection = this.getCollection();
    const rollbackCollection = await this.getRollbackCollection();

    if (this.migrationInfos.operation === DELETE_COLLECTION) {
      const status = await this.renameCollection(
        this.collectionName,
        this.getRollbackCollectionName(),
      );
      return { ok: status ? 1 : 0 } as any;
    }

    await this.lowerValidationLevel('update');
    const { cursor, totalEntries } = await this.getCursorAndCount(
      migrationCollection,
    );
    const formattedTotalEntries =
      totalEntries === NO_COUNT_AVAILABLE
        ? 'N/A (dontCount option ON)'
        : totalEntries;
    this.logger.info(
      {
        collectionName: this.collectionName,
        id: this.id,
        totalEntries: formattedTotalEntries,
      },
      'Starting migration UPDATE process',
    );
    const bulkMigration = new MigrationBulk(
      migrationCollection,
      this.logger,
      totalEntries,
    );
    const bulkBackup = new BackupBulk(
      rollbackCollection,
      this.logger,
      totalEntries,
    );
    const updatePromiseLimiter = pLimit(this.options.maxConcurrentUpdateCalls);
    let updatePromises: Promise<any>[] = [];

    let document = (await cursor.next()) as WithId<TSchema> | null;
    while (document !== null) {
      const bulkUpdateWrappedPromise = updatePromiseLimiter(
        this.buildBulkUpdater(document, bulkBackup, bulkMigration),
      );
      updatePromises.push(bulkUpdateWrappedPromise);

      document = (await cursor.next()) as WithId<TSchema> | null;
      if (!document || updatePromises.length >= this.options.maxBulkSize) {
        await Promise.all(updatePromises);
        const backupRes = (await bulkBackup.execute()).getResults();
        const updateRes = (
          await bulkMigration.execute(this.options.continueOnBulkWriteError)
        ).getResults();

        if (this.options.rollbackable) {
          const totalNewBackupDocs = backupRes.nUpserted + backupRes.nInserted;
          const totalUpdatedDocument = updateRes.nModified + updateRes.nRemoved;
          if (totalNewBackupDocs < totalUpdatedDocument) {
            this.logger.warn(
              { totalNewBackupDocs, totalUpdatedDocument },
              "The number of backup documents should be equal to the total updated documents. Check your query is idempotent or ensure you don't use a same migration id for different migrations.",
            );
          }
        }

        await this.throttle();
        updatePromises = [];
      }
    }

    this.logger.info(
      { collectionName: this.collectionName, id: this.id },
      'Ending migration UPDATE process',
    );
    await this.restoreValidationLevel('update');
    return bulkMigration.getResults();
  }

  private async getCursorAndCount(migrationCollection: Collection<TSchema>) {
    const cursor = getCursor(this.migrationInfos);
    const countTakingTooLongTimeout = setTimeout(
      () =>
        this.logger.warn(
          { COUNT_TOO_LONG_WARNING_THRESHOLD_MS },
          'Count is taking a significant amount of time, consider using dontCount:true option',
        ),
      COUNT_TOO_LONG_WARNING_THRESHOLD_MS,
    );
    const totalEntries = this.options.dontCount
      ? NO_COUNT_AVAILABLE
      : await getTotalEntries(this.migrationInfos);
    clearTimeout(countTakingTooLongTimeout);
    return { cursor, totalEntries };

    function getCursor({ query, projection }: MigrationInfos<TSchema>) {
      if (isPipeline(query)) {
        const pipelineWithProjection = query.concat(
          _.isEmpty(projection) ? [] : [{ $project: projection }],
        );
        return migrationCollection.aggregate(pipelineWithProjection);
      }
      return migrationCollection.find(query, { projection });
    }

    async function getTotalEntries({ query }: MigrationInfos<TSchema>) {
      if (isPipeline(query)) {
        const pipelineComputeTotal = query.concat({ $count: 'totalEntries' });
        const cursorComputeTotal =
          migrationCollection.aggregate(pipelineComputeTotal);
        const total = (await cursorComputeTotal.next()) as unknown as {
          totalEntries: number;
        } | null;
        return total === null ? 0 : total.totalEntries;
      }
      return migrationCollection.countDocuments(query);
    }

    function isPipeline(
      query: MigrationInfos<TSchema>['query'],
    ): query is MongoPipeline {
      return Array.isArray(query);
    }
  }

  private buildBulkUpdater(
    document: WithId<TSchema>,
    bulkBackup: BackupBulk<TSchema>,
    bulkMigration: MigrationBulk<TSchema>,
  ): () => Promise<void> {
    return async () => {
      const updateQuery = _.isFunction(this.migrationInfos.update)
        ? await this.migrationInfos.update(_.cloneDeep(document))
        : this.migrationInfos.update;

      if (this.options.rollbackable) {
        const backupDocument = this.buildBackupDocument(
          document,
          updateQuery as MigrationInfos<TSchema>['update'],
        );
        bulkBackup.addInsertOperation(document, backupDocument);
      }

      bulkMigration.addUpdateOrRemoveOperation(
        updateQuery,
        document._id as ObjectId,
      );
    };
  }

  private buildBackupDocument(
    document: WithId<TSchema>,
    updateQuery: MigrationInfos<TSchema>['update'] | typeof DELETE_OPERATION,
  ): RollbackDocument {
    return {
      _id: document._id as ObjectId,
      backup: this.options.projectionBackupFilter
        ? _.pick(document, this.options.projectionBackupFilter)
        : document,
      date: new Date(),
      updateQuery: JSON.stringify(updateQuery),
    };
  }

  private async throttle() {
    if (this.options.throttle > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.options.throttle),
      );
    }
  }

  async rollback(): Promise<BulkOperationResult> {
    if (!this.options.rollbackable) {
      this.logger.warn('Calling rollback() on a non rollbackable script');
      return { ok: 1 } as any;
    }

    const collection = this.getCollection();
    const rollbackCollection = await this.getRollbackCollection();
    if (this.migrationInfos.operation === DELETE_COLLECTION) {
      const status = await this.renameCollection(
        this.getRollbackCollectionName(),
        this.collectionName,
      );
      return { ok: status ? 1 : 0 } as any;
    }

    const cursor = rollbackCollection.find({});
    const totalEntries = await rollbackCollection.countDocuments({});
    this.logger.info(
      { collectionName: this.collectionName, id: this.id, totalEntries },
      'Starting migration ROLLBACK process',
    );
    const bulkRollback = new RollbackBulk(
      collection,
      this.logger,
      totalEntries,
    );

    await this.lowerValidationLevel('rollback');
    let rollbackDocument =
      (await cursor.next()) as unknown as RollbackDocument | null;
    while (rollbackDocument !== null) {
      const updateQuery = await this.getRollbackUpdateQuery(rollbackDocument);
      if (this.migrationInfos.update === DELETE_OPERATION) {
        bulkRollback.addRollbackFullDocumentOperation(rollbackDocument.backup);
      } else {
        bulkRollback.addRollbackOperation(updateQuery, rollbackDocument._id);
      }

      rollbackDocument =
        (await cursor.next()) as unknown as RollbackDocument | null;
      if (!rollbackDocument || bulkRollback.size >= this.options.maxBulkSize) {
        await bulkRollback.execute();
      }
    }

    this.logger.info(
      { collectionName: this.collectionName, id: this.id },
      'Ending migration ROLLBACK process',
    );
    await this.clean();
    await this.restoreValidationLevel('rollback');
    return bulkRollback.getResults();
  }

  private async getRollbackUpdateQuery(
    obj: RollbackDocument,
  ): Promise<RollBackUpdateObject> {
    if (this.migrationInfos.rollback) {
      return this.migrationInfos.rollback(obj.backup);
    }

    const updateOperation = JSON.parse(obj.updateQuery);
    if (updateOperation === null) {
      return { $set: obj.backup };
    }

    return computeRollbackQuery(updateOperation, obj.backup);
  }

  private async lowerValidationLevel(action: 'rollback' | 'update') {
    if (this.canUpdateValidation(action)) {
      await this.setValidationLevel('off');
    }
  }

  private async restoreValidationLevel(action: 'rollback' | 'update') {
    if (this.canUpdateValidation(action)) {
      await this.setValidationLevel(COLLECTION_VALIDATION_LEVEL);
    }
  }

  private canUpdateValidation(action: 'rollback' | 'update') {
    return (
      (action === 'update' && this.options.bypassUpdateValidation) ||
      (action === 'rollback' && this.options.bypassRollbackValidation)
    );
  }

  private async setValidationLevel(validationLevel: 'moderate' | 'off') {
    await this.migrationInfos.db.command({
      collMod: this.collectionName,
      validationLevel,
    });
  }

  private async renameCollection(nameBefore: string, nameAfter: string) {
    try {
      await this.migrationInfos.db.renameCollection(nameBefore, nameAfter);
      return true;
    } catch (err: unknown) {
      this.logger.warn({ err }, "Couldn't rename collection");
      return false;
    }
  }

  async clean(): Promise<void> {
    const migrationCollectionName = this.getRollbackCollectionName();
    const migrationCollection = await this.getRollbackCollection();
    this.logger.info(
      { migrationCollectionName },
      'Deleting migration rollback collection',
    );

    try {
      await migrationCollection.drop();
    } catch (err) {
      if (err?.message === 'ns not found') {
        return;
      }
      throw err;
    }
  }
}
