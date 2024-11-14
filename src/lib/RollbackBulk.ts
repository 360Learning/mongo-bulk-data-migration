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

  public addRollbackOperation(
    operation: any,
    objectId: ObjectId,
    arrayFilters: Document[],
  ): this {
    this.totalBulkOps++;

    if (arrayFilters.length === 0) {
      this.bulk.find({ _id: objectId }).update(operation);
    } else {
      this.bulk
        .find({ _id: objectId })
        .arrayFilters(arrayFilters)
        .update(operation);
    }

    return this;
  }

  public addRollbackFullDocumentOperation(document: any): this {
    this.totalBulkOps++;
    this.bulk.insert(document);
    return this;
  }
}
