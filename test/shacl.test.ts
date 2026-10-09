import { readFileSync } from 'fs';
import type * as RDF from '@rdfjs/types';
import * as N3 from 'n3';
import { DataFactory } from 'rdf-data-factory';
import { describe, expect, it } from 'vitest';
import { streamifyArray } from 'streamify-array';
import { RDF as RDF_VOCAB } from '../lib/constant';
import { ConstraintType, type IConstraint, type OneOf, type IShape } from '../lib/Shape';
import { shaclShapeFromQuads } from '../lib/shacl';
import type { ParserDiagnostic } from '../lib/parser-policy';

const DF = new DataFactory<RDF.Quad>();
const n3Parser = new N3.Parser();

const shapeIri = 'http:exemple.ca/foo';
const LBDCVOC_PREFIX = 'http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/';
const XSD_PREFIX = 'http://www.w3.org/2001/XMLSchema#';
const FOAF_PREFIX = 'http://xmlns.com/foaf/0.1/';

describe.each([
  [{ name: 'shaclShapeFromQuads (array)', populateFunction: populateArray }],
  [{ name: 'shaclShapeFromQuads (stream)', populateFunction: populateStream }],
])('SHACL $name', ({ populateFunction, name }) => {
  // ── Fixtures ────────────────────────────────────────────────────────────

  const emptyQuads: any = populateFunction([]);
  const unrelatedQuads: any = populateFunction([
    DF.quad(DF.namedNode('foo'), DF.namedNode('http://example.org/bar'), DF.blankNode()),
  ] as RDF.Quad[]);

  const shapeWithOneProperty = populateFunction('./test/shape/shacl_shape_one_property.ttl');
  const closedShapeMultipleProperties = populateFunction('./test/shape/shacl_shape_closed_multiple_properties.ttl');
  const twoShapes = populateFunction('./test/shape/shacl_two_shapes.ttl');
  const shapeMultipleCardinality = populateFunction('./test/shape/shacl_shape_multiple_cardinality.ttl');
  const shapeDefaultCardinality = populateFunction('./test/shape/shacl_shape_default_cardinality.ttl');
  const shapeWithConstraints = populateFunction('./test/shape/shacl_shape_with_constraints.ttl');
  const shapeWithOrStatement = populateFunction('./test/shape/shacl_shape_or_statement.ttl');
  const shapeWithXoneStatement = populateFunction('./test/shape/shacl_shape_xone_statement.ttl');
  const shapeWithNot = populateFunction('./test/shape/shacl_shape_with_not.ttl');
  const shapeInconsistentPredicates = populateFunction('./test/shape/shacl_shape_inconsistent_predicates.ttl');
  const shaclSolidbenchComment = populateFunction('./test/shape/shacl_solidbench_comment.ttl');

  // ── Error cases ─────────────────────────────────────────────────────────

  it(`${name}: should return an error for empty quads`, async () => {
    expect(await shaclShapeFromQuads(emptyQuads, shapeIri)).toBeInstanceOf(Error);
  });

  it(`${name}: should return an error for unrelated quads`, async () => {
    expect(await shaclShapeFromQuads(unrelatedQuads, shapeIri)).toBeInstanceOf(Error);
  });

  it(`${name}: should parse a shape correctly when sh:property is seen before sh:path (quad ordering)`, async () => {
    // Deliberately put sh:property BEFORE sh:path so the blank node has no entry
    // in propertyData yet when sh:property is processed (exercises line 139 in shacl.ts)
    const propBn = DF.blankNode('p1');
    const quads: RDF.Quad[] = [
      // sh:property comes first — blank node 'p1' has no propertyData entry yet
      DF.quad(DF.namedNode(shapeIri), DF.namedNode('http://www.w3.org/ns/shacl#property'), propBn),
      // sh:path comes after — now propertyData entry exists for 'p1'
      DF.quad(propBn, DF.namedNode('http://www.w3.org/ns/shacl#path'), DF.namedNode('http://example.org/state')),
    ];
    const source = populateFunction(quads as any);
    const shape = await shaclShapeFromQuads(source, shapeIri);
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).positivePredicates).toStrictEqual(['http://example.org/state']);
  });

  it(`${name}: should handle an sh:or whose members carry sh:path directly (no sh:property indirection)`, async () => {
    // A list member that directly has sh:path (exercises line 393 in shacl.ts)
    const listNode1 = DF.blankNode('l1');
    const listNode2 = DF.blankNode('l2');
    const memberBn1 = DF.blankNode('m1');
    const memberBn2 = DF.blankNode('m2');
    const RDF_NIL_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';
    const SH = 'http://www.w3.org/ns/shacl#';
    const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

    const quads: RDF.BaseQuad[] = [
      // Main shape with a base property
      DF.quad(DF.namedNode(shapeIri), DF.namedNode(`${SH}property`), DF.blankNode('base')),
      DF.quad(DF.blankNode('base'), DF.namedNode(`${SH}path`), DF.namedNode('http://example.org/base')),
      DF.quad(DF.namedNode(shapeIri), DF.namedNode(`${SH}or`), listNode1),
      // List node 1 -> member1 (direct sh:path)
      DF.quad(listNode1, DF.namedNode(`${RDF}first`), memberBn1),
      DF.quad(listNode1, DF.namedNode(`${RDF}rest`), listNode2),
      // member1: directly has sh:path (no sh:property intermediate)
      DF.quad(memberBn1, DF.namedNode(`${SH}path`), DF.namedNode('http://example.org/alt1')),
      // List node 2 -> member2 (also direct sh:path)
      DF.quad(listNode2, DF.namedNode(`${RDF}first`), memberBn2),
      DF.quad(listNode2, DF.namedNode(`${RDF}rest`), DF.namedNode(RDF_NIL_IRI)),
      DF.quad(memberBn2, DF.namedNode(`${SH}path`), DF.namedNode('http://example.org/alt2')),
    ];
    const source = populateFunction(quads as any);
    const shape = await shaclShapeFromQuads(source, shapeIri);
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).positivePredicates).toStrictEqual(['http://example.org/base']);
    expect((shape as IShape).oneOf).toHaveLength(1);
    expect((shape as IShape).oneOf[0]).toHaveLength(2);
    expect(new Set((shape as IShape).oneOf[0].flat().map(p => p.name))).toStrictEqual(
      new Set(['http://example.org/alt1', 'http://example.org/alt2']),
    );
  });

  // ── Basic shapes ─────────────────────────────────────────────────────────

  it(`${name}: should parse a shape with one property`, async () => {
    const shape = await shaclShapeFromQuads(shapeWithOneProperty, shapeIri);
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).name).toBe(shapeIri);
    expect((shape as IShape).closed).toBe(false);
    expect((shape as IShape).positivePredicates).toStrictEqual(['http://example.org/state']);
    expect((shape as IShape).negativePredicates).toStrictEqual([]);
    expect((shape as IShape).oneOf).toStrictEqual([]);
  });

  it(`${name}: should parse a closed shape with multiple properties`, async () => {
    const shape = await shaclShapeFromQuads(closedShapeMultipleProperties, shapeIri);
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).name).toBe(shapeIri);
    expect((shape as IShape).closed).toBe(true);
    const expectedPredicates: string[] = [
      'http://ex.example/#state',
      'http://foaf.example/#name',
      'http://foaf.example/#mbox',
      'http://foaf.example/#hunter',
      'http://foaf.example/#me',
    ];
    // Use a set comparison since blank-node ordering is not guaranteed by SHACL
    expect(new Set((shape as IShape).positivePredicates)).toStrictEqual(new Set(expectedPredicates));
    expect((shape as IShape).negativePredicates).toStrictEqual([]);
  });

  it(`${name}: should parse only the target shape when multiple shapes are present`, async () => {
    const shape = await shaclShapeFromQuads(twoShapes, shapeIri);
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).name).toBe(shapeIri);
    expect(new Set((shape as IShape).positivePredicates)).toStrictEqual(new Set([
      'http://xmlns.com/foaf/0.1/name',
      'http://xmlns.com/foaf/0.1/mbox',
    ]));
    expect((shape as IShape).negativePredicates).toStrictEqual([]);
  });

  // ── Cardinalities ─────────────────────────────────────────────────────────

  it(`${name}: should handle cardinalities including a negated predicate (0,0)`, async () => {
    const shape = await shaclShapeFromQuads(shapeMultipleCardinality, shapeIri);
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(false);

    const expectedPositive = new Set([
      `${FOAF_PREFIX}prop1`,
      `${FOAF_PREFIX}prop3`,
      `${FOAF_PREFIX}prop4`,
      `${FOAF_PREFIX}prop5`,
      `${FOAF_PREFIX}prop6`,
      `${FOAF_PREFIX}prop7`,
    ]);
    const expectedNegative = [`${FOAF_PREFIX}prop2`];
    expect(new Set((shape as IShape).positivePredicates)).toStrictEqual(expectedPositive);
    expect((shape as IShape).negativePredicates).toStrictEqual(expectedNegative);

    const mapCardinality = new Map([
      [`${FOAF_PREFIX}prop1`, { min: 1, max: 1 }],
      [`${FOAF_PREFIX}prop3`, { min: 5, max: 5 }],
      [`${FOAF_PREFIX}prop4`, { min: 1, max: 4 }],
      [`${FOAF_PREFIX}prop5`, { min: 1, max: -1 }],
      [`${FOAF_PREFIX}prop6`, { min: 0, max: 1 }],
      [`${FOAF_PREFIX}prop7`, { min: 0, max: -1 }],
    ]);
    for (const [pred, expectedCard] of mapCardinality) {
      expect((shape as IShape).get(pred)?.cardinality).toStrictEqual(expectedCard);
    }
  });

  it(`${name}: should apply the SHACL defaults for an absent sh:minCount or sh:maxCount`, async () => {
    const shape = await shaclShapeFromQuads(shapeDefaultCardinality, shapeIri);
    expect(shape).not.toBeInstanceOf(Error);

    expect(new Set((shape as IShape).positivePredicates)).toStrictEqual(new Set([
      `${FOAF_PREFIX}prop1`,
      `${FOAF_PREFIX}prop2`,
      `${FOAF_PREFIX}prop3`,
    ]));
    // sh:maxCount 0 forbids the property, since the absent sh:minCount is 0
    expect((shape as IShape).negativePredicates).toStrictEqual([`${FOAF_PREFIX}prop4`]);

    // An absent sh:minCount is 0, so the property is optional; an absent sh:maxCount is unbounded (-1)
    const expected = new Map([
      [`${FOAF_PREFIX}prop1`, { cardinality: { min: 0, max: -1 }, optional: true }],
      [`${FOAF_PREFIX}prop2`, { cardinality: { min: 1, max: -1 }, optional: false }],
      [`${FOAF_PREFIX}prop3`, { cardinality: { min: 0, max: 2 }, optional: true }],
    ]);
    for (const [pred, { cardinality, optional }] of expected) {
      expect((shape as IShape).get(pred)?.cardinality).toStrictEqual(cardinality);
      expect((shape as IShape).get(pred)?.optional).toBe(optional);
    }
  });

  // ── Constraints ─────────────────────────────────────────────────────────

  it(`${name}: should handle sh:node (SHAPE) and sh:datatype (DATATYPE) constraints`, async () => {
    const shape = await shaclShapeFromQuads(shapeWithConstraints, shapeIri);
    expect(shape).not.toBeInstanceOf(Error);

    const expectedPositive = new Set([
      `${FOAF_PREFIX}prop1`,
      `${FOAF_PREFIX}prop2`,
      `${FOAF_PREFIX}prop3`,
      `${FOAF_PREFIX}prop4`,
      `${FOAF_PREFIX}prop5`,
      `${FOAF_PREFIX}prop6`,
      `${FOAF_PREFIX}prop7`,
      `${FOAF_PREFIX}prop8`,
      `${FOAF_PREFIX}prop10`,
    ]);
    expect(new Set((shape as IShape).positivePredicates)).toStrictEqual(expectedPositive);
    expect((shape as IShape).negativePredicates).toStrictEqual([`${FOAF_PREFIX}prop9`]);

    // sh:node constraint → ConstraintType.SHAPE
    const prop1 = (shape as IShape).get(`${FOAF_PREFIX}prop1`);
    expect(prop1?.constraint).toStrictEqual<IConstraint>({
      type: ConstraintType.SHAPE,
      value: new Set(['http:exemple.ca/bar']),
    });
    expect(prop1?.cardinality).toStrictEqual({ min: 0, max: 1 });

    // sh:datatype constraint → ConstraintType.DATATYPE
    const prop10 = (shape as IShape).get(`${FOAF_PREFIX}prop10`);
    expect(prop10?.constraint).toStrictEqual<IConstraint>({
      type: ConstraintType.DATATYPE,
      value: new Set(['http://example.org/unassigned']),
    });

    expect((shape as IShape).getLinkedShapeIri()).toStrictEqual(new Set(['http:exemple.ca/bar']));
  });

  it(`${name}: should parse sh:minInclusive/sh:maxInclusive and sh:minExclusive/sh:maxExclusive facets`, async () => {
    const SH = 'http://www.w3.org/ns/shacl#';
    const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
    const XSD = 'http://www.w3.org/2001/XMLSchema#';

    const inclusiveProp = DF.blankNode('inclusiveProp');
    const exclusiveProp = DF.blankNode('exclusiveProp');

    const quads = [
      DF.quad(DF.namedNode(shapeIri), DF.namedNode(`${RDF}type`), DF.namedNode(`${SH}NodeShape`)),
      DF.quad(DF.namedNode(shapeIri), DF.namedNode(`${SH}property`), inclusiveProp),
      DF.quad(inclusiveProp, DF.namedNode(`${SH}path`), DF.namedNode('http://example.org/hasAgeInclusive')),
      DF.quad(inclusiveProp, DF.namedNode(`${SH}datatype`), DF.namedNode(`${XSD}integer`)),
      DF.quad(inclusiveProp, DF.namedNode(`${SH}minInclusive`), DF.literal('15', DF.namedNode(`${XSD}integer`))),
      DF.quad(inclusiveProp, DF.namedNode(`${SH}maxInclusive`), DF.literal('35', DF.namedNode(`${XSD}integer`))),
      DF.quad(DF.namedNode(shapeIri), DF.namedNode(`${SH}property`), exclusiveProp),
      DF.quad(exclusiveProp, DF.namedNode(`${SH}path`), DF.namedNode('http://example.org/hasAgeExclusive')),
      DF.quad(exclusiveProp, DF.namedNode(`${SH}datatype`), DF.namedNode(`${XSD}integer`)),
      DF.quad(exclusiveProp, DF.namedNode(`${SH}minExclusive`), DF.literal('18', DF.namedNode(`${XSD}integer`))),
      DF.quad(exclusiveProp, DF.namedNode(`${SH}maxExclusive`), DF.literal('40', DF.namedNode(`${XSD}integer`))),
    ] as RDF.Quad[];

    const shape = await shaclShapeFromQuads(populateFunction(quads), shapeIri);
    expect(shape).not.toBeInstanceOf(Error);

    const inclusiveConstraint = (shape as IShape).get('http://example.org/hasAgeInclusive')?.constraint;
    expect(inclusiveConstraint).toStrictEqual<IConstraint>({
      type: ConstraintType.DATATYPE,
      value: new Set([`${XSD}integer`]),
      minInclusive: 15,
      maxInclusive: 35,
    });

    const exclusiveConstraint = (shape as IShape).get('http://example.org/hasAgeExclusive')?.constraint;
    expect(exclusiveConstraint).toStrictEqual<IConstraint>({
      type: ConstraintType.DATATYPE,
      value: new Set([`${XSD}integer`]),
      minExclusive: 18,
      maxExclusive: 40,
    });
  });

  it(`${name}: should parse sh:pattern and sh:flags facets`, async () => {
    const SH = 'http://www.w3.org/ns/shacl#';
    const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
    const XSD = 'http://www.w3.org/2001/XMLSchema#';

    const patternProp = DF.blankNode('patternProp');

    const quads = [
      DF.quad(DF.namedNode(shapeIri), DF.namedNode(`${RDF}type`), DF.namedNode(`${SH}NodeShape`)),
      DF.quad(DF.namedNode(shapeIri), DF.namedNode(`${SH}property`), patternProp),
      DF.quad(patternProp, DF.namedNode(`${SH}path`), DF.namedNode('http://example.org/nickname')),
      DF.quad(patternProp, DF.namedNode(`${SH}datatype`), DF.namedNode(`${XSD}string`)),
      DF.quad(patternProp, DF.namedNode(`${SH}pattern`), DF.literal('^foo')),
      DF.quad(patternProp, DF.namedNode(`${SH}flags`), DF.literal('i')),
    ] as RDF.Quad[];

    const shape = await shaclShapeFromQuads(populateFunction(quads), shapeIri);
    expect(shape).not.toBeInstanceOf(Error);

    const patternConstraint = (shape as IShape).get('http://example.org/nickname')?.constraint;
    expect(patternConstraint).toStrictEqual<IConstraint>({
      type: ConstraintType.DATATYPE,
      value: new Set([`${XSD}string`]),
      pattern: '^foo',
      flags: 'i',
    });
  });

  // ── sh:or ────────────────────────────────────────────────────────────────

  it(`${name}: should handle sh:or with two alternative property groups`, async () => {
    const shape = await shaclShapeFromQuads(shapeWithOrStatement, shapeIri);
    expect(shape).not.toBeInstanceOf(Error);

    expect((shape as IShape).positivePredicates).toStrictEqual([
      'http://www.w3.org/2000/01/rdf-schema#mbox',
    ]);
    expect((shape as IShape).negativePredicates).toStrictEqual([]);

    const expectedOneOf: OneOf[] = [
      [
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#givenName',
            cardinality: { min: 1, max: -1 },
            constraint: undefined,
          },
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#familyName',
            cardinality: { min: 1, max: 1 },
            constraint: undefined,
          },
        ],
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#name',
            cardinality: { min: 1, max: 1 },
            constraint: undefined,
          },
        ],
      ],
    ];
    expect((shape as IShape).oneOf).toStrictEqual(expectedOneOf);
  });

  // ── sh:xone ──────────────────────────────────────────────────────────────

  it(`${name}: should handle sh:xone (exclusive-or) the same way as sh:or`, async () => {
    const shape = await shaclShapeFromQuads(shapeWithXoneStatement, shapeIri);
    expect(shape).not.toBeInstanceOf(Error);

    expect((shape as IShape).positivePredicates).toStrictEqual([
      'http://www.w3.org/2000/01/rdf-schema#mbox',
    ]);
    expect((shape as IShape).negativePredicates).toStrictEqual([]);

    const oneOf = (shape as IShape).oneOf;
    expect(oneOf).toHaveLength(1);
    expect(oneOf[0]).toHaveLength(2);
    // Each branch has one predicate
    expect(new Set(oneOf[0].flat().map(p => p.name))).toStrictEqual(new Set([
      'http://www.w3.org/2000/01/rdf-schema#givenName',
      'http://www.w3.org/2000/01/rdf-schema#name',
    ]));
  });

  it(`${name}: should keep one disjunction for each sh:or and sh:xone value`, async () => {
    const shape = await shaclShapeFromQuads(populateFunction(n3Parser.parse(`
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <${shapeIri}> a sh:NodeShape ;
        sh:property [ sh:path foaf:name ] ;
        sh:or ( [ sh:path foaf:mbox ] [ sh:path foaf:phone ] ) ;
        sh:or ( [ sh:path foaf:homepage ] [ sh:path foaf:weblog ] ) ;
        sh:xone ( [ sh:path foaf:age ] [ sh:path foaf:birthday ] ) .`)), shapeIri);
    expect(shape).not.toBeInstanceOf(Error);
    const disjunctions = (shape as IShape).oneOf.map(oneOf => oneOf.map(branch => branch.map(p => p.name)));
    expect(new Set(disjunctions.map(oneOf => JSON.stringify(oneOf)))).toStrictEqual(new Set([
      [[`${FOAF_PREFIX}mbox`], [`${FOAF_PREFIX}phone`]],
      [[`${FOAF_PREFIX}homepage`], [`${FOAF_PREFIX}weblog`]],
      [[`${FOAF_PREFIX}age`], [`${FOAF_PREFIX}birthday`]],
    ].map(oneOf => JSON.stringify(oneOf))));
  });

  // ── sh:not ───────────────────────────────────────────────────────────────

  it(`${name}: should handle sh:not as a negative predicate`, async () => {
    const shape = await shaclShapeFromQuads(shapeWithNot, shapeIri);
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).positivePredicates).toStrictEqual([`${FOAF_PREFIX}prop1`]);
    expect((shape as IShape).negativePredicates).toStrictEqual([`${FOAF_PREFIX}prop2`]);
  });

  function shapeWithNegation(negation: string): any {
    return populateFunction(n3Parser.parse(`
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${shapeIri}> a sh:NodeShape ;
        sh:property [ sh:path foaf:prop1 ] ;
        sh:not ${negation} .`));
  }

  it(`${name}: should keep a negative predicate for each sh:not value`, async () => {
    const shape = await shaclShapeFromQuads(
      shapeWithNegation('[ sh:path foaf:prop2 ; sh:minCount 1 ], [ sh:path foaf:prop3 ; sh:minCount 1 ]'),
      shapeIri,
    );
    expect(new Set((shape as IShape).negativePredicates)).toStrictEqual(new Set([`${FOAF_PREFIX}prop2`, `${FOAF_PREFIX}prop3`]));
  });

  it(`${name}: should keep sh:not as a negative predicate when it also carries non-validating properties`, async () => {
    const shape = await shaclShapeFromQuads(
      shapeWithNegation('[ a sh:PropertyShape ; sh:path foaf:prop2 ; sh:minCount 1 ; sh:name "no prop2" ; sh:message "forbidden" ]'),
      shapeIri,
    );
    expect((shape as IShape).negativePredicates).toStrictEqual([`${FOAF_PREFIX}prop2`]);
  });

  it.each([
    ['without sh:minCount', '[ sh:path foaf:prop2 ]'],
    ['with sh:minCount 2', '[ sh:path foaf:prop2 ; sh:minCount 2 ]'],
    ['with another constraint', '[ sh:path foaf:prop2 ; sh:minCount 1 ; sh:datatype xsd:string ]'],
    ['with sh:maxCount', '[ sh:path foaf:prop2 ; sh:minCount 1 ; sh:maxCount 3 ]'],
    ['over a complex path', '[ sh:path [ sh:inversePath foaf:prop2 ] ; sh:minCount 1 ]'],
    ['over a node shape', '[ sh:property [ sh:path foaf:prop2 ; sh:minCount 1 ] ]'],
  ])(`${name}: should ignore a sh:not that does not forbid its property (%s) and report it`, async (_, negation) => {
    const diagnostics: ParserDiagnostic[] = [];
    const shape = await shaclShapeFromQuads(shapeWithNegation(negation), shapeIri, { diagnostics });
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).positivePredicates).toStrictEqual([`${FOAF_PREFIX}prop1`]);
    expect((shape as IShape).negativePredicates).toStrictEqual([]);
    expect(diagnostics.map(d => d.code)).toStrictEqual(['UNSUPPORTED_NOT']);
  });

  // ── Error: inconsistent predicates ────────────────────────────────────────

  it(`${name}: should return an error for inconsistent positive and negative predicates`, async () => {
    const shape = await shaclShapeFromQuads(shapeInconsistentPredicates, shapeIri);
    expect(shape).toBeInstanceOf(Error);
  });

  // ── SolidBench parity ────────────────────────────────────────────────────

  describe('SolidBench', () => {
    it(`${name}: should parse the Comment shape (parity with ShEx test)`, async () => {
      const shape = await shaclShapeFromQuads(shaclSolidbenchComment, 'http://example.com#Comment');
      expect(shape).not.toBeInstanceOf(Error);

      const expectedPredicates = new Set([
        RDF_VOCAB.type,
        `${LBDCVOC_PREFIX}id`,
        `${LBDCVOC_PREFIX}creationDate`,
        `${LBDCVOC_PREFIX}locationIP`,
        `${LBDCVOC_PREFIX}browserUsed`,
        `${LBDCVOC_PREFIX}content`,
        `${LBDCVOC_PREFIX}lenght`,
        `${LBDCVOC_PREFIX}hasTag`,
        `${LBDCVOC_PREFIX}isLocatedIn`,
        `${LBDCVOC_PREFIX}hasCreator`,
      ]);

      const mapCardinality = new Map([
        [RDF_VOCAB.type, { min: 0, max: 1 }],
        [`${LBDCVOC_PREFIX}id`, { min: 1, max: 1 }],
        [`${LBDCVOC_PREFIX}creationDate`, { min: 1, max: 1 }],
        [`${LBDCVOC_PREFIX}locationIP`, { min: 1, max: 1 }],
        [`${LBDCVOC_PREFIX}browserUsed`, { min: 1, max: 1 }],
        [`${LBDCVOC_PREFIX}content`, { min: 0, max: 1 }],
        [`${LBDCVOC_PREFIX}lenght`, { min: 1, max: 1 }],
        [`${LBDCVOC_PREFIX}hasTag`, { min: 0, max: -1 }],
        [`${LBDCVOC_PREFIX}isLocatedIn`, { min: 1, max: 1 }],
        [`${LBDCVOC_PREFIX}hasCreator`, { min: 1, max: 1 }],
      ]);

      const mapConstraint = new Map<string, IConstraint | undefined>([
        [RDF_VOCAB.type, { type: ConstraintType.CLASS, value: new Set([`${LBDCVOC_PREFIX}Comment`]) }],
        [`${LBDCVOC_PREFIX}id`, { type: ConstraintType.DATATYPE, value: new Set([`${XSD_PREFIX}long`]) }],
        [`${LBDCVOC_PREFIX}creationDate`, { type: ConstraintType.DATATYPE, value: new Set([`${XSD_PREFIX}dateTime`]) }],
        [`${LBDCVOC_PREFIX}locationIP`, { type: ConstraintType.DATATYPE, value: new Set([`${XSD_PREFIX}string`]) }],
        [`${LBDCVOC_PREFIX}browserUsed`, { type: ConstraintType.DATATYPE, value: new Set([`${XSD_PREFIX}string`]) }],
        [`${LBDCVOC_PREFIX}content`, { type: ConstraintType.DATATYPE, value: new Set([`${XSD_PREFIX}string`]) }],
        [`${LBDCVOC_PREFIX}lenght`, { type: ConstraintType.DATATYPE, value: new Set([`${XSD_PREFIX}int`]) }],
        [`${LBDCVOC_PREFIX}hasTag`, undefined],
        [`${LBDCVOC_PREFIX}isLocatedIn`, undefined],
        [`${LBDCVOC_PREFIX}hasCreator`, { type: ConstraintType.SHAPE, value: new Set(['http://example.com#Profile']) }],
      ]);

      expect((shape as IShape).closed).toBe(true);
      expect((shape as IShape).negativePredicates).toStrictEqual([]);
      expect(new Set((shape as IShape).positivePredicates)).toStrictEqual(expectedPredicates);
      expect((shape as IShape).name).toBe('http://example.com#Comment');
      expect((shape as IShape).getLinkedShapeIri()).toStrictEqual(
        new Set(['http://example.com#Post', 'http://example.com#Profile']),
      );

      for (const predicate of (shape as IShape).positivePredicates) {
        const resPredicate = (shape as IShape).get(predicate);
        expect(resPredicate?.cardinality).toStrictEqual(mapCardinality.get(predicate));
        expect(resPredicate?.constraint).toStrictEqual(mapConstraint.get(predicate));
      }

      // sh:or → two replyOf branches (Post and Comment)
      const expectedOneOf: OneOf[] = [
        [
          [
            {
              name: `${LBDCVOC_PREFIX}replyOf`,
              cardinality: { min: 0, max: -1 },
              constraint: { type: ConstraintType.SHAPE, value: new Set(['http://example.com#Post']) },
            },
          ],
          [
            {
              name: `${LBDCVOC_PREFIX}replyOf`,
              cardinality: { min: 0, max: -1 },
              constraint: { type: ConstraintType.SHAPE, value: new Set(['http://example.com#Comment']) },
            },
          ],
        ],
      ];
      expect((shape as IShape).oneOf).toStrictEqual(expectedOneOf);
    });
  });

  // ── Stream error handling ─────────────────────────────────────────────────

  if (name === 'shaclShapeFromQuads (stream)') {
    it(`${name}: should return an error when the stream emits an error`, async () => {
      const stream: any = {
        on(event: string, callback: any) {
          if (event === 'error') { return callback(new Error('stream failure')); }
        },
      };
      const err = await shaclShapeFromQuads(stream, shapeIri);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('stream failure');
    });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────

function populateArray(source: string | RDF.Quad[]): RDF.Quad[] {
  if (Array.isArray(source)) { return source; }
  return n3Parser.parse(readFileSync(source).toString());
}

function populateStream(source: string | RDF.Quad[]): any {
  let quads: RDF.Quad[];
  if (Array.isArray(source)) {
    quads = source;
  } else {
    quads = n3Parser.parse(readFileSync(source).toString());
  }
  return streamifyArray(quads);
}
