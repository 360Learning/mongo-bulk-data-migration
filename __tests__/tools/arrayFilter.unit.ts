import {
  isArrayFilterPath,
  hasPathMatchingPositionalOperators,
  buildArrayFiltersOptionToUnset,
} from '../../src/tools/arrayFilters';

describe('utils/arrayFilters', () => {
  describe('#isArrayFilterPath', () => {
    it('returns false for a path not containing positional operator', () => {
      expect(isArrayFilterPath('my.key')).toBe(false);
      expect(isArrayFilterPath('some.weird.$.key')).toBe(false);
    });

    it('returns true for path containing at least one positional operator', () => {
      expect(isArrayFilterPath('my.$[name_me].key')).toBe(true);
      expect(isArrayFilterPath('my.$[name_me1].to.$[name_me2].key')).toBe(true);
    });
  });

  describe('#hasPathMatchingPositionalOperators', () => {
    it('returns false if it does not match any path', () => {
      const match = hasPathMatchingPositionalOperators(
        'keys.$[element].subKey.$[element2].value',
        ['keys.0.differentSubKey.0.value', 'keys.0.differentSubKey.1.value'],
      );

      expect(match).toBe(false);
    });

    it('returns true if the path with positional arguments matches any path in the list', () => {
      const match = hasPathMatchingPositionalOperators(
        'keys.$[element].subKey.$[element2].value',
        [
          'keys.0.subKey.0.value',
          'keys.0.subKey.1.value',
          'keys.1.subKey.0.value',
          'keys.1.subKey.1.value',
        ],
      );

      expect(match).toBe(true);
    });
  });

  describe('#buildArrayFiltersOptionToUnset', () => {
    it('returns the arrayFilter options for every positional arguments in the path', () => {
      const options = buildArrayFiltersOptionToUnset(
        'keys.$[element].subKey.$[element2].value',
      );

      expect(options).toEqual([
        { 'element.subKey': { $exists: true } },
        { 'element2.value': { $exists: true } },
      ]);
    });
  });
});
