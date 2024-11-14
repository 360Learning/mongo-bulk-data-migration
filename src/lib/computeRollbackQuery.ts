import _ from 'lodash';
import { flattenDocument } from '../tools/flattenDocument';
import * as arrayFiltersUtils from '../tools/arrayFilters';
import type { Document } from 'mongodb';

/**
 * @param updateQuery Mongo update query executed at migration
 * @param backup Document backed up before the migration
 */
export function computeRollbackQuery(updateQuery: any, backup: any) {
  const setPropertiesDuringUpdate = Object.keys(updateQuery.$set || {});
  const $set = computeRollbackSet(setPropertiesDuringUpdate, backup);
  const $unsetWithoutPositionals = computeRollbackUnset(
    setPropertiesDuringUpdate,
    backup,
    $set,
  );

  const { arrayFilters, unsetAdditionalPositional } =
    _computeArrayFilterAndUnsetWithPositionals(updateQuery, backup);
  const $unset = {
    ...$unsetWithoutPositionals,
    ...unsetAdditionalPositional,
  };

  return {
    ...(!_.isEmpty($set) ? { $set } : {}),
    ...(!_.isEmpty($unset) ? { $unset } : {}),
    ...(!_.isEmpty(arrayFilters) ? { arrayFilters } : {}),
  };
}

/**
 * If path contains a "positional argument", we'll have to add the correct
 * arrayFilters options for the $unset operation to work correctly
 */
function _computeArrayFilterAndUnsetWithPositionals(
  updateQuery: any,
  backup: any,
): { arrayFilters: Document[]; unsetAdditionalPositional: any } {
  const unsetAdditionalPositional = {};
  const filteredObject = Object.keys(flattenDocument(backup));
  const arrayFilters: Document[] = [];
  const update = Object.keys(flattenDocument(updateQuery.$set ?? {}));
  update
    .filter(
      (path) =>
        !filteredObject.includes(path) &&
        !arrayFiltersUtils.hasPathMatchingPositionalOperators(
          path,
          filteredObject,
        ),
    )
    .forEach((path) => {
      if (arrayFiltersUtils.isArrayFilterPath(path)) {
        unsetAdditionalPositional[path] = 1;
        arrayFilters.push(
          ...arrayFiltersUtils.buildArrayFiltersOptionToUnset(path),
        );
      }
    });

  return {
    arrayFilters,
    unsetAdditionalPositional,
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
      if (parentKeyToFullyRestore && parentKeyToFullyRestore in backup) {
        rollbackSet[parentKeyToFullyRestore] = backup[parentKeyToFullyRestore];
        return rollbackSet;
      }

      const indexMatch = /(.*)\.(\d+)$/.exec(key);
      if (indexMatch) {
        const [_str, nestedPathToArray, index] = indexMatch;
        if (Array.isArray(_.get(backup, nestedPathToArray))) {
          const containsDeeperSubKey = setPropertiesDuringUpdate.some(
            (propertySet) =>
              propertySet !== key &&
              propertySet.match(new RegExp(`^${nestedPathToArray}\\.\\d+\\.`)),
          );
          if (!containsDeeperSubKey) {
            if (typeof rollbackSet[nestedPathToArray] === 'undefined') {
              rollbackSet[nestedPathToArray] = [];
            }
            rollbackSet[nestedPathToArray][Number(index)] = value;
          } else {
            rollbackSet[`${nestedPathToArray}.${index}`] = value;
          }
          return rollbackSet;
        }
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
    (path) =>
      !keysToSet.includes(path) &&
      !arrayFiltersUtils.isArrayFilterPath(path) &&
      !keysToSet.some((key) => path.startsWith(`${key}.`)),
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
