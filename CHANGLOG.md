# Changelog

## 1.4.5 (2024-10-28)

- Patch 1.4.4 regression for auto rollback on nested properties

## 1.4.4 (2024-10-23)

- Fix bug: rollback in nested properties didn't work for array values (`$set:{"a.b":[...]}`)

## 1.4.3 (2024-09-10)

- Fix issues when the option `rollbackable` is `false`
  - Correctly compute bulk size, to decide when executing it
  - Do not warn because the number of rollback documents is 0

## 1.4.2 (2024-05-22)

- Add the option `rollbackable` that is faster for update-only scripts
  - Its default value is `true`
  - When set to `false`, calling `update` will not inserted any document in the rollback collection
  - When set to `false`, calling `rollback` will not do anything

## 1.4.1 (2024-05-03)

- Make `projection` not mandatory in typing when using `DELETE_OPERATION`

## 1.4.0 (2024-02-15)

- Don't use upsert() for rollback, instead call insert() for deleted documents to ease shard compliancy https://github.com/360Learning/mongo-bulk-data-migration/issues/5

## 1.3.0 (2024-02-13)

- Fix issue where unset arrays were not properly restored https://github.com/360Learning/mongo-bulk-data-migration/issues/3

## 1.2.0 (2024-02-05)

- Support collection deletion `operation:DELETE_COLLECTION` (and rollback)
- Spot and show warnings if a non idempotent and deterministic update is spotted _(likely 2 scripts share the same id)_

## 1.1.0 (2024-01-08)

- `doRollbackAndAssertForInitialState` test util won't reject unsorted documents for both Jest & Chai

## 1.0.2 (2024-01-06)

- Improve `doRollbackAndAssertForInitialState` for chai recognition

## 1.0.1 (2024-01-05)

- Update Readme

## 1.0.0 (2024-01-05)

Initial revision (360L internal script we use).
We are happy to share this program that make us earn time!

- Built over mongo bulk native client
- Find & Aggregate support
- Automatic rollback for basic $set
- Or alternative custom update query
- Option to throttle
- Async update support with Promise concurrency (pLimit lib)
- Show warning if aggregate count is too slow
- Mocha / Jest support
