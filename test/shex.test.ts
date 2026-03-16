import { readFileSync } from 'fs';
import type * as RDF from '@rdfjs/types';
import * as N3 from 'n3';
import { DataFactory } from 'rdf-data-factory';
import { streamifyArray } from 'streamify-array';
import { SHEX_SHAPE, TYPE_DEFINITION, SHEX_PREDICATE } from '../lib/constant';
import { ConstraintType, IContraint, OneOf, type IShape } from '../lib/Shape';
import { shexShapeFromQuads } from '../lib/shex';

const DF = new DataFactory<RDF.BaseQuad>();
const n3Parser = new N3.Parser();

const shapeIri = 'http:exemple.ca/foo';
const LBDCVOC_PREFIX = "http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/";
const XSD_PREFIX = "http://www.w3.org/2001/XMLSchema#";

describe.each([
  [{ name: 'shexShapeFromQuads', populateFunction: populateArray }],
  [{ name: 'shapeFromStream', populateFunction: populateStream }],
])('$name', ({ populateFunction, name }) => {
  const emptyQuad: any = populateFunction([]);
  const unRelatedQuads: any = populateFunction(
    ([
      DF.quad(
        DF.namedNode('foo'),
        DF.namedNode(shapeIri),
        DF.blankNode(),
      ),
      DF.quad(
        DF.blankNode(),
        DF.namedNode('bar'),
        DF.blankNode(),
      ),
      DF.quad(
        DF.namedNode('a'),
        TYPE_DEFINITION,
        SHEX_SHAPE,
      ),
      DF.quad(
        DF.namedNode('a'),
        SHEX_PREDICATE,
        DF.blankNode(),
      ),
    ] as RDF.Quad[]),
  );

  const shapeWithOneProperty: any = populateFunction('./test/shape/shex_shape_one_property.ttl');
  const closedShapeWithMultipleProperties = populateFunction('./test/shape/shex_shape_closed_multiple_properties.ttl');
  const twoShapes = populateFunction('./test/shape/shex_two_shapes.ttl');
  const shapeWithShapeExpression = populateFunction('./test/shape/shex_with_shape_expression.ttl');

  const shapeNoPredicate = populateFunction('./test/shape/shex_invalid_shape_no_predicate.ttl');
  const shapeIncompleteRdfList = populateFunction('./test/shape/shex_invalid_shape_incomplete_rdf_list.ttl');

  const shapeWithANegativeProperty = populateFunction('./test/shape/shex_shape_with_a_negative_property.ttl');
  const shapeWithInverseAndPositiveProperties =
    populateFunction('./test/shape/shex_shape_positive_and_negative_properties.ttl');
  const shapeWithInconsistentPositiveAndNegativeProperties =
    populateFunction('./test/shape/shex_shape_inconsistent_positive_and_negative_properties.ttl');
  const shapeWithMultipleCardinality = populateFunction('./test/shape/shex_shape_multiple_cardinality.ttl');

  const shapeWithConstraints = populateFunction('./test/shape/shex_shape_with_constraints.ttl');

  const shapeWithOrStatement = populateFunction('./test/shape/shex_shape_simple_or_statement.ttl');
  const shapeWithOrStatementOne = populateFunction('./test/shape/shex_shape_simple_or_statement_single.ttl');
  const shapeWithOrStatementMultipleBranches = populateFunction('./test/shape/shex_shape_simple_or_statement_with_multiple_branches.ttl');
  const shapeWithOrStatementMultipleStatement = populateFunction('./test/shape/shex_shape_multiple_or_statement.ttl');

  const shapeSolidBenchComment = populateFunction('./test/shape/solidbench_comment.ttl');

  describe('SolidBench', () => {
    it(`${name}: should handle Comment`, async () => {
      const shape = await shexShapeFromQuads(shapeSolidBenchComment, "http://example.com#Comment");
      const expectedPredicates: string[] = [
        TYPE_DEFINITION.value,
        `${LBDCVOC_PREFIX}id`,
        `${LBDCVOC_PREFIX}creationDate`,
        `${LBDCVOC_PREFIX}locationIP`,
        `${LBDCVOC_PREFIX}browserUsed`,
        `${LBDCVOC_PREFIX}content`,
        `${LBDCVOC_PREFIX}lenght`,
        `${LBDCVOC_PREFIX}hasTag`,
        `${LBDCVOC_PREFIX}isLocatedIn`,
        `${LBDCVOC_PREFIX}hasCreator`,
      ];

      const mapCardinality = new Map([
        [TYPE_DEFINITION.value, { min: 0, max: 1 }],
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

      const mapConstraint = new Map<string, IContraint | undefined>([
        [TYPE_DEFINITION.value, { type: ConstraintType.TYPE, value: new Set([`${LBDCVOC_PREFIX}Comment`]) }],
        [`${LBDCVOC_PREFIX}id`, { type: ConstraintType.TYPE, value: new Set([`${XSD_PREFIX}long`]) }],
        [`${LBDCVOC_PREFIX}creationDate`, { type: ConstraintType.TYPE, value: new Set([`${XSD_PREFIX}dateTime`]) }],
        [`${LBDCVOC_PREFIX}locationIP`, { type: ConstraintType.TYPE, value: new Set([`${XSD_PREFIX}string`]) }],
        [`${LBDCVOC_PREFIX}browserUsed`, { type: ConstraintType.TYPE, value: new Set([`${XSD_PREFIX}string`]) }],
        [`${LBDCVOC_PREFIX}content`, { type: ConstraintType.TYPE, value: new Set([`${XSD_PREFIX}string`]) }],
        [`${LBDCVOC_PREFIX}lenght`, { type: ConstraintType.TYPE, value: new Set([`${XSD_PREFIX}int`]) }],
        [`${LBDCVOC_PREFIX}hasTag`, undefined],
        [`${LBDCVOC_PREFIX}isLocatedIn`, undefined],
        [`${LBDCVOC_PREFIX}hasCreator`, { type: ConstraintType.SHAPE, value: new Set(["http://example.com#Profile"]) }],
      ]);
      const expectedOneOf: OneOf[] = [
        [
          [
            {
              name: `${LBDCVOC_PREFIX}replyOf`,
              cardinality: { min: 0, max: -1 },
              constraint: { type: ConstraintType.SHAPE, value: new Set(["http://example.com#Post"]) }
            },
          ],
          [
            {
              name: `${LBDCVOC_PREFIX}replyOf`,
              cardinality: { min: 0, max: -1 },
              constraint: { type: ConstraintType.SHAPE, value: new Set(["http://example.com#Comment"]) }
            }
          ],
        ]
      ];


      expect(shape).not.toBeInstanceOf(Error);
      expect((shape as IShape).closed).toBe(true);
      expect((shape as IShape).negativePredicates).toStrictEqual([]);
      expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
      expect((shape as IShape).name).toBe("http://example.com#Comment");
      expect((shape as IShape).getLinkedShapeIri()).toStrictEqual(new Set(["http://example.com#Post", "http://example.com#Profile"]));

      for (const predicate of (shape as IShape).positivePredicates) {
        const expectedCardinality = mapCardinality.get(predicate);
        const expectedConstraint = mapConstraint.get(predicate);

        const resPredicate = (shape as IShape).get(predicate);
        expect(resPredicate?.cardinality).toStrictEqual(expectedCardinality);
        expect(resPredicate?.constraint).toStrictEqual(expectedConstraint);
      }

      expect((shape as IShape).oneOf).toStrictEqual(expectedOneOf);
    });
  });
  it(`${name}: should returns an error given an empty quad set`, async () => {
    expect(await shexShapeFromQuads(emptyQuad, shapeIri)).toBeInstanceOf(Error);
  });

  it(`${name}: should returns an error given unrelated quads`, async () => {
    expect(await shexShapeFromQuads(unRelatedQuads, shapeIri)).toBeInstanceOf(Error);
  });

  it(`${name}: should returns a shape with one property`, async () => {
    const shape = await shexShapeFromQuads(shapeWithOneProperty, shapeIri);

    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).positivePredicates).toStrictEqual(['http://example.org/state']);
    expect((shape as IShape).negativePredicates).toStrictEqual([]);
    expect((shape as IShape).closed).toBe(false);
    expect((shape as IShape).name).toBe(shapeIri);
  });

  it(`${name}: should returns a closed Shape with multiple properties`, async () => {
    const shape = await shexShapeFromQuads(closedShapeWithMultipleProperties, shapeIri);
    const expectedPredicates: string[] = [
      'http://ex.example/#state',
      'http://foaf.example/#name',
      'http://foaf.example/#mbox',
      'http://foaf.example/#hunter',
      'http://foaf.example/#me',
    ];
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(true);
    expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
    expect((shape as IShape).negativePredicates).toStrictEqual([]);
    expect((shape as IShape).name).toBe(shapeIri);
  });

  it(`${name}: should returns a Shape with multiple properties given some quads representing two shapes`, async () => {
    const shape = await shexShapeFromQuads(twoShapes, shapeIri);
    const expectedPredicates: string[] = [
      'http://foaf.example/#name',
      'http://foaf.example/#mbox',
    ];
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(false);
    expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
    expect((shape as IShape).negativePredicates).toStrictEqual([]);
    expect((shape as IShape).name).toBe(shapeIri);
  });

  it(`${name}: should returns an error given quads representing a shape with no predicate`, async () => {
    expect(await shexShapeFromQuads(shapeNoPredicate, shapeIri)).toBeInstanceOf(Error);
  });

  it(`${name}: should returns an error given quads representing a shape with an incomplete RDF list`, async () => {
    expect(await shexShapeFromQuads(shapeIncompleteRdfList, shapeIri)).toBeInstanceOf(Error);
  });

  it(`${name}: should returns a closed Shape with multiple properties  
    given some quads representing a shape with a shape expression`, async () => {
    const shape = await shexShapeFromQuads(shapeWithShapeExpression, shapeIri);
    const prefix = 'http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary';
    const expectedPredicates: string[] = [
      'http://www.w3.org/ns/pim/space#storage',
      `${prefix}/id`,
      `${prefix}/firstName`,
      `${prefix}/lastName`,
      `${prefix}/gender`,
      `${prefix}/birthday`,
      `${prefix}/locationIP`,
      `${prefix}/browserUsed`,
      `${prefix}/creationDate`,
      `${prefix}/isLocatedIn`,
      `${prefix}/speaks`,
      `${prefix}/email`,
      `${prefix}/hasInterest`,
      `${prefix}/studyAt`,
    ];
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(true);

    expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
    expect((shape as IShape).negativePredicates).toStrictEqual([]);
    expect((shape as IShape).name).toBe(shapeIri);
  });

  it(`${name}: should returns a Shape with a negative property`, async () => {
    const shape = await shexShapeFromQuads(shapeWithANegativeProperty, shapeIri);
    const expectedPredicates: string[] = [
    ];
    const negativePredicates: string[] = [
      'http://example.org/state',
    ];
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(false);
    expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
    expect((shape as IShape).negativePredicates).toStrictEqual(negativePredicates);
    expect((shape as IShape).name).toBe(shapeIri);
  });

  it(`${name}: should returns a Shape with positive and negative properties`, async () => {
    const shape = await shexShapeFromQuads(shapeWithInverseAndPositiveProperties, shapeIri);
    const expectedPredicates: string[] = [
      'http://xmlns.com/foaf/0.1/prop1',
      'http://xmlns.com/foaf/0.1/prop2',
    ];
    const negativePredicates: string[] = [
      'http://xmlns.com/foaf/0.1/prop3',
      'http://xmlns.com/foaf/0.1/prop4',
    ];
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(false);
    expect((shape as IShape).negativePredicates).toStrictEqual(negativePredicates);
    expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
    expect((shape as IShape).name).toBe(shapeIri);
  });

  it(`${name}: should handle a shape with multiple cardinalities`, async () => {
    const shape = await shexShapeFromQuads(shapeWithMultipleCardinality, shapeIri);
    const expectedPredicates: string[] = [
      'http://xmlns.com/foaf/0.1/prop1',
      'http://xmlns.com/foaf/0.1/prop3',
      'http://xmlns.com/foaf/0.1/prop4',
      'http://xmlns.com/foaf/0.1/prop5',
      'http://xmlns.com/foaf/0.1/prop6',
      'http://xmlns.com/foaf/0.1/prop7',
    ];
    const negativePredicates: string[] = [
      'http://xmlns.com/foaf/0.1/prop2',
    ];
    const mapCardinality = new Map([
      ['http://xmlns.com/foaf/0.1/prop1', { min: 1, max: 1 }],
      ['http://xmlns.com/foaf/0.1/prop3', { min: 5, max: 5 }],
      ['http://xmlns.com/foaf/0.1/prop4', { min: 1, max: 4 }],
      ['http://xmlns.com/foaf/0.1/prop5', { min: 1, max: -1 }],
      ['http://xmlns.com/foaf/0.1/prop6', { min: 0, max: 1 }],
      ['http://xmlns.com/foaf/0.1/prop7', { min: 0, max: -1 }],
    ]);
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(false);
    expect((shape as IShape).negativePredicates).toStrictEqual(negativePredicates);
    expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
    expect((shape as IShape).name).toBe(shapeIri);
    for (const predicate of (shape as IShape).positivePredicates) {
      const expectedCardinality = mapCardinality.get(predicate);
      const cardinality = (shape as IShape).get(predicate)?.cardinality;
      expect(cardinality).toStrictEqual(expectedCardinality);
    }
  });

  it(`${name}: should handle a shape with constraints`, async () => {
    const shape = await shexShapeFromQuads(shapeWithConstraints, shapeIri);
    const expectedPredicates: string[] = [
      'http://xmlns.com/foaf/0.1/prop1',
      'http://xmlns.com/foaf/0.1/prop2',
      'http://xmlns.com/foaf/0.1/prop3',
      'http://xmlns.com/foaf/0.1/prop4',
      'http://xmlns.com/foaf/0.1/prop5',
      'http://xmlns.com/foaf/0.1/prop6',
      'http://xmlns.com/foaf/0.1/prop7',
      'http://xmlns.com/foaf/0.1/prop8',
      'http://xmlns.com/foaf/0.1/prop10',
    ];
    const negativePredicates: string[] = [
      'http://xmlns.com/foaf/0.1/prop9',
    ];
    const mapCardinality = new Map([
      ['http://xmlns.com/foaf/0.1/prop1', { min: 0, max: 1 }],
      ['http://xmlns.com/foaf/0.1/prop2', { min: 1, max: -1 }],
      ['http://xmlns.com/foaf/0.1/prop3', { min: 1, max: -1 }],
      ['http://xmlns.com/foaf/0.1/prop4', { min: 1, max: -1 }],
      ['http://xmlns.com/foaf/0.1/prop5', { min: 1, max: -1 }],
      ['http://xmlns.com/foaf/0.1/prop6', { min: 1, max: -1 }],
      ['http://xmlns.com/foaf/0.1/prop7', { min: 1, max: -1 }],
      ['http://xmlns.com/foaf/0.1/prop8', { min: 1, max: -1 }],
      ['http://xmlns.com/foaf/0.1/prop10', { min: 1, max: -1 }],
    ]);

    const mapConstraint = new Map([
      ['http://xmlns.com/foaf/0.1/prop1',
        {
          type: ConstraintType.SHAPE,
          value: new Set(['http:exemple.ca/bar']),
        },
      ],
      ['http://xmlns.com/foaf/0.1/prop2', undefined],
      ['http://xmlns.com/foaf/0.1/prop3', undefined],
      ['http://xmlns.com/foaf/0.1/prop4', undefined],
      ['http://xmlns.com/foaf/0.1/prop5', undefined],
      ['http://xmlns.com/foaf/0.1/prop6', undefined],
      ['http://xmlns.com/foaf/0.1/prop7', undefined],
      ['http://xmlns.com/foaf/0.1/prop8', undefined],
      ['http://xmlns.com/foaf/0.1/prop10',
        {
          type: ConstraintType.TYPE,
          value: new Set(['http://example.org/unassigned']),
        },
      ],
    ]);
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(false);
    expect((shape as IShape).negativePredicates).toStrictEqual(negativePredicates);
    expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
    expect((shape as IShape).name).toBe(shapeIri);
    expect((shape as IShape).getLinkedShapeIri()).toStrictEqual(new Set(['http:exemple.ca/bar']));

    for (const predicate of (shape as IShape).positivePredicates) {
      const expectedCardinality = mapCardinality.get(predicate);
      const expectedConstraint = mapConstraint.get(predicate);

      const resPredicate = (shape as IShape).get(predicate);
      expect(resPredicate?.cardinality).toStrictEqual(expectedCardinality);
      expect(resPredicate?.constraint).toStrictEqual(expectedConstraint);
    }
  });

  it(`${name}: should throw an error given a shape with inconsistent positive and negative properties`, async () => {
    expect(
      await shexShapeFromQuads(shapeWithInconsistentPositiveAndNegativeProperties, shapeIri),
    ).toBeInstanceOf(Error);
  });

  it(`${name}: should handle a shape with an or statement`, async () => {
    const shape = await shexShapeFromQuads(shapeWithOrStatement, shapeIri);

    expect(shape).not.toBeInstanceOf(Error);

    const expectedPredicates: string[] = [
      'http://www.w3.org/2000/01/rdf-schema#mbox'
    ];
    const expectedOneOf: OneOf[] = [
      [
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#givenName',
            cardinality: { min: 1, max: -1 },
            constraint: undefined
          },
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#familyName',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#name',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],

      ]
    ];
    const negativePredicates: string[] = [];
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(false);
    expect((shape as IShape).negativePredicates).toStrictEqual(negativePredicates);
    expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
    expect((shape as IShape).name).toBe(shapeIri);
    expect((shape as IShape).oneOf).toStrictEqual(expectedOneOf);
  });

  it(`${name}: should handle a shape with an or statement with one expression`, async () => {
    const shape = await shexShapeFromQuads(shapeWithOrStatementOne, shapeIri);

    expect(shape).not.toBeInstanceOf(Error);

    const expectedPredicates: string[] = [
      'http://www.w3.org/2000/01/rdf-schema#mbox'
    ];
    const expectedOneOf: OneOf[] = [
      [
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#name',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#familyName',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
      ]
    ];
    const negativePredicates: string[] = [];
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(false);
    expect((shape as IShape).negativePredicates).toStrictEqual(negativePredicates);
    expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
    expect((shape as IShape).name).toBe(shapeIri);
    expect((shape as IShape).oneOf).toStrictEqual(expectedOneOf);
  });

  it(`${name}: should handle a shape with an or statement with multiple branches`, async () => {
    const shape = await shexShapeFromQuads(shapeWithOrStatementMultipleBranches, shapeIri);

    expect(shape).not.toBeInstanceOf(Error);

    const expectedPredicates: string[] = [
      'http://www.w3.org/2000/01/rdf-schema#mbox'
    ];
    const expectedOneOf: OneOf[] = [
      [
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#givenName',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#familyName',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#bar',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#bar1',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#bar2',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#name',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#foo',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
      ]
    ];
    const negativePredicates: string[] = [];
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(false);
    expect((shape as IShape).negativePredicates).toStrictEqual(negativePredicates);
    expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
    expect((shape as IShape).name).toBe(shapeIri);
    expect((shape as IShape).oneOf).toStrictEqual(expectedOneOf);
  });

  it(`${name}: should handle a shape with an or statement with multiple statement`, async () => {
    const shape = await shexShapeFromQuads(shapeWithOrStatementMultipleStatement, shapeIri);

    expect(shape).not.toBeInstanceOf(Error);

    const expectedPredicates: string[] = [
      'http://www.w3.org/2000/01/rdf-schema#mbox',
      'http://www.w3.org/2000/01/rdf-schema#mbox1'
    ];
    const expectedOneOf: OneOf[] = [
      [
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#givenName',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#familyName',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#bar',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#bar1',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#bar2',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#name',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#foo',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
      ],
      [
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#alternatif1',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#alternatif2',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ],
        [
          {
            name: 'http://www.w3.org/2000/01/rdf-schema#alternatif',
            cardinality: { min: 1, max: 1 },
            constraint: undefined
          },
        ]
      ]
    ];
    const negativePredicates: string[] = [];
    expect(shape).not.toBeInstanceOf(Error);
    expect((shape as IShape).closed).toBe(false);
    expect((shape as IShape).negativePredicates).toStrictEqual(negativePredicates);
    expect((shape as IShape).positivePredicates).toStrictEqual(expectedPredicates);
    expect((shape as IShape).name).toBe(shapeIri);
    expect((shape as IShape).oneOf).toStrictEqual(expectedOneOf);
  });

  if (name === 'shapeFromStream') {
    it(`${name}: should returns an error given the stream returns an error`, async () => {
      const stream: any =
      {
        on(event: string, callback: any) {
          if (event === 'error') { return callback(new Error('foo')); }
        },
      };
      const err = await shexShapeFromQuads(stream, shapeIri);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('foo');
    });
  }
});

function populateStream(source: string | RDF.Quad[]): any {
  let quads;
  if (Array.isArray(source)) {
    quads = source;
  } else {
    quads = n3Parser.parse(readFileSync(source).toString());
  }
  return streamifyArray(quads);
}

function populateArray(source: string | RDF.Quad[]): RDF.Quad[] {
  if (Array.isArray(source)) {
    return source;
  }
  return n3Parser.parse(readFileSync(source).toString());
}
