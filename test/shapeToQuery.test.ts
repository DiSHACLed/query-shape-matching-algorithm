import { describe, expect, it } from 'vitest';
import { ConstraintType, type IShape, Shape } from '../lib/Shape';
import { shapeToQuery } from '../lib/query';
import { solveShapeQueryContainment, ContainmentResult } from '../lib/containment';
import { RDF } from '../lib/constant';

function collectOperators(expression: unknown, output: string[]): void {
  if (typeof expression !== 'object' || expression === null) {
    return;
  }

  const castExpression = expression as { subType?: string; operator?: string; args?: unknown[] };
  if (castExpression.subType === 'operator' && castExpression.operator !== undefined) {
    output.push(castExpression.operator);
    for (const arg of castExpression.args ?? []) {
      collectOperators(arg, output);
    }
  }
}

describe('shapeToQuery', () => {
  it('should translate constraints, dependencies and oneOf branches', () => {
    const childShape: IShape = new Shape({
      name: 'https://www.example.ca/ChildShape',
      positivePredicates: [
        {
          name: 'https://www.example.ca/nickname',
          constraint: {
            type: ConstraintType.DATATYPE,
            value: new Set(['http://www.w3.org/2001/XMLSchema#string']),
            pattern: '^a',
          },
        },
      ],
      closed: true,
    });

    const rootShape: IShape = new Shape({
      name: 'https://www.example.ca/RootShape',
      positivePredicates: [
        {
          name: RDF.type,
          constraint: {
            type: ConstraintType.CLASS,
            value: new Set(['https://www.example.ca/Person']),
          },
        },
        {
          name: 'https://www.example.ca/age',
          constraint: {
            type: ConstraintType.DATATYPE,
            value: new Set(['http://www.w3.org/2001/XMLSchema#integer']),
            minInclusive: 18,
            maxInclusive: 35,
          },
        },
        {
          name: 'https://www.example.ca/knows',
          constraint: {
            type: ConstraintType.SHAPE,
            value: new Set([childShape.name]),
          },
        },
      ],
      oneOf: [
        [
          [{ name: 'https://www.example.ca/email' }],
          [{ name: 'https://www.example.ca/phone' }],
        ],
      ],
      closed: true,
    });

    const query = shapeToQuery(rootShape, { linkedShapes: [childShape] });

    expect(query.starPatterns.has(rootShape.name)).toBe(true);
    expect(query.starPatterns.has(childShape.name)).toBe(true);

    const rootStarPattern = query.starPatterns.get(rootShape.name)!;
    const typeTriple = rootStarPattern.starPattern.get(RDF.type)!.triple;
    expect(Array.isArray(typeTriple.object)).toBe(false);
    expect((typeTriple.object as any).termType).toBe('NamedNode');
    expect((typeTriple.object as any).value).toBe('https://www.example.ca/Person');

    const knowsTriple = rootStarPattern.starPattern.get('https://www.example.ca/knows')!;
    expect(knowsTriple.dependencies?.name).toBe(childShape.name);

    const operators: string[] = [];
    for (const filter of query.filters ?? []) {
      collectOperators(filter, operators);
    }
    expect(operators).toEqual(expect.arrayContaining(['datatype', '>=', '<=']));

    expect(query.union).toBeDefined();
    expect(query.union?.length).toBe(1);
    expect(query.union?.[0].length).toBe(2);
  });

  it('should be usable directly with solveShapeQueryContainment', () => {
    const sourceShape: IShape = new Shape({
      name: 'https://www.example.ca/SourceShape',
      positivePredicates: [
        {
          name: RDF.type,
          constraint: {
            type: ConstraintType.CLASS,
            value: new Set(['https://www.example.ca/Person']),
          },
        },
        {
          name: 'https://www.example.ca/age',
          constraint: {
            type: ConstraintType.DATATYPE,
            value: new Set(['http://www.w3.org/2001/XMLSchema#integer']),
            minInclusive: 18,
            maxInclusive: 35,
          },
        },
      ],
      closed: true,
    });

    const targetShape: IShape = new Shape({
      name: 'https://www.example.ca/TargetShape',
      positivePredicates: [
        {
          name: RDF.type,
          constraint: {
            type: ConstraintType.CLASS,
            value: new Set(['https://www.example.ca/Person']),
          },
        },
        {
          name: 'https://www.example.ca/age',
          constraint: {
            type: ConstraintType.DATATYPE,
            value: new Set(['http://www.w3.org/2001/XMLSchema#integer']),
            minInclusive: 10,
            maxInclusive: 50,
          },
        },
      ],
      closed: true,
    });

    const query = shapeToQuery(sourceShape);
    const result = solveShapeQueryContainment({ query, shapes: [targetShape] });

    expect(result.starPatternsContainment.get(sourceShape.name)?.result).toBe(ContainmentResult.CONTAINED);
  });
});
