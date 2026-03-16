import { 
  Shape, 
  InconsistentPositiveAndNegativePredicateError, 
  ConstraintType, 
  OneOf, 
  OneOfIndexed, 
  IShapeJson 
} from '../lib/Shape';

describe('Shape', () => {
  describe('constructor', () => {
    it('should throw an error given a shape with inconsistent positive and negative properties', () => {
      expect(() =>
        new Shape({ name: 'foo', positivePredicates: ['a', 'b'], negativePredicates: ['c', 'a'] }))
        .toThrow(InconsistentPositiveAndNegativePredicateError);
    });
  });

  describe('toObject', () => {
    it('should return a shape with no predicate', () => {
      const shape = new Shape({ name: '', positivePredicates: [] });
      const expectedShape = {
        name: '',
        positivePredicates: [],
        negativePredicates: [],
        oneOf: [],
        closed: false,
      };

      expect(shape.toObject()).toStrictEqual(expectedShape);
    });

    it('should return a shape with positive predicates', () => {
      const predicates = ['a', 'b', 'c'];
      const shape = new Shape({ name: 'foo', positivePredicates: predicates, closed: true });
      const expectedShape = {
        name: 'foo',
        positivePredicates: predicates,
        negativePredicates: [],
        oneOf: [],
        closed: true,
      };

      expect(shape.toObject()).toStrictEqual(expectedShape);
    });

    it('should return a shape with negative predicates', () => {
      const predicates = ['a', 'b', 'c'];
      const shape = new Shape({ name: 'foo', positivePredicates: [], negativePredicates: predicates, closed: true });
      const expectedShape = {
        name: 'foo',
        positivePredicates: [],
        negativePredicates: predicates,
        oneOf: [],
        closed: true,
      };

      expect(shape.toObject()).toStrictEqual(expectedShape);
    });

    it('should return a shape with positive and negative predicates', () => {
      const positivePredicates = ['a', 'b', 'c'];
      const negativePredicates = ['d', 'e', 'f'];

      const shape = new Shape({ name: 'foo', positivePredicates, negativePredicates });
      const expectedShape = {
        name: 'foo',
        positivePredicates,
        negativePredicates,
        oneOf: [],
        closed: false,
      };

      expect(shape.toObject()).toStrictEqual(expectedShape);
    });

    it('should return a shape with oneOf', () => {
      const positivePredicates = ['a', 'b', 'c'];
      const negativePredicates = ['d', 'e', 'f'];
      const oneOf: OneOf[] = [[[{ name: "foo" }],]]
      const shape = new Shape({ name: 'foo', positivePredicates, negativePredicates, oneOf });
      const expectedShape = {
        name: 'foo',
        positivePredicates,
        negativePredicates,
        oneOf,
        closed: false,
      };

      expect(shape.toObject()).toStrictEqual(expectedShape);
    });

    it('should throw an error if a the negative and positive predicate are shared', () => {
      const positivePredicates = ['a', 'b', 'c'];
      const negativePredicates = ['d', 'a', 'f'];

      expect(() => new Shape({ name: 'foo', positivePredicates, negativePredicates }))
        .toThrow('the predicate a is defined in the positive and the negative property');
    });
  });

  describe('toJson', () => {
    it('should return a shape with no predicate', () => {
      const shape = new Shape({ name: '', positivePredicates: [] });
      const expectedShape: IShapeJson = {
        name: '',
        positivePredicates: [],
        negativePredicates: [],
        oneOf: [],
        closed: false,
      };

      expect(shape.toJson()).toStrictEqual(expectedShape);
    });

    it('should return a shape with predicates', () => {
      const predicates = [
        'a',
        { name: 'b' },
        {
          name: 'c',
          constraint: { value: new Set(["1", "2"]), type: ConstraintType.TYPE },
          cardinality: { min: 1, max: 5 },
          negative: false,
          optional: false
        }
      ];

      const negativePredicates = [{
        name: 'd',
        constraint: { value: new Set(["1", "2"]), type: ConstraintType.TYPE },
        cardinality: { min: 1, max: 5 },
        negative: true,
        optional: false
      }]
      const shape = new Shape({ name: 'foo', positivePredicates: predicates, negativePredicates, closed: true });
      const expectedShape = {
        name: 'foo',
        positivePredicates: [
          { name: 'a', constraint: undefined },
          { name: 'b', optional: false, constraint: undefined },
          {
            name: 'c',
            constraint: { value: ["1", "2"], type: ConstraintType.TYPE },
            cardinality: { min: 1, max: 5 },
            negative: false,
            optional: false
          }
        ],
        negativePredicates: [{
          name: 'd',
          constraint: { value: ["1", "2"], type: ConstraintType.TYPE },
          cardinality: { min: 1, max: 5 },
          negative: true,
          optional: false
        }],
        oneOf: [],
        closed: true,
      };

      expect(shape.toJson()).toStrictEqual(expectedShape);
    });


    it('should return a shape with oneOf', () => {
      const predicates = [
        'a',
        { name: 'b' },
        {
          name: 'c',
          constraint: { value: new Set(["1", "2"]), type: ConstraintType.TYPE },
          cardinality: { min: 0, max: 5 },
          negative: false,
          optional: true
        }
      ];
      const oneOf: OneOf[] = [
        [
          [
            { name: "foo", constraint: { value: new Set(["a"]), type: ConstraintType.SHAPE } }
          ]
        ]
      ]

      const shape = new Shape({ name: 'foo', positivePredicates: predicates, oneOf, closed: true });
      const expectedShape = {
        name: 'foo',
        positivePredicates: [
          { name: 'a', constraint: undefined },
          { name: 'b', constraint: undefined, optional: false },
          {
            name: 'c',
            constraint: { value: ["1", "2"], type: ConstraintType.TYPE },
            cardinality: { min: 0, max: 5 },
            negative: false,
            optional: true
          }
        ],
        negativePredicates: [],
        oneOf: [
          [
            [
              { name: "foo", constraint: { value: ["a"], type: ConstraintType.SHAPE } }
            ]
          ]
        ],
        closed: true,
      };

      expect(shape.toJson()).toStrictEqual(expectedShape);
    });
  });

  describe('get', () => {
    const positivePredicates: any = [
      'a',
      {
        name: 'b',
        cardinality: { min: 0, max: 33 },
        constraint: {
          value: 'a',
          type: ConstraintType.SHAPE,
        },
      },
      'c',
    ];
    const negativePredicates = [{ name: 'd' }, 'e', 'f'];

    const shape = new Shape({ name: 'foo', positivePredicates, negativePredicates });

    it('should get a predicate with no extra information', () => {
      expect(shape.get('a')).toStrictEqual({
        name: 'a',
      });
    });

    it('should not get a non existent predicate', () => {
      expect(shape.get('no')).toBeUndefined();
    });

    it('should get a negative predicate', () => {
      expect(shape.get('d')).toStrictEqual({
        name: 'd',
        negative: true,
      });
    });

    it('should get a predicate with extra information', () => {
      expect(shape.get('b')).toStrictEqual({
        name: 'b',
        cardinality: { min: 0, max: 33 },
        constraint: {
          value: 'a',
          type: ConstraintType.SHAPE,
        },
        optional: true,
      });
    });
  });

  describe('getAll', () => {
    const positivePredicates: any = [
      'a',
      {
        name: 'b',
        cardinality: { min: 0, max: 33 },
        constraint: {
          value: 'a',
          type: ConstraintType.SHAPE,
        },
      },
      'c',
    ];
    const negativePredicates = ['d', 'e', 'f'];

    const shape = new Shape({ name: 'foo', positivePredicates, negativePredicates });

    it('should get all predicates', () => {
      // eslint-disable-next-line @typescript-eslint/require-array-sort-compare
      const expectedPredicates = [
        { name: 'a' },
        {
          name: 'b',
          cardinality: { min: 0, max: 33 },
          constraint: {
            value: 'a',
            type: ConstraintType.SHAPE,
          },
          optional: true,
        },
        { name: 'c' },
        { name: 'd', negative: true },
        { name: 'e', negative: true },
        { name: 'f', negative: true },
      ].sort();

      // eslint-disable-next-line @typescript-eslint/require-array-sort-compare
      expect(shape.getAll().sort()).toStrictEqual(expectedPredicates);
    });

    it('should get all predicates with a shape with no predicates', () => {
      const shapeWithNoProperties = new Shape({ name: 'foo', positivePredicates: [] });

      expect(shapeWithNoProperties.getAll()).toStrictEqual([]);
    });
  });

  describe('getLinkedShapeIri', () => {
    const positivePredicates: any = [
      'a',
      {
        name: 'b',
        cardinality: { min: 0, max: 33 },
        constraint: {
          value: new Set(['foo1']),
          type: ConstraintType.SHAPE,
        },
      },
      {
        name: 'c',
        cardinality: { min: 0, max: 33 },
        constraint: {
          value: new Set(['bar']),
          type: ConstraintType.SHAPE,
        },
      },
    ];
    const negativePredicates = ['d', 'e', 'f'];

    const shape = new Shape({ name: 'foo', positivePredicates, negativePredicates });

    it('should return the linked shape IRI', () => {
      const expectedLinkedShapeIri = new Set(['bar', 'foo1']);
      expect(shape.getLinkedShapeIri()).toStrictEqual(expectedLinkedShapeIri);
    });

    it('should return an empty set given there are no shape constraint', () => {
      const shapeWithNoLink = new Shape({
        name: 'foo', positivePredicates: ['a', 'b', {
          name: 'c', constraint: {
            value: new Set(['bar']),
            type: ConstraintType.TYPE,
          },
        }]
      });
      const expectedLinkedShapeIri = new Set();
      expect(shapeWithNoLink.getLinkedShapeIri()).toStrictEqual(expectedLinkedShapeIri);
    });
  });

  describe('getOneOfs', () => {
    it('should return no one of(s)', () => {
      const shape = new Shape({ name: '', positivePredicates: [] });
      expect(shape.oneOf).toStrictEqual([]);
      expect(shape.oneOfIndexed).toStrictEqual([]);
    });

    it('should return one of(s)', () => {
      const oneOf: OneOf[] = [
        [
          [{ name: "foo" }],
          [{ name: "foo1" }]
        ],
        [
          [
            {
              name: 'b',
              cardinality: { min: 0, max: 33 },
              constraint: {
                value: new Set('a'),
                type: ConstraintType.SHAPE,
              }
            },
            {
              name: 'c',
              cardinality: { min: 0, max: 33 },
              constraint: {
                value: new Set('a'),
                type: ConstraintType.SHAPE,
              }
            },

          ],
          [
            { name: "foo1" }
          ],
          [
            { name: "foo2" }
          ]
        ]
      ];
      const oneOfIndexed: OneOfIndexed[] = [
        [
          new Map([["foo", { name: "foo" }]]),
          new Map([["foo1", { name: "foo1" }]])
        ],
        [
          new Map([
            ['b', {
              name: 'b',
              cardinality: { min: 0, max: 33 },
              constraint: {
                value: new Set('a'),
                type: ConstraintType.SHAPE,
              }
            }],
            ['c', {
              name: 'c',
              cardinality: { min: 0, max: 33 },
              constraint: {
                value: new Set('a'),
                type: ConstraintType.SHAPE,
              }
            }],
          ]),
          new Map([["foo1", { name: "foo1" }]]),
          new Map([["foo2", { name: "foo2" }]])
        ]
      ]
      const shape = new Shape({ name: '', positivePredicates: [], oneOf });
      expect(shape.oneOf).toStrictEqual(oneOf);
      expect(shape.oneOfIndexed).toStrictEqual(oneOfIndexed);
    });
  });
});
