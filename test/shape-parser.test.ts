import { readFileSync } from 'fs';
import type * as RDF from '@rdfjs/types';
import * as N3 from 'n3';
import { describe, expect, it } from 'vitest';
import { parseShapeFromQuads } from '../lib/Shape';
import type { IShape } from '../lib/Shape';
import type { ParserDiagnostic } from '../lib/parser-policy';

const n3Parser = new N3.Parser();
const shapeIri = 'http:exemple.ca/foo';

describe('parseShapeFromQuads', () => {
  it('parses SHACL explicitly', async () => {
    const quads = getShape('./test/shape/shacl_shape_one_property.ttl');
    const shape = await parseShapeFromQuads(quads, shapeIri, { format: 'shacl' });

    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).positivePredicates).toStrictEqual(['http://example.org/state']);
  });

  it('parses ShEx explicitly', async () => {
    const quads = getShape('./test/shape/shex_shape_one_property.ttl');
    const shape = await parseShapeFromQuads(quads, shapeIri, { format: 'shex' });

    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).positivePredicates).toStrictEqual(['http://example.org/state']);
  });

  it('auto-detects SHACL format', async () => {
    const quads = getShape('./test/shape/shacl_shape_one_property.ttl');
    const shape = await parseShapeFromQuads(quads, shapeIri, { format: 'auto' });

    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).positivePredicates).toStrictEqual(['http://example.org/state']);
  });

  it('auto-detects ShEx format', async () => {
    const quads = getShape('./test/shape/shex_shape_one_property.ttl');
    const shape = await parseShapeFromQuads(quads, shapeIri, { format: 'auto' });

    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).positivePredicates).toStrictEqual(['http://example.org/state']);
  });

  it('produces parser parity for equivalent SHACL and ShEx fixtures', async () => {
    const shaclQuads = getShape('./test/shape/shacl_shape_multiple_cardinality.ttl');
    const shexQuads = getShape('./test/shape/shex_shape_multiple_cardinality.ttl');

    const shaclShape = await parseShapeFromQuads(shaclQuads, shapeIri, { format: 'shacl' });
    const shexShape = await parseShapeFromQuads(shexQuads, shapeIri, { format: 'shex' });

    expect(shaclShape).not.toBeInstanceOf(Error);
    expect(shexShape).not.toBeInstanceOf(Error);

    const left = canonical((shaclShape as IShape));
    const right = canonical((shexShape as IShape));

    expect(left).toStrictEqual(right);
  });

  it('keeps malformed RDF list strict by default for ShEx', async () => {
    const quads = getShape('./test/shape/shex_invalid_shape_incomplete_rdf_list.ttl');
    const shape = await parseShapeFromQuads(quads, shapeIri, { format: 'shex' });
    expect(shape).toBeInstanceOf(Error);
  });

  it('collects diagnostics when RDF list policy is non-strict', async () => {
    const diagnostics: ParserDiagnostic[] = [];
    const quads = getShape('./test/shape/shex_invalid_shape_incomplete_rdf_list.ttl');

    await parseShapeFromQuads(quads, shapeIri, {
      format: 'shex',
      diagnostics,
      policy: { strictRdfLists: false },
    });

    expect(diagnostics.some(d => d.code === 'MALFORMED_RDF_LIST')).toBe(true);
  });
});

function canonical(shape: IShape): { positive: string[]; negative: string[]; cards: Record<string, unknown> } {
  const cards: Record<string, unknown> = {};
  for (const predicate of shape.positivePredicates) {
    cards[predicate] = shape.get(predicate)?.cardinality;
  }

  return {
    positive: [...shape.positivePredicates].sort(),
    negative: [...(shape.negativePredicates ?? [])].sort(),
    cards,
  };
}

function getShape(path: string): RDF.Quad[] {
  return n3Parser.parse(readFileSync(path).toString()) as RDF.Quad[];
}
