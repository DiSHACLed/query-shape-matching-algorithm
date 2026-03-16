import * as RDF from '@rdfjs/types';
import { DataFactory } from 'rdf-data-factory';
import { Triple } from '../lib/Triple';

const DF = new DataFactory<RDF.BaseQuad>();

const AN_OBJECT = DF.namedNode('an object');

describe('Triple', () => {
  describe('toObject', () => {
    it('should return the object triple', () => {
      const objectTriple: any = {
        subject: 'a',
        predicate: 'b',
        object: 'c',
        cardinality: { min: 1, max: 1 },
        isOptional: false
      };
      const triple = new Triple(objectTriple);

      expect(triple.toObject()).toStrictEqual(objectTriple);
    });
  });

  describe('toString', () => {
    it('should return the string version of the triple', () => {
      const object = [DF.literal('foo', DF.namedNode('bar'))];
      const objectTriple: any = {
        subject: 'a',
        predicate: 'b',
        object
      };
      const triple = new Triple(objectTriple);

      const resp = `<a> <b> <${JSON.stringify(object)}>`;

      expect(triple.toString()).toStrictEqual(resp);
    });
  });

  describe('getLinkedStarPattern', () => {
    it('should return the linked object if it is a named node', () => {
      const triple = new Triple({
        subject: 'a',
        predicate: 'b',
        object: AN_OBJECT,
      });

      expect(triple.getLinkedStarPattern()).toStrictEqual(AN_OBJECT.value);
    });

    it('should return the variable', () => {
      const triple = new Triple({
        subject: 'a',
        predicate: 'b',
        object: DF.variable('foo'),
      });

      expect(triple.getLinkedStarPattern()).toBe('foo');
    });
  });
});
