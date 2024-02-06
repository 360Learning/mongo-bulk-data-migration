import { computeRollbackQuery } from '../../src/lib/computeRollbackQuery';

describe('computeRollbackQuery', () => {
  it('should return an empty object if there is no operation to rollback', async () => {
    const updateQuery = {};
    const backup = {};

    const restoreQuery = computeRollbackQuery(updateQuery, backup);

    expect(restoreQuery).toEqual({});
  });

  describe('$set', () => {
    describe('resulting from a $set', () => {
      it('should set back the original value', async () => {
        const updateQuery = { $set: { key: 'value2' } };
        const backup = { key: 'value1' };

        const restoreQuery = computeRollbackQuery(updateQuery, backup);

        expect(restoreQuery).toEqual({
          $set: { key: 'value1' },
        });
      });

      it('should set back the nested original value', async () => {
        const updateQuery = { $set: { 'nested.key': 'value2' } };
        const backup = { nested: { key: 'value1' } };

        const restoreQuery = computeRollbackQuery(updateQuery, backup);

        expect(restoreQuery).toEqual({
          $set: { 'nested.key': 'value1' },
        });
      });
    });

    describe('resulting from an $unset', () => {
      it('should not $set a non existing value', async () => {
        const updateQuery = { $unset: { key: 1 } };
        const backup = {};

        const restoreQuery = computeRollbackQuery(updateQuery, backup);

        expect(restoreQuery).toEqual({});
      });

      it('should $set an original value', async () => {
        const updateQuery = { $unset: { key: 1 } };
        const backup = { key: 'value' };

        const restoreQuery = computeRollbackQuery(updateQuery, backup);

        expect(restoreQuery).toEqual({
          $set: { key: 'value' },
        });
      });

      it('should $set an original array value', async () => {
        const updateQuery = { $unset: { key: 1 } };
        const backup = { keys: ['value1', 'value2'] };

        const restoreQuery = computeRollbackQuery(updateQuery, backup);

        expect(restoreQuery).toEqual({
          $set: { keys: ['value1', 'value2'] },
        });
      });

      it('should $set an original deep array value', async () => {
        const updateQuery = { $unset: { 'deep.key': 1 } };
        const backup = {
          deep: {
            keys: ['value1', 'value2'],
          },
        };

        const restoreQuery = computeRollbackQuery(updateQuery, backup);

        expect(restoreQuery).toEqual({
          $set: { 'deep.keys': ['value1', 'value2'] },
        });
      });

      it('should $set a nested value', async () => {
        const updateQuery = { $unset: { 'nested.key': 1 } };
        const backup = { nested: { key: 'value' } };

        const restoreQuery = computeRollbackQuery(updateQuery, backup);

        expect(restoreQuery).toEqual({
          $set: { 'nested.key': 'value' },
        });
      });

      it('should $set a nested value to original empty value', async () => {
        const updateQuery = { $unset: { 'nested.key': 1 } };
        const backup = { nested: {} };

        const restoreQuery = computeRollbackQuery(updateQuery, backup);

        expect(restoreQuery).toEqual({
          // FIXME could be optimized here (by removing $set entirely)
          $set: { nested: {} },
        });
      });
    });
  });

  describe('$unset after having $set', () => {
    it('should $unset an added value', async () => {
      const updateQuery = { $set: { key: 'value' } };
      const backup = {};

      const restoreQuery = computeRollbackQuery(updateQuery, backup);

      expect(restoreQuery).toEqual({
        $unset: { key: 1 },
      });
    });

    it('should $unset an added nested value', async () => {
      const updateQuery = { $set: { 'nested.new.key': 'value' } };
      const backup = {};

      const restoreQuery = computeRollbackQuery(updateQuery, backup);

      expect(restoreQuery).toEqual({
        $unset: { nested: 1 },
      });
    });

    it('should $unset up to the root initial key', async () => {
      const updateQuery = { $set: { 'nested.new.key': 'value' } };
      const backup = {
        nested: {}, // empty
      };

      const restoreQuery = computeRollbackQuery(updateQuery, backup);

      expect(restoreQuery).toEqual({
        // FIXME could be optimized here (by removing $set entirely)
        $set: { nested: {} },
        $unset: { 'nested.new': 1 },
      });
    });
  });
});
