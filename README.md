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

### 🚫 Prerequisite to use MBDM

MBDM fits most needs, but not all needs.
Prerequisite:

- MBDM can't insert new documents
  _(you can only update or delete documents)_
- MBDM can only update **1 collection at a time**
- MBDM can only update a document **once** for a same migration ID _(unless you clean backup manually in-between)_
  - queries should ideally not match an already updated document _(for resume-ability)_

### ✅ MBDM capabilities

Biggest features making MBDM powerful:

- MBDM can **automatically rollback** to the exact same state projected values:
  - for `$set` operations
  - for `$unset` operations
  - for document deletion operations
  - ... for anything more advanced, you can still rollback using a custom `rollback` function
- MBDM accepts basic Mongo queries, or **aggregation pipelines**,
- MBDM can compute a document update operation in an **async callback**, with a defined `maxConcurrentUpdateCalls`, allowing you to call a complex asynchronous code.
- MBDM makes chore script writing fast 🚀

### Support logs

MBDM

---

## 📘 Getting Started

### Install MBDM

Using npm

```bash
npm install --save-dev @360-l/mongo-bulk-data-migration
```

### Run migration `update()` and `rollback()`

MBDM expects a connection to your database, a id (string), and a target collection to process.

```ts
import { MongoBulkDataMigration } from "@360-l/mongo-bulk-data-migration";

// connect to db
// handle script input

const migration = new MongoBulkDataMigration({
    db: mongoClient,       // MongoClient established instance
    collection: "myCol",   // Collection where there will be an update
    id: "uid_migration",   // Required to rollback storage
    ... // see below for query/update
});

// Do the update
await migration.update();

// Or revert updated properties (only) in all updated documents
await migration.rollback();
```

MBDM does not provide CLI tool. You can consider to create some structural abstract code to run it like.
As an example here:

```bash
node ./myscript.ts --action [update|rollback]
```

### Simple $set example

This migration will set `{ total: 0 }` for every doc not having 0.

_Note: rollback will automatically unset back total._

```ts
new MongoBulkDataMigration<Score>({
  db,
  id: 'scores_set_total',
  collectionName: 'scores',
  projection: {},
  query: { total: { $exists: false } },
  update: { $set: { total: 0 } },
});
```

## ⚙️ Options

```ts
new MongoBulkDataMigration({ ..., options: { ... } })
```

- `maxBulkSize` (default: 1000): Batch size of of updates to execute. 1000 is a good number. If your updated are huge, consider decreasing it to avoid running high memory. If documents are tiny, 10k might slightly improve performances on huge databases.
- `dontCount` (default: false): will skip initial filter `count()` or aggregate `$count`. Logs won't print the total progression if disabled.
- `projectionBackupFilter` (default: none): filter properties to save and auto-rollback. Necessary if your update needs virtual fields.
- `bypassRollbackValidation` and `bypassUpdateValidation` (default: false): Will set validationLevel to "off" then to "moderate".
- `throttle` (default: 0): amount of time to sleep between a bulk update. Use this to decrease database stress.
- `continueOnBulkWriteError` (default: false): will continue the migration on the error in a bulk.

## 📕 Advanced usages

MBDM has support for async updates query, custom rollback, aggregation pipelines...

### Simple $set with update callback and projection

This migration will sum 2 projected fields `scoreA` and `scoreB` for all documents (no filter).

_Note: rollback will automatically set back `scoreA` and `scoreB` and reset `total`._

```ts
new MongoBulkDataMigration<Score>({
  db,
  id: 'scores_total_new_field',
  collectionName: 'scores',
  projection: { scoreA: 1, scoreB: 1 },
  query: {},
  update: (doc) => {
    $set: {
      total: doc.scoreA + doc.scoreB;
    }
  },
});
```

### Delete documents (`update: DELETE_OPERATION`)

This migration will delete doc having negative `total`.

_Note: rollback will automatically restore full document._

```ts
import { MongoBulkDataMigration, DELETE_OPERATION } from "@360-l/mongo-bulk-data-migration";
...
new MongoBulkDataMigration<Score>({
    db,
    id: "delete_negative_total",
    collectionName: "scores",
    projection: {}, // Everything needs to be projected
    query: { total: { $lt: 0 } },
    update: DELETE_OPERATION,
});
```

### Using aggregation pipeline (`query`)

`query` expects a query (object), or an aggregation pipeline (array).
Note: `projection` won't do anything.

_Example: update `totalGames` of a corresponding table_

```ts
import { MongoBulkDataMigration } from "@360-l/mongo-bulk-data-migration";
...
new MongoBulkDataMigration<Score>({
    db,
    id: "delete_negative_total",
    collectionName: "scores",
    query: [
        { $lookup: { localField: "games", ... } },
        { $match: { "games.value": "xxx" } },
        { $project: { "games.value": 1, totalGames: 1, _id: 1 } },
    },
    update: (doc) => ({
        ...doc,
        totalGames: doc.games.value
    }),
    options: {
        projectionBackupFilter: ["totalGames"] // Necessary to save only totalGames, not games.value in the backup document
    }
});
```

### Delete a collection (`operation: DELETE_COLLECTION`)

The collection will be renamed to the backup collection.
When you rollback, the collection will simply be renamed back

```ts
import { MongoBulkDataMigration, DELETE_OPERATION } from "@360-l/mongo-bulk-data-migration";
...
const migration status = new MongoBulkDataMigration<Score>({
    db,
    id: "delete_collection_scores",
    collectionName: "scores",
    operation: DELETE_OPERATION,
});
console.log(status); // { ok: 1 }
```

## 🧩 Ease testing

MBDM provides to simplify your tests files. Just writes what you expect, and the util will ensure the database is back to initia state.
It supports for Jest and Chai testing library (`expect`).

_Note: expectation is done on sorted docs by `_id`_

```ts
it('should not modify pages with existing translations', async () => {
  const docs = [{ _id: new ObjectId(), value: 'invalid' }];
  await collection.insertMultiple(docs);

  await dataMigration.update();

  // Test what you expect
  const updatedDocs = await collection.find({}).toArray();
  expect(updatedDocs).toEqual([{ _id: new ObjectId(), value: 'valid' }]);

  // Test rollback will work
  await doRollbackAndAssertForInitialState(dataMigration, docs, { expect });
});
```
