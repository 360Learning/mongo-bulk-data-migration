import { AbstractBulkOperationResults } from './AbstractBulkOperationResults';

import type { Document, ObjectId, UpdateFilter } from 'mongodb';
import type { BulkOperationResult } from './AbstractBulkOperationResults';

export const DELETE_OPERATION = Symbol();

export class MigrationBulk<
  TSchema extends Document,
> extends AbstractBulkOperationResults<TSchema> {
  public logExecutionStatus(executionResults: BulkOperationResult): this {
    this.logger.info(
      this.buildLogObject(executionResults),
      'Documents migration is successful',
    );
    return this;
  }

  public addUpdateOrRemoveOperation(
    updateQuery: UpdateFilter<TSchema> | typeof DELETE_OPERATION,
    objectId: ObjectId,
    arrayFilters: Document[],
  ): this {
    if (updateQuery === DELETE_OPERATION) {
      return this.addRemoveOperation(objectId);
    }
    return this.addUpdateOperation(updateQuery, objectId, arrayFilters);
  }

  public addUpdateOperation(
    updateQuery: UpdateFilter<TSchema>,
    objectId: ObjectId,
    arrayFilters: Document[],
  ): this {
    this.totalBulkOps++;

    if (arrayFilters.length === 0) {
      this.bulk.find({ _id: objectId }).update(updateQuery);
    } else {
      this.bulk
        .find({ _id: objectId })
        .arrayFilters(arrayFilters)
        .update(updateQuery);
    }

    return this;
  }

  public addRemoveOperation(objectId: ObjectId): this {
    this.totalBulkOps++;
    this.bulk.find({ _id: objectId }).deleteOne();
    return this;
  }
}
