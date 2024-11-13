/**
 * Spots "positional operator" path in string for array filters
 * Example: xxx.$[element_name].yyy
 *
 * @see https://www.mongodb.com/docs/manual/reference/operator/update/positional-filtered/
 */
const ARRAY_FILTER_OPERATION_PATTERN = /\$\[(\w+)]/g;

/**
 * Checks the path contains at least one positional operator (ie ".$[element]")
 *
 * @param path Path with potentially a positional operator "my.$[element_for_array_filter].key"
 * @returns true if the input path needs an arrayFilter option when using a $unset on it.
 */
export function isArrayFilterPath(path: string) {
  return !!path.match(ARRAY_FILTER_OPERATION_PATTERN);
}
