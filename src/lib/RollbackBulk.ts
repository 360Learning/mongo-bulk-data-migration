import { AbstractBulkOperationResults } from './AbstractBulkOperationResults';

import type { Document, ObjectId } from 'mongodb';
import type { BulkOperationResult } from './AbstractBulkOperationResults';

export class RollbackBulk<
  TSchema extends Document,
> extends AbstractBulkOperationResults<TSchema> {
  public logExecutionStatus(executionResults: BulkOperationResult): this {
    this.logger.info(
      this.buildLogObject(executionResults),
      'Documents rollback is successful',
    );
    return this;
  }

  public addRollbackOperation(operation: any, objectId: ObjectId): this {
    this.totalBulkOps++;
    this.bulk.find({ _id: objectId }).upsert().update(operation);
    return this;
  }
}
