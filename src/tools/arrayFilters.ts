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

/**
 * Determine whether the path corresponds to an array filter path, i.e. a path
 * containing some positional filtered part (something with the shape $[element])
 *
 * If so, will check this path could lead to one of the paths in 2nd argument
 *
 * Examples:
 *    > hasPathMatchingPositionalOperators(
 *         'keys.$[element].subKey.$[element2].value',
 *         ['keys.0.subKey.0.value']
 *     ) => should return true
 *
 *    > hasPathMatchingPositionalOperators(
 *         'keys.$[element].subKey.$[element2].value',
 *         ['keys.0.differentSubKey']
 *     ) => should return false
 *
 * @param path Path with potentially a positional operator "my.$[element_for_array_filter].key"
 * @param pathsToMatch Array or candidate paths (without positional operator)
 * @returns true if path is necessary
 */
export function hasPathMatchingPositionalOperators(
  path: string,
  pathsToMatch: string[],
) {
  if (!isArrayFilterPath(path)) {
    return false;
  }

  // Transforms "keys.$[element].subKey" in the regex /keys.\w+.subKey/g
  const pathRegex = new RegExp(
    path.replace(ARRAY_FILTER_OPERATION_PATTERN, '\\w+'),
    'g',
  );

  return pathsToMatch.some((pathToMatch) => pathRegex.test(pathToMatch));
}

/**
 * Get the complete arrayFilter options to use when you want to do a $unset
 * operation on the path specified in argument
 *
 * For example, on the path 'keys.$[element].subKey1.$[element2].value'
 * the arrayFilter for $unset operation will need to specify the following values
 * [
 *   { 'element.subKey1: { $exists: 1 } },
 *   { 'element2.value: { $exists: 1 } },
 * ]
 *
 * If we don't use this arrayFilter constraints, mongo will raise an error.
 *
 * @param path Path with positional operators "my.$[element_for_array_filter].key"
 * @returns arrayFilters for $unset
 */
export function buildArrayFiltersOptionToUnset(path: string) {
  let positionalElementNameMatch;
  const arrayFilters = [];
  do {
    positionalElementNameMatch = ARRAY_FILTER_OPERATION_PATTERN.exec(path);
    if (positionalElementNameMatch) {
      const subpathWithPositionalElementAndNextChild =
        _buildSubPathWithPositionalElementAndNextChild(
          positionalElementNameMatch[1],
          path,
        );
      arrayFilters.push({
        [subpathWithPositionalElementAndNextChild]: { $exists: true },
      });
    }
  } while (positionalElementNameMatch);

  return arrayFilters;
}

/**
 * Get the key we need to put in an arrayFilter option to specify a filter when using a positional argument.
 *
 * For example, when update is made on 'keys.$[element].subKey1.$[element2].value'
 * the arrayFilter for $unset operation will need to specify the following values
 * [
 *   { 'element.subKey1: { $exists: 1 } },
 *   { 'element2.value: { $exists: 1 } },
 * ]
 *
 * This function gets the complete path (ie 'keys.$[element].subKey1.$[element2].value')
 * and the name of a positional argument (ie 'element' or 'element2' in this example),
 * and returns the key to put in the options (ie 'element.subKey1' or 'element2.value')
 *
 * @param positionalElementName
 * @param completePath
 */
function _buildSubPathWithPositionalElementAndNextChild(
  positionalElementName: string,
  completePath: string,
) {
  const matchRegexp = new RegExp(
    `\\$\\[${positionalElementName}]\\.(\\w+)(?:\\.|$)`,
  );

  const nextChildName = matchRegexp.exec(completePath)[1];

  return `${positionalElementName}.${nextChildName}`;
}
