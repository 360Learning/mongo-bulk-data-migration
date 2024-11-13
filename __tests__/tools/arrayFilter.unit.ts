import {
  isArrayFilterPath,
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
});
