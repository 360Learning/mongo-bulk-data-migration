import _ from 'lodash';

type FlattenDocument = { [key: string]: any };

export function flattenDocument(obj: Record<string, any>): FlattenDocument {
  const outputDocument: FlattenDocument = {};

  return Object.entries(obj).reduce((output, [key, value]) => {
    const isPlainObject = _.isPlainObject(value) || Array.isArray(value);
    if (!isPlainObject || _.isEmpty(value)) {
      output[key] = value;
      return output;
    }

    return Object.entries(flattenDocument(value)).reduce(
      (deepOutput, [flattenKey, flattenValue]) => {
        deepOutput[`${key}.${flattenKey}`] = flattenValue;
        return deepOutput;
      },
      output,
    );
  }, outputDocument);
}
