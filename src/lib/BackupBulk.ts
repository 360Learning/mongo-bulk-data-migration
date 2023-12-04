import { AbstractBulkOperationResults } from './AbstractBulkOperationResults';

import type { Document, WithId } from 'mongodb';
import type { BulkOperationResult } from './AbstractBulkOperationResults';

export class BackupBulk<
  TSchema extends Document,
> extends AbstractBulkOperationResults<TSchema> {
  public logExecutionStatus(executionResults: BulkOperationResult): this {
    this.logger.info(
      this.buildLogObject(executionResults),
      'Documents backup is successful',
    );
    return this;
  }

  public addInsertOperation(
    document: WithId<TSchema>,
    rollbackDocument: any,
  ): this {
    this.totalBulkOps++;
    this.bulk
      .find({ _id: document._id })
      .upsert()
      .updateOne({ $setOnInsert: rollbackDocument });
    return this;
  }
}
