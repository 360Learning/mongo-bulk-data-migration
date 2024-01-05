# Changelog

## 1.0.1 (2024-01-05)

- Improve `doRollbackAndAssertForInitialState` for chai recognition


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
