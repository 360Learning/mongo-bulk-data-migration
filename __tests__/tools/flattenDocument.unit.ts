import * as mongodb from 'mongodb';
import { flattenDocument } from '../../src/tools/flattenDocument';

describe('tools - flattenDocument', () => {
  it('should return unchanged document having no nested objects', async () => {
    const doc = { root: 'value' };

    const flattenDoc = flattenDocument(doc);

    expect(flattenDoc).toEqual(doc);
  });

  it('should flatten nested object keys', async () => {
    const doc = {
      a: { b: 1 },
      c: { d: { e: 6 } },
      f: { 'g.h': 8 },
    };

    const flattenDoc = flattenDocument(doc);

    expect(flattenDoc).toEqual({
      'a.b': 1,
      'c.d.e': 6,
      'f.g.h': 8,
    });
  });

  it('should let empty object', async () => {
    const doc = {
      emptyObject: {},
      emptyArray: [],
      nested: {
        emptyObject: {},
        emptyArray: [],
      },
    };

    const flattenDoc = flattenDocument(doc);

    expect(flattenDoc).toEqual({
      emptyObject: {},
      emptyArray: [],
      'nested.emptyObject': {},
      'nested.emptyArray': [],
    });
  });

  it('should flatten array offsets', async () => {
    const doc = {
      a: [{ b: 1 }, { c: 2 }],
    };

    const flattenDoc = flattenDocument(doc);

    expect(flattenDoc).toEqual({
      'a.0.b': 1,
      'a.1.c': 2,
    });
  });

  it('should not try to flatten primitive types', async () => {
    const doc = {
      number: 123,
      null: null,
      true: true,
      false: true,
      undefined: undefined,
      string: 'string',
    };

    const flattenDoc = flattenDocument(doc);

    expect(flattenDoc).toEqual(doc);
  });

  it('should not flatten MongoDB possible stored Objects', async () => {
    // See https://docs.mongodb.com/manual/reference/bson-types/
    const doc = {
      _objectId: new mongodb.ObjectId(),
      min: new mongodb.MinKey(),
      max: new mongodb.MaxKey(),
      ts: mongodb.Timestamp.fromInt(100),
      date: new Date(),
      int: new mongodb.Int32(50),
      long: mongodb.Long.fromInt(100),
      dec128: mongodb.Decimal128.fromString('100'),
      regex: /aa/i,
    };

    const flattenDoc = flattenDocument(doc);

    expect(flattenDoc).toEqual(doc);
  });
});
