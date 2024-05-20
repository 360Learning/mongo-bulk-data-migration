import type {
  Db,
  Filter,
  FindOptions,
  UpdateFilter,
  ObjectId,
  Document,
} from 'mongodb';
import type { DELETE_OPERATION } from './lib/MigrationBulk';
import { DELETE_COLLECTION } from './MongoBulkDataMigration';

export type DataMigrationOptions<TSchema> = {
  /** Disable document validation temporarily on the rollback process */
  bypassRollbackValidation: boolean;
  /** Disable document validation temporarily on the update process */
  bypassUpdateValidation: boolean;
  /** When counting drops performance before the migration _(un-indexed results or aggregation)_, turn this on */
  dontCount: boolean;
  /** When set to true, for an update, MongoBulkWriteError (only) won't stop the update operation and be accumulated in the return response */
  continueOnBulkWriteError: boolean;
  /** Maximum operations simultaneously submitted to Mongo to be bulk processed. Nominal value is [100 - 5000], adjust to desired logging noise. */
  maxBulkSize: number;
  /** Maximum of update function called simultaneously */
  maxConcurrentUpdateCalls: number;
  /** Deactivate the automatic backup logic */
  noBackup: boolean;
  /** Restricted projection which will be backed up - use this if you need all `projection` keys to compute the update, but you are editing a subset */
  projectionBackupFilter?: Array<keyof TSchema>;
  /** Idle time (in ms) after a bulk write - use this to decrease Database resource usage */
  throttle: number;
};

export type RollbackDocument = {
  _id: ObjectId;
  date: Date;
  backup: any;
  updateQuery: string;
};

export type RollBackUpdateObject = {
  $set?: any;
  $unset?: any;
};

export type MongoPipeline = object[];

export type MigrationInfos<TSchema extends Document> = {
  db: Db;
  operation?: typeof DELETE_COLLECTION;
  projection: FindOptions<TSchema>['projection'];
  rollback?: (backup?: RollbackDocument['backup']) => RollBackUpdateObject;
  query: Filter<TSchema> | MongoPipeline;
  update:
    | UpdateFilter<TSchema>
    | typeof DELETE_OPERATION
    | ((
        arg: TSchema | UpdateFilter<TSchema>,
      ) => Promise<UpdateFilter<TSchema>> | UpdateFilter<TSchema>);
};

export type DataMigrationConfig<TSchema extends Document> =
  | DMInstanceSpecialOperation<TSchema>
  | DMInstanceSpecialOperationDropDocument<TSchema>
  | DMInstanceAggregate<TSchema>
  | DMInstanceFilter<TSchema>
  ;

type DMInstanceSpecialOperationDropDocument<TSchema> = Omit<DMInstanceFilter<TSchema>, "projection"> & {
  update: typeof DELETE_OPERATION
}

type DMInstanceAggregate<TSchema> = DMInstanceBase<TSchema> & {
  query: MongoPipeline;
};

export type DMInstanceSpecialOperation<TSchema> = Pick<
  DMInstanceBase<TSchema>,
  'db' | 'id' | 'collectionName' | 'logger' | 'options'
> & {
  operation: typeof DELETE_COLLECTION;
};

export type DMInstanceFilter<TSchema extends Document> =
  DMInstanceBase<TSchema> & {
    /** Projected properties (and backed up values) */
    projection: FindOptions<TSchema>['projection'];
    /** Mongo query for documents to migrate OR mongo aggregation pipeline */
    query: Filter<TSchema>;
  };

type DMInstanceBase<TSchema> = {
  /** Targeted collection */
  collectionName: string;
  /** Db instance */
  db: Db;
  /** A unique script identifier (script name) - will be the rollback collection suffix. */
  id: string;
  /** Optional logger with 'info' method to show migration progress */
  logger?: LoggerInterface;
  /** Advanced */
  options?: Partial<DataMigrationOptions<TSchema>>;
  /** Your custom rollback callback. Use this is DM can't rollback automatically to initial document state. */
  rollback?: (backup: RollbackDocument['backup']) => RollBackUpdateObject;
  /** Use DELETE_OPERATION Symbol to delete documents */
  update:
    | UpdateFilter<TSchema>
    | typeof DELETE_OPERATION
    | ((
        arg: TSchema,
      ) => Promise<UpdateFilter<TSchema>> | UpdateFilter<TSchema>);
};

export type LoggerInterface = {
  info: (...params: any[]) => void;
  warn: (...params: any[]) => void;
};

export interface RollbackableUpdate {
  setLogger(logger: LoggerInterface): void;
  rollback(): Promise<any>;
  update(): Promise<any>;
}
