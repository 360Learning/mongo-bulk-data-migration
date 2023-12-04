# MongoDB bulk data migration for NodeJs

_Mongodb schema migration utility_

## About

`MongoBulkDataMigration` is a 1-liner MongoDb migration utility for your 1-shot schema migrations.
It is fast and resume-able, handles rollback automatically.

### Why MongoBulkDataMigration?

- 🚀 **fast**: built over [Mongo Bulk operations](https://docs.mongodb.com/manual/reference/method/Bulk/) to less stress the Mongo socket. Bulk is adapted to massive update as it groups write operations.

- 🏔️ **scalable**: working on 1 million / 1 billion documents is not an issue.
  Backup is done in a dedicated collection. Bulks can be throttled.

- 🔒 **safe and easy**: Backup and restore is done progressively by bulk.
  Whatever is fetched and projected is what is saved as backup. Script built over MBDM is explicit and focused.

- 🔄 **resume-able**: a script can be resumed if it crashes _(disconnection)_.
  By design, it's safe to run it twice in update or rollback mode.

- 💝 **minimal**: A "unified" extension script is handle by the platform to write less code.
  Also, the test util `doRollbackAndAssertForInitialState` will simplify test writing for Jest and Chai frameworks.

- 🏔️ **Aggregate-ready**: You can fetch using a simple query or an aggregation pipeline


### 🚫 Prerequisite to use DM

MBDM fits most needs, but not all needs.
Prerequisite:

- DM can't insert new documents
  _(you can only update or delete documents)_
- DM query has to not match an updated document _(this would break the resume-ability - use an aggregate pipeline for more complex queries)_
- DM can only update **1 collection at a time**
- DM can only update a document **once** for a same migration ID _(unless you clean backup manually in-between)_

### ✅ DM capabilities

Biggest features making DM powerful:

- DM can **automatically rollback** to the exact same state projected values:
  - for `$set` operations
  - for `$unset` operations
  - for document deletion operations
  - ... for anything more advanced, you can still rollback using a custom `rollback` function
- DM accepts basic Mongo queries, or **aggregation pipelines**,
- DM can compute a document update operation in an **async callback**, with a defined `maxConcurrentUpdateCalls`, allowing you to call a complex asynchronous code.
- DM makes chore script writing fast 🚀

---

## Usage & doc

### How does it work?

Overall steps:

1. Create an instance to `MongoBulkDataMigration` with the migration config

- Set a <migration_id> and at least mandatory type-safe parameters (`db`, `query`, `projection`, `update`),
- `const migrationInstance = new MongoBulkDataMigration({ ... })`

2. Run an update with `migrationInstance.update()`, which does a simple thing:

- A cursor fetches documents to update, computes an update operation, and stops when a bulk is ready,
- A first bulk will store back-up documents in the `_rollback_<migration_id>` collection
- A second bulk will update/delete docs
- logs will be displayed only after every bulk operations with the progress percent.

3. If anything is wrong, call `#rollback()`

- rollback will drop backup once the operation is successful,

