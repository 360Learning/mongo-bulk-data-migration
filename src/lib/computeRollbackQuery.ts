import _ from 'lodash';
import { flattenDocument } from '../tools/flattenDocument';

/**
 * @param updateQuery Mongo update query executed at migration
 * @param backup Document backed up before the migration
 */
export function computeRollbackQuery(updateQuery: any, backup: any) {
  const setPropertiesDuringUpdate = Object.keys(updateQuery.$set || {});
  const $set = computeRollbackSet(setPropertiesDuringUpdate, backup);
  const $unset = computeRollbackUnset(setPropertiesDuringUpdate, backup, $set);

  return {
    ...(!_.isEmpty($set) ? { $set } : {}),
    ...(!_.isEmpty($unset) ? { $unset } : {}),
  };
}

function computeRollbackSet(
  setPropertiesDuringUpdate: string[],
  backup: any,
): any {
  const flattenBackupDocument = flattenDocument(backup);

  return Object.entries(flattenBackupDocument).reduce(
    (rollbackSet, [key, value]) => {
      const parentKeyToFullyRestore = setPropertiesDuringUpdate.find(
        (userSet) => key.startsWith(`${userSet}.`),
      );
      if (parentKeyToFullyRestore) {
        rollbackSet[parentKeyToFullyRestore] = backup[parentKeyToFullyRestore];
        return rollbackSet;
      }

      const indexMatch = /(.*)\.(\d+)$/.exec(key);
      if (indexMatch) {
        const [_str, nestedPathToArray, index] = indexMatch;
        if (Array.isArray(_.get(backup, nestedPathToArray))) {
          if (typeof rollbackSet[nestedPathToArray] === 'undefined') {
            rollbackSet[nestedPathToArray] = [];
          }
          rollbackSet[nestedPathToArray][Number(index)] = value;
          return rollbackSet;
        }

        rollbackSet[nestedPathToArray] = value;
        return rollbackSet;
      }

      rollbackSet[key] = value;
      return rollbackSet;
    },
    {} as any,
  );
}

function computeRollbackUnset(
  setPropertiesDuringUpdate: string[],
  backup: any,
  $set: any,
) {
  const keysToSet = Object.keys($set);
  const keysToUnset = setPropertiesDuringUpdate.filter(
    (path) => !keysToSet.includes(path),
  );
  const parentKeysToUnset = computeParentKeysToUnset(keysToUnset, backup);
  const nonConflictingKeysToUnset = filterConflictingKeys([
    ...keysToUnset,
    ...parentKeysToUnset,
  ]);
  const entriesToUnset = nonConflictingKeysToUnset.map((key) => [key, 1]);

  return Object.fromEntries(entriesToUnset);
}

function computeParentKeysToUnset(
  nestedKeysToUnset: string[],
  backup: any,
): string[] {
  return nestedKeysToUnset.reduce(
    (parentKeysToUnset: string[], key: string) => {
      const splitParentKeys = key.split('.').slice(0, -1);
      const parentKeyNestedPaths = splitParentKeys.map((_key, offset) =>
        splitParentKeys.slice(0, offset + 1).join('.'),
      );
      const keysToUnset = parentKeyNestedPaths.filter(
        (parentKey) => !_.has(backup, parentKey),
      );
      return parentKeysToUnset.concat(keysToUnset);
    },
    [],
  );
}

function filterConflictingKeys(keys: string[]) {
  return keys.filter((key) => {
    const nestedParentKey = key.split('.').slice(0, -1).join('.');
    return !keys.includes(nestedParentKey);
  });
}
