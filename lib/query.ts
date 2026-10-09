import type { Term } from '@rdfjs/types';
import { algebraUtils, Algebra } from '@traqula/algebra-transformations-1-1';
import { DataFactory } from 'rdf-data-factory';
import { ITripleWithDependencies, Triple, type IStarPatternWithDependencies, ITriple } from './Triple';
import { ConstraintType, ICardinality, IPredicate, IShape } from './Shape';
import { RDF, XSD } from './constant';

const DF = new DataFactory();

// Constrained PropertyPathSymbol type for cardinality operations
// These are the cardinality path types that contain a nested path with Link (iri property)
type CardinalityPropertyPathSymbol =
  | (Algebra.ZeroOrMorePath & { path: Algebra.Link })
  | (Algebra.ZeroOrOnePath & { path: Algebra.Link })
  | (Algebra.OneOrMorePath & { path: Algebra.Link });

// Constrained Algebra.Path type with restricted predicate
type CardinalityPath = Omit<Algebra.Path, 'predicate'> & {
  predicate: CardinalityPropertyPathSymbol;
};

type NpsPath = Omit<Algebra.Path, 'predicate'> & {
  predicate: Algebra.Nps
};

interface IAccumulatedTriples { triples: Map<string, ITriple>, isVariable: boolean }

/** A negated triple pattern, waiting to be attached to the star pattern of its subject. */
interface INegatedPattern { subject: string, predicate: string, construct: 'MINUS' | 'NOT EXISTS' }

/** Facts about the input discovered while walking the algebra, not carried by the star patterns. */
interface INormalizationState { matchesAnyTriple: boolean, negatedPatterns: INegatedPattern[] }

/**
 * A query divided into star patterns
 */
export interface IQuery {
  // star patterns indexed by subject
  starPatterns: Map<string, IStarPatternWithDependencies>;
  union?: IQuery[][];
  // top-level filter expressions attached to this query branch
  filters?: Algebra.Expression[];
  // VALUES bindings indexed by variable name
  values?: Map<string, Term[]>;
  /**
   * SPARQL constructs that were discarded during normalization because they are outside the
   * supported profile. Discarding them can only over-estimate relevance, never discard a
   * relevant resource, but it means the result approximates a sub-query of the given query.
   */
  unsupported?: UnsupportedConstruct[];
  /**
   * True when the query contained an unrestricted triple pattern (a variable predicate, as in
   * `?s ?p ?o`). Such a pattern constrains nothing beyond "the resource holds triples", so it is
   * not turned into a star pattern, but it is not a discarded construct either: it asks for every
   * triple, which any resource can answer.
   */
  matchesAnyTriple?: boolean;
}

/**
 * A SPARQL construct outside the supported profile, discarded during normalization. A `MINUS` or
 * `NOT EXISTS` over a single triple pattern is supported as a negated triple pattern and is only
 * reported here when it is not of that form. An `EXISTS` or `NOT EXISTS` expression that is
 * discarded stays in its FILTER, where it is undecidable.
 */
export type UnsupportedConstruct = 'MINUS' | 'SERVICE' | 'EXISTS' | 'NOT EXISTS';

export interface IShapeToQueryOptions {
  linkedShapes?: IShape[] | Map<string, IShape>;
}

interface IShapeToQueryBuildContext {
  shapeIndex: Map<string, IShape>;
  starPatterns: Map<string, IStarPatternWithDependencies>;
  filters: Algebra.Expression[];
  unions: IQuery[][];
  visitedShapes: Set<string>;
  variableCounts: Map<string, number>;
}

/**
 * Translation from an IShape to an IQuery representation.
 *
 * Supported mapping:
 * - Positive predicates -> triple patterns
 * - Negative predicates -> negated triple patterns (excluded predicates of the star pattern)
 * - Datatype + numeric/regex facets -> FILTER expressions
 * - SHAPE constraints -> dependent star patterns (when linked shapes are provided)
 * - oneOf/xone branches -> UNION branches
 *
 * Not supported (yet):
 * - closed/open world semantics
 */
export function shapeToQuery(shape: IShape, options?: IShapeToQueryOptions): IQuery {
  const shapeIndex = normalizeShapeIndex(shape, options?.linkedShapes);
  const context: IShapeToQueryBuildContext = {
    shapeIndex,
    starPatterns: new Map(),
    filters: [],
    unions: [],
    visitedShapes: new Set(),
    variableCounts: new Map(),
  };

  buildStarPatternFromShape(shape, context);

  const query: IQuery = { starPatterns: context.starPatterns };
  if (context.filters.length > 0) {
    query.filters = context.filters;
  }
  if (context.unions.length > 0) {
    query.union = context.unions;
  }

  return query;
}

/**
 * Extract the star pattern with the requested subject from each UNION branch set.
 */
export function generateStarPatternUnion(union: IQuery[][], starPatternName: string): IStarPatternWithDependencies[][] {
  const resp: IStarPatternWithDependencies[][] = [];
  for (const unionSet of union) {
    const currentUnionSet: IStarPatternWithDependencies[] = [];
    for (const union of unionSet) {
      const requestedStarPattern = union.starPatterns.get(starPatternName);
      if (requestedStarPattern !== undefined) {
        currentUnionSet.push(requestedStarPattern);
      }
    }
    if (currentUnionSet.length > 0) {
      resp.push(currentUnionSet)
    }
  }
  return resp;
}

/**
 * Build a lookup table for the root shape and any linked shapes that may be referenced.
 */
function normalizeShapeIndex(rootShape: IShape, linkedShapes?: IShape[] | Map<string, IShape>): Map<string, IShape> {
  const index = new Map<string, IShape>();
  index.set(rootShape.name, rootShape);

  if (linkedShapes === undefined) {
    return index;
  }

  if (linkedShapes instanceof Map) {
    for (const [name, shape] of linkedShapes) {
      index.set(name, shape);
    }
    return index;
  }

  for (const shape of linkedShapes) {
    index.set(shape.name, shape);
  }

  return index;
}

/**
 * Convert one shape into a root star pattern and recursively materialize reachable linked shapes.
 */
function buildStarPatternFromShape(shape: IShape, context: IShapeToQueryBuildContext): void {
  if (context.visitedShapes.has(shape.name)) {
    return;
  }
  context.visitedShapes.add(shape.name);

  const starPattern: IStarPatternWithDependencies = {
    starPattern: new Map(),
    name: shape.name,
    isVariable: true,
  };

  for (const predicateName of shape.positivePredicates) {
    const predicate = shape.get(predicateName);
    if (predicate === undefined || predicate.negative === true) {
      continue;
    }

    const tripleWithDependencies = predicateToTripleWithDependencies(shape.name, predicate, context, context.filters);
    starPattern.starPattern.set(predicate.name, tripleWithDependencies);
  }
  const negativePredicates = shape.negativePredicates ?? [];
  if (negativePredicates.length > 0) {
    starPattern.excludedPredicates = new Set(negativePredicates);
  }

  context.starPatterns.set(shape.name, starPattern);

  addOneOfAsUnion(shape, context);
}

/**
 * Translate shape alternatives into UNION branches attached to the generated query.
 */
function addOneOfAsUnion(shape: IShape, context: IShapeToQueryBuildContext): void {
  for (const oneOf of shape.oneOf) {
    const unionBranches: IQuery[] = [];
    for (const branch of oneOf) {
      const branchStar: IStarPatternWithDependencies = {
        starPattern: new Map(),
        name: shape.name,
        isVariable: true,
      };
      const branchFilters: Algebra.Expression[] = [];

      for (const predicate of branch) {
        if (predicate.negative === true) {
          continue;
        }
        const tripleWithDependencies = predicateToTripleWithDependencies(shape.name, predicate, context, branchFilters);
        branchStar.starPattern.set(predicate.name, tripleWithDependencies);
      }

      const branchQuery: IQuery = {
        starPatterns: new Map([[shape.name, branchStar]]),
      };
      if (branchFilters.length > 0) {
        branchQuery.filters = branchFilters;
      }
      unionBranches.push(branchQuery);
    }

    if (unionBranches.length > 0) {
      context.unions.push(unionBranches);
    }
  }
}

/**
 * Turn one shape predicate into a triple pattern and any dependency/filter information it implies.
 */
function predicateToTripleWithDependencies(
  shapeName: string,
  predicate: IPredicate,
  context: IShapeToQueryBuildContext,
  filterCollector: Algebra.Expression[],
): ITripleWithDependencies {
  const constraint = predicate.constraint;
  let object: Term;
  let dependencies: IStarPatternWithDependencies | undefined;

  if (constraint?.type === ConstraintType.SHAPE && constraint.value.size > 0) {
    const linkedShapeName = Array.from(constraint.value)[0];
    object = DF.namedNode(linkedShapeName);

    const linkedShape = context.shapeIndex.get(linkedShapeName);
    if (linkedShape !== undefined) {
      buildStarPatternFromShape(linkedShape, context);
      dependencies = context.starPatterns.get(linkedShapeName);
    }
  } else if (
    constraint?.type === ConstraintType.CLASS
    && predicate.name === RDF.type
    && constraint.value.size > 0
  ) {
    object = DF.namedNode(Array.from(constraint.value)[0]);
  } else {
    object = DF.variable(nextVariableName(shapeName, predicate.name, context.variableCounts));
    addDatatypeFiltersFromConstraint(constraint, object, filterCollector);
  }

  const triple: ITriple = new Triple({
    subject: shapeName,
    predicate: predicate.name,
    object,
    cardinality: predicate.cardinality,
    isOptional: predicate.optional,
  });

  return { triple, dependencies };
}

/**
 * Produce a stable variable name for generated query objects, deduplicated per predicate occurrence.
 */
function nextVariableName(shapeName: string, predicate: string, variableCounts: Map<string, number>): string {
  const base = toVariableBase(`${shapeName}_${predicate}`);
  const currentCount = variableCounts.get(base) ?? 0;
  variableCounts.set(base, currentCount + 1);
  return currentCount === 0 ? base : `${base}_${currentCount}`;
}

/**
 * Normalize arbitrary IRIs/shape names into SPARQL-safe variable base names.
 */
function toVariableBase(raw: string): string {
  const normalized = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '');
  if (normalized.length === 0) {
    return 'v';
  }
  if (/^[0-9]/.test(normalized)) {
    return `v_${normalized}`;
  }
  return normalized;
}

/**
 * Translate datatype, numeric, and regex shape facets into FILTER expressions on a generated variable.
 */
function addDatatypeFiltersFromConstraint(
  constraint: IPredicate['constraint'],
  object: Term,
  collector: Algebra.Expression[],
): void {
  if (constraint?.type !== ConstraintType.DATATYPE || object.termType !== 'Variable') {
    return;
  }

  const datatypeFilters = Array.from(constraint.value).map((datatypeIri) =>
    operatorExpression('=', [
      operatorExpression('datatype', [termExpression(object)]),
      termExpression(DF.namedNode(datatypeIri)),
    ]),
  );

  if (datatypeFilters.length === 1) {
    collector.push(datatypeFilters[0]);
  } else if (datatypeFilters.length > 1) {
    collector.push(reduceOrExpressions(datatypeFilters));
  }

  if (constraint.minInclusive !== undefined) {
    collector.push(operatorExpression('>=', [
      termExpression(object),
      termExpression(numberLiteral(constraint.minInclusive)),
    ]));
  }
  if (constraint.maxInclusive !== undefined) {
    collector.push(operatorExpression('<=', [
      termExpression(object),
      termExpression(numberLiteral(constraint.maxInclusive)),
    ]));
  }
  if (constraint.minExclusive !== undefined) {
    collector.push(operatorExpression('>', [
      termExpression(object),
      termExpression(numberLiteral(constraint.minExclusive)),
    ]));
  }
  if (constraint.maxExclusive !== undefined) {
    collector.push(operatorExpression('<', [
      termExpression(object),
      termExpression(numberLiteral(constraint.maxExclusive)),
    ]));
  }

  if (constraint.pattern !== undefined) {
    const regexArgs: Algebra.Expression[] = [
      operatorExpression('str', [termExpression(object)]),
      termExpression(DF.literal(constraint.pattern)),
    ];
    if (constraint.flags !== undefined) {
      regexArgs.push(termExpression(DF.literal(constraint.flags)));
    }
    collector.push(operatorExpression('regex', regexArgs));
  }
}

/**
 * Fold multiple expressions into a left-associated logical OR tree.
 */
function reduceOrExpressions(expressions: Algebra.Expression[]): Algebra.Expression {
  let current = expressions[0];
  for (let i = 1; i < expressions.length; i++) {
    current = operatorExpression('||', [current, expressions[i]]);
  }
  return current;
}

/**
 * Build an xsd:decimal literal for numeric facet comparisons.
 */
function numberLiteral(value: number): Term {
  return DF.literal(String(value), DF.namedNode(XSD.decimal));
}

/**
 * Wrap an RDF term in the algebra expression shape expected by filter constructors.
 */
function termExpression(term: Term): Algebra.Expression {
  return {
    subType: 'term',
    term,
  } as unknown as Algebra.Expression;
}

/**
 * Construct a generic operator expression node for the algebra filter representation.
 */
function operatorExpression(operator: string, args: Algebra.Expression[]): Algebra.Expression {
  return {
    subType: 'operator',
    operator,
    args,
  } as unknown as Algebra.Expression;
}

/**
 * Divide a query into star patterns
 * @param {Algebra.Operation} algebraQuery - the algebra of a query
 * @returns {Query} - A query divided into subject group where the predicate has to be an IRI
 * @todo add support for the bind operator
 */
export function generateQuery(algebraQuery: Algebra.Operation, optional?: boolean): IQuery {
  const accumulatedTriples = new Map<string, IAccumulatedTriples>();
  // the binding value to the value
  const accumulatedValues = new Map<string, Term[]>();
  const accumulatedUnion: IQuery[][] = [];
  const accumulatedFilters: Algebra.Expression[] = [];
  const accumulatedUnsupported = new Set<UnsupportedConstruct>();
  const state: INormalizationState = { matchesAnyTriple: false, negatedPatterns: [] };

  QueryHandler.collectFromAlgebra(algebraQuery, accumulatedTriples, accumulatedValues, accumulatedUnion, accumulatedFilters, optional, accumulatedUnsupported, state);

  return buildQuery(accumulatedTriples, accumulatedValues, accumulatedUnion, accumulatedFilters, accumulatedUnsupported, state);
}

/**
 * Finalize the accumulated parsing state into the query structure used by containment.
 */
function buildQuery(
  tripleArgs: Map<string, IAccumulatedTriples>,
  values: Map<string, Term[]>,
  accumulatedUnion: IQuery[][],
  filters: Algebra.Expression[] = [],
  unsupported: Set<UnsupportedConstruct> = new Set(),
  state: INormalizationState = { matchesAnyTriple: false, negatedPatterns: [] },
): IQuery {
  const innerQuery = new Map<string, IStarPatternWithDependencies>();
  const resp: IQuery = { starPatterns: innerQuery };
  if (state.matchesAnyTriple) {
    resp.matchesAnyTriple = true;
  }
  if (accumulatedUnion.length > 0) {
    resp.union = accumulatedUnion;
  }
  if (filters.length > 0) {
    resp.filters = [...filters];
  }
  if (values.size > 0) {
    resp.values = new Map(values);
  }

  // generate the root star patterns
  for (const [starPatternSubject, { triples, isVariable }] of tripleArgs) {
    for (let triple of triples.values()) {
      if (!Array.isArray(triple.object) && triple.object?.termType === "Variable") {
        const value = values.get(triple.object.value);
        if (value !== undefined) {
          triple = new Triple({
            subject: triple.subject,
            predicate: triple.predicate,
            object: value,
            boundVariable: triple.object.value,
            cardinality: triple.cardinality,
            negatedSet: triple.negatedSet
          });
        }
      }
      const starPattern = innerQuery.get(starPatternSubject);

      if (starPattern === undefined) {
        const predicateWithDependencies: ITripleWithDependencies = { triple: triple, dependencies: undefined };
        innerQuery.set(starPatternSubject, {
          starPattern: new Map([
            [triple.predicate, predicateWithDependencies]
          ]),
          name: starPatternSubject,
          isVariable: isVariable,
        });
      } else {
        const predicateWithDependencies: ITripleWithDependencies = { triple: triple, dependencies: undefined };
        starPattern.starPattern.set(triple.predicate, predicateWithDependencies);
      }
    }
  }

  // set the dependencies of the star pattern
  for (const starPatternWithDependencies of innerQuery.values()) {
    for (const tripleWithDependencies of starPatternWithDependencies.starPattern.values()) {
      addADependencyToStarPattern(tripleWithDependencies, innerQuery);
    }
  }

  // A negated triple pattern constrains the star pattern of its subject. Without a required triple
  // pattern there, the subject need not be bound at all, so the negation is discarded instead.
  for (const { subject, predicate, construct } of state.negatedPatterns) {
    const starPattern = innerQuery.get(subject);
    const hasRequiredTriple = starPattern !== undefined &&
      Array.from(starPattern.starPattern.values()).some(({ triple }) => triple.isOptional !== true);
    if (!hasRequiredTriple) {
      unsupported.add(construct);
      continue;
    }
    starPattern.excludedPredicates ??= new Set();
    starPattern.excludedPredicates.add(predicate);
  }
  if (unsupported.size > 0) {
    resp.unsupported = Array.from(unsupported);
  }
  addUnionDependencies(resp)
  return resp;
}

// could be made so that when adding a union we make sure to find the dependency
// function should be revisited
/**
 * Resolve dependencies inside UNION branches back to root star patterns when possible.
 */
function addUnionDependencies(query: IQuery): void {
  if (query.union === undefined) {
    return;
  }
  //eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let i = 0; i < query.union.length; i++) {
    const union = query.union[i];
    for (const branch of union) {
      for (const starPattern of branch.starPatterns.values()) {
        for (const triple of starPattern.starPattern.values()) {
          if (triple.dependencies === undefined) {
            const linkedStarPattern = triple.triple.getLinkedStarPattern();
            if (linkedStarPattern !== undefined) {
              const dependency = query.starPatterns.get(linkedStarPattern);
              if (dependency !== undefined) {
                triple.dependencies = dependency;
                continue;
              }
              //searchDependencyInUnion(query.union, i, triple);
            }
          }
        }
      }
    }
  }
}

/** 
 to figure out if it make sense
function searchDependencyInUnion(unions: IQuery[][], currentBranch: number, triple: ITripleWithDependencies) {
  const linkedStarPattern = triple.triple.getLinkedStarPattern();
  if (linkedStarPattern === undefined || triple.dependencies === undefined) {
    return;
  }
  for (let i = 0; i < unions.length; i++) {
    const union = unions[i];
    if (i === currentBranch) {
      continue;
    }
    for (const branch of union) {
      const dependency = branch.starPatterns.get(linkedStarPattern);
      if (dependency !== undefined) {
        triple.dependencies = dependency;
        return;
      }
    }
  }

}
*/

/**
 * Attach a star-pattern dependency to a triple when its object links to another known subject.
 */
function addADependencyToStarPattern(
  tripleWithDependencies: ITripleWithDependencies,
  innerQuery: Map<string, IStarPatternWithDependencies>): void {
  const linkedStarPattern = tripleWithDependencies.triple.getLinkedStarPattern();
  if (linkedStarPattern !== undefined) {
    const dependentStarPattern = innerQuery.get(linkedStarPattern);
    if (dependentStarPattern !== undefined) {
      tripleWithDependencies.dependencies = dependentStarPattern
    }

  }

}

namespace QueryHandler {

  /**
   * Walk a SPARQL algebra tree and accumulate triples, values, filters, and unions by query branch.
   */
  export function collectFromAlgebra(
    rootAlgebra: Algebra.Operation,
    accumulatedTriples: Map<string, IAccumulatedTriples>,
    accumulatedValues: Map<string, Term[]>,
    accumulatedUnion: IQuery[][],
    accumulatedFilters: Algebra.Expression[],
    optional?: boolean,
    unsupported: Set<UnsupportedConstruct> = new Set(),
    state: INormalizationState = { matchesAnyTriple: false, negatedPatterns: [] },
  ): void {
    algebraUtils.visitOperation(
      rootAlgebra,
      {
        [Algebra.Types.PATTERN]: {
          preVisitor: () => ({ continue: false }),
          visitor: handlePattern(accumulatedTriples, optional, () => { state.matchesAnyTriple = true; }),
        },
        // MINUS removes solutions and SERVICE evaluates elsewhere, so neither describes data the
        // candidate resource must hold. Their triple patterns must not be collected as required
        // patterns: doing so both inflates and deflates relevance. A MINUS over a single triple
        // pattern is kept as a negated triple pattern instead.
        [Algebra.Types.MINUS]: {
          preVisitor: () => ({ continue: false }),
          visitor: handleMinus(accumulatedTriples, accumulatedValues, accumulatedFilters, accumulatedUnion, unsupported, state, optional),
        },
        [Algebra.Types.SERVICE]: {
          preVisitor: () => ({ continue: false }),
          visitor: (): void => { unsupported.add('SERVICE'); },
        },
        [Algebra.Types.VALUES]: {
          preVisitor: () => ({ continue: false }),
          visitor: handleValues(accumulatedValues),
        },
        [Algebra.Types.UNION]: {
          preVisitor: () => ({ continue: false }),
          visitor: handleUnion(accumulatedUnion, unsupported, optional),
        },
        [Algebra.Types.LEFT_JOIN]: {
          preVisitor: () => ({ continue: false }),
          visitor: handleLeftJoin(accumulatedTriples, accumulatedValues, accumulatedFilters, accumulatedUnion, unsupported, state),
        },
        [Algebra.Types.PATH]: {
          preVisitor: () => ({ continue: false }),
          visitor: handlePropertyPath(accumulatedTriples, accumulatedUnion, accumulatedValues, optional),
        },
        [Algebra.Types.FILTER]: {
          visitor: handleFilter(accumulatedFilters, unsupported, state, optional),
          // Ignore the expression subtree (e.g. FILTER NOT EXISTS) to avoid collecting inner
          // patterns that belong to the filter condition, not the query body.
          preVisitor: () => ({ ignoreKeys: new Set(['expression']) }),
        },
      },
    );
  }

  /**
   * Keep the left operand of a MINUS. The right one describes solutions to exclude, not data the
   * candidate resource has to hold: it becomes a negated triple pattern when it is a single triple
   * pattern of the supported form, and is discarded otherwise.
   */
  function handleMinus(accumulatedTriples: Map<string, IAccumulatedTriples>,
    accumulatedValues: Map<string, Term[]>,
    accumulatedFilters: Algebra.Expression[],
    accumulatedUnion: IQuery[][],
    unsupported: Set<UnsupportedConstruct>,
    state: INormalizationState,
    optional?: boolean): (element: Algebra.Minus) => void {
    return (element: Algebra.Minus): void => {
      const [left, right] = element.input;
      const negatedPattern = optional === true ? undefined : toNegatedPattern(right, left);
      if (negatedPattern !== undefined) {
        state.negatedPatterns.push({ ...negatedPattern, construct: 'MINUS' });
      } else {
        unsupported.add('MINUS');
      }
      collectFromAlgebra(left, accumulatedTriples, accumulatedValues, accumulatedUnion, accumulatedFilters, optional, unsupported, state);
    }
  }

  /**
   * Split a LEFT JOIN into required and optional branches and collect both with the right optional flag.
   */
  function handleLeftJoin(accumulatedTriples: Map<string, IAccumulatedTriples>,
    accumulatedValues: Map<string, Term[]>,
    accumulatedFilters: Algebra.Expression[],
    accumulatedUnion: IQuery[][],
    unsupported: Set<UnsupportedConstruct>,
    state: INormalizationState): (element: Algebra.LeftJoin) => void {
    return (element: Algebra.LeftJoin): void => {
      const joinElement = element.input;
      const requiredElements = joinElement[0];
      const optionalElements = joinElement[1];

      // A filter of the OPTIONAL group only decides whether the optional part binds; it is not
      // evaluated, but an EXISTS or NOT EXISTS inside it is still reported as discarded.
      if (element.expression !== undefined) {
        reportExistence(element.expression, unsupported);
      }
      collectFromAlgebra(requiredElements, accumulatedTriples, accumulatedValues, accumulatedUnion, accumulatedFilters, undefined, unsupported, state);
      collectFromAlgebra(optionalElements, accumulatedTriples, accumulatedValues, accumulatedUnion, accumulatedFilters, true, unsupported, state);
    }
  }

  /**
   * Record a top-level FILTER expression without traversing into its expression subtree. A
   * `NOT EXISTS` over a single triple pattern of the supported form becomes a negated triple
   * pattern; any other `EXISTS` or `NOT EXISTS` stays in the expression, where it is undecidable,
   * and is reported as discarded.
   */
  function handleFilter(accumulatedFilters: Algebra.Expression[],
    unsupported: Set<UnsupportedConstruct>,
    state: INormalizationState,
    optional?: boolean): (element: Algebra.Filter) => void {
    return (element: Algebra.Filter): void => {
      const negatedInput = getNegatedExistenceInput(element.expression);
      const negatedPattern = negatedInput === undefined || optional === true ?
        undefined :
        toNegatedPattern(negatedInput, element.input);
      if (negatedPattern !== undefined) {
        state.negatedPatterns.push({ ...negatedPattern, construct: 'NOT EXISTS' });
        return;
      }
      reportExistence(element.expression, unsupported);
      accumulatedFilters.push(element.expression);
    }
  }

  /**
   * Return the graph pattern of a `NOT EXISTS` (or `!EXISTS`) expression, or undefined when the
   * expression is anything else.
   */
  function getNegatedExistenceInput(expression: Algebra.Expression): Algebra.Operation | undefined {
    if (expression.subType === Algebra.ExpressionTypes.EXISTENCE) {
      return expression.not ? expression.input : undefined;
    }
    if (expression.subType === Algebra.ExpressionTypes.OPERATOR && expression.operator === '!' &&
      expression.args.length === 1 && expression.args[0].subType === Algebra.ExpressionTypes.EXISTENCE &&
      !expression.args[0].not) {
      return expression.args[0].input;
    }
    return undefined;
  }

  /**
   * Read a negated graph pattern as a negated triple pattern `?x p ?o`. The pattern must be a single
   * triple pattern with a variable subject and an IRI predicate; its subject must be bound by a
   * required triple pattern of `scope`, the group the negation applies to (the filtered group of a
   * FILTER, the left operand of a MINUS); and its object must be a blank node or a variable that
   * does not occur in `scope`. The negation then removes exactly the solutions whose subject
   * carries `p`, so `MINUS` and `NOT EXISTS` coincide. Any other form returns undefined.
   */
  function toNegatedPattern(negated: Algebra.Operation, scope: Algebra.Operation):
    Omit<INegatedPattern, 'construct'> | undefined {
    if (negated.type !== Algebra.Types.BGP || negated.patterns.length !== 1) {
      return undefined;
    }
    const { subject, predicate, object, graph } = negated.patterns[0];
    if (subject.termType !== 'Variable' || predicate.termType !== 'NamedNode' ||
      graph.termType !== 'DefaultGraph') {
      return undefined;
    }
    const freshObject = object.termType === 'BlankNode' ||
      (object.termType === 'Variable' && !occursIn(object.value, scope));
    if (!freshObject || !getRequiredSubjects(scope).has(subject.value)) {
      return undefined;
    }
    return { subject: subject.value, predicate: predicate.value };
  }

  /**
   * Subjects of the triple patterns with an IRI predicate that every solution of `operation` binds.
   * The approximation is conservative: operations it does not know contribute no subject.
   */
  function getRequiredSubjects(operation: Algebra.Operation): Set<string> {
    switch (operation.type) {
      case Algebra.Types.BGP:
        return new Set(operation.patterns
          .filter(pattern => pattern.subject.termType === 'Variable' && pattern.predicate.termType === 'NamedNode')
          .map(pattern => pattern.subject.value));
      case Algebra.Types.JOIN:
        return new Set(operation.input.flatMap(input => Array.from(getRequiredSubjects(input))));
      case Algebra.Types.LEFT_JOIN:
      case Algebra.Types.MINUS:
        return getRequiredSubjects(operation.input[0]);
      case Algebra.Types.FILTER:
      case Algebra.Types.EXTEND:
      case Algebra.Types.DISTINCT:
      case Algebra.Types.REDUCED:
      case Algebra.Types.ORDER_BY:
      case Algebra.Types.GRAPH:
        return getRequiredSubjects(operation.input);
      case Algebra.Types.UNION: {
        const [first, ...rest] = operation.input.map(getRequiredSubjects);
        return new Set(Array.from(first ?? []).filter(subject => rest.every(branch => branch.has(subject))));
      }
      default:
        return new Set();
    }
  }

  /**
   * Whether the variable occurs anywhere in the operation, including its expressions.
   */
  function occursIn(variable: string, operation: unknown): boolean {
    if (typeof operation !== 'object' || operation === null) {
      return false;
    }
    const node = operation as { termType?: unknown, value?: unknown };
    if (node.termType === 'Variable' && node.value === variable) {
      return true;
    }
    return Object.values(operation).some(child => occursIn(variable, child));
  }

  /**
   * Report every `EXISTS` and `NOT EXISTS` of an expression as a discarded construct.
   */
  function reportExistence(expression: Algebra.Expression, unsupported: Set<UnsupportedConstruct>, negated = false): void {
    if (expression.subType === Algebra.ExpressionTypes.EXISTENCE) {
      unsupported.add(expression.not !== negated ? 'NOT EXISTS' : 'EXISTS');
      return;
    }
    if (expression.subType === Algebra.ExpressionTypes.OPERATOR || expression.subType === Algebra.ExpressionTypes.NAMED) {
      const negatesArgument = expression.subType === Algebra.ExpressionTypes.OPERATOR && expression.operator === '!';
      for (const argument of expression.args) {
        reportExistence(argument, unsupported, negatesArgument);
      }
    }
  }

  /**
   * Dispatch property-path parsing to direct, cardinality, negated-set, or alternative handlers.
   */
  function handlePropertyPath(
    accumulatedTriples: Map<string, IAccumulatedTriples>,
    accumulatedUnion: IQuery[][],
    accumulatedValues: Map<string, Term[]>,
    optional?: boolean,
  ): (element: Algebra.Path) => void {
    return (element: Algebra.Path): void => {
      const path = element.predicate.type;
      if (element.predicate.type === Algebra.Types.ALT) {
        accumulatedUnion.push(
          handleAltPropertyPath(
            element.subject,
            element.predicate.input,
            element.object,
            accumulatedValues,
            optional
          )
        );
      } else if (isCardinalityPropertyPath(element.predicate)) {
        const triple = handleCardinalityPropertyPath(element as CardinalityPath, optional);
        handleDirectPropertyPath(element, accumulatedTriples, triple);
      } else if (path === Algebra.Types.NPS) {
        const triple = handleNegatedPropertySet(element as NpsPath, optional);
        handleDirectPropertyPath(element, accumulatedTriples, triple);
      }
    };
  }

  /**
   * Convert a SPARQL UNION into a list of independently generated query branches.
   */
  function handleUnion(accumulatedUnion: IQuery[][], unsupported: Set<UnsupportedConstruct>, optional?: boolean): (element: Algebra.Union) => void {
    return (element: Algebra.Union): void => {
      const branches: Algebra.Operation[] = element.input;
      const currentUnion: IQuery[] = [];
      for (const branch of branches) {
        const branchQuery = generateQuery(branch, optional);
        // A construct discarded inside a branch is discarded from the query as a whole.
        for (const construct of branchQuery.unsupported ?? []) {
          unsupported.add(construct);
        }
        currentUnion.push(branchQuery);
      }
      accumulatedUnion.push(currentUnion);
    };
  }

  /**
   * Accumulate VALUES bindings by variable name so they can later replace variable objects.
   */
  function handleValues(accumulatedValues: Map<string, Term[]>): (element: Algebra.Values) => void {
    return (element: Algebra.Values): void => {
      const bindings: Record<string, Term>[] = element.bindings;
      for (const binding of bindings) {
        for (const [key, term] of Object.entries(binding)) {
          const value = accumulatedValues.get(key);
          if (value !== undefined) {
            value.push(term);
          } else {
            accumulatedValues.set(key, [term]);
          }
        }
      }
    }
  }

  /**
   * Convert a basic triple pattern into the internal Triple representation keyed by subject.
   */
  function handlePattern(
    accumulatedTriples: Map<string, IAccumulatedTriples>,
    optional?: boolean,
    wildcard?: () => void,
  ): (element: Algebra.Pattern) => void {
    return (quad: Algebra.Pattern): void => {
      const subject = quad.subject as Term;
      const predicate = quad.predicate as Term;
      const object = quad.object as Term;
      if (predicate.termType !== 'NamedNode') {
        // Shapes constrain named predicates, so an unrestricted pattern yields no star pattern.
        // It still asks for every triple of the resource, which is recorded separately.
        wildcard?.();
      }
      if (predicate.termType === 'NamedNode') {
        const startPattern = accumulatedTriples.get(subject.value);
        const triple: ITriple = new Triple({
          subject: subject.value,
          predicate: quad.predicate.value,
          object,
          isOptional: optional
        });
        if (startPattern === undefined) {
          accumulatedTriples.set(subject.value,
            { triples: new Map([[triple.toString(), triple]]), isVariable: subject.termType === "Variable" });
        } else {
          startPattern.triples.set(triple.toString(), triple);
        }
      }
    };
  }

  /**
   * Translate SPARQL cardinality property paths into triples carrying the corresponding cardinality range.
   */
  function handleCardinalityPropertyPath(
    element: CardinalityPath,
    optional?: boolean
  ): { triple: ITriple, isVariable: boolean } | undefined {
    const subject = element.subject as Term;
    const object = element.object as Term;
    const predicate = element.predicate.path.iri;
    const predicateCardinality = element.predicate.type;
    let cardinality = undefined;
    switch (predicateCardinality) {
      case Algebra.Types.ZERO_OR_MORE_PATH:
        cardinality = { min: 0, max: -1 }
        break;
      case Algebra.Types.ZERO_OR_ONE_PATH:
        cardinality = { min: 0, max: 1 };
        break;
      case Algebra.Types.ONE_OR_MORE_PATH:
        cardinality = { min: 1, max: -1 };
        break;
    }
    if (cardinality) {
      return {
        triple: new Triple({
          subject: subject.value,
          predicate: predicate.value,
          object,
          cardinality,
          isOptional: optional
        }),
        isVariable: subject.termType === "Variable"
      };
    }
  }

  /**
   * Insert the triple generated from a direct/path handler into the subject's accumulated star pattern.
   */
  function handleDirectPropertyPath(element: Algebra.Path,
    accumulatedTriples: Map<string, IAccumulatedTriples>,
    triple: { triple: ITriple, isVariable: boolean } | undefined): void {
    const subject = element.subject as Term;
    const startPattern = accumulatedTriples.get(subject.value);
    if (triple !== undefined) {
      if (startPattern === undefined) {
        accumulatedTriples.set(
          subject.value,
          {
            isVariable: triple.isVariable,
            triples: new Map([[triple.triple.toString(), triple.triple]])
          }
        );

      } else {
        startPattern.triples.set(triple.triple.toString(), triple.triple);
      }
    }
  }

  /**
   * Reverse an inverse path so downstream alternative handling can treat it like a forward path.
   */
  function handleInvPath(element: Algebra.Inv,
    subject: Term,
    object: Term,
    accumulatedValues: Map<string, Term[]>,
    optional?: boolean): IQuery[] {
    if (element.path.type === Algebra.Types.ALT) {
      return handleAltPropertyPath(object, element.path.input, subject, accumulatedValues, optional);
    } else {
      return handleAltPropertyPath(object, [element.path], subject, accumulatedValues, optional);
    }
  }

  /**
   * Expand an alternative property path into one query branch per alternative path expression.
   */
  function handleAltPropertyPath(
    subject: Term,
    predicates: Algebra.Operation[],
    object: Term,
    accumulatedValues: Map<string, Term[]>,
    optional?: boolean,
  ): IQuery[] {
    let union: IQuery[] = [];
    for (const path of predicates) {
      if (isCardinalityPropertyPath(path)) {
        const cardinality = getCardinality(path.type);
        union.push(handleLinkQuery(path.path, accumulatedValues, subject, object, cardinality, optional));
      } else if (path.type === Algebra.Types.LINK) {
        union.push(handleLinkQuery(path, accumulatedValues, subject, object, undefined, optional));
      } else if (path.type === Algebra.Types.SEQ) {
        union.push(handleSeqPathQuery(path, accumulatedValues, subject, object, optional));
      } else if (path.type === Algebra.Types.NPS) {
        union.push(handleNegatedPropertyQuery(path, accumulatedValues, subject, object, optional));
      } else if (path.type === Algebra.Types.INV) {
        const invOption = handleInvPath(path, subject, object, accumulatedValues, optional);
        union = union.concat(invOption);
      }
    }
    return union;
  }

  /**
   * Flatten a sequence path into chained triples and nested unions when intermediate segments require them.
   */
  function handleSeqPath(
    element: Algebra.Seq,
    accumulatedValues: Map<string, Term[]>,
    accumulatedTriples: Map<string, IAccumulatedTriples>,
    accumulatedUnion: IQuery[][],
    subject: Term,
    object: Term,
    optional?: boolean): void {
    const predicates = element.input;
    let currentObject: Term = DF.blankNode(`${(<Algebra.Link>predicates[0]).iri.value}_${subject.value}`);

    for (let i = 0; i < predicates.length; i++) {
      const path = predicates[i];
      const currentSubject: Term = i === 0 ? subject : currentObject;

      currentObject = i === predicates.length - 1 ?
        object : DF.blankNode(`${(<Algebra.Link>predicates[0]).iri.value}_${subject.value}`);

      if (path.type === Algebra.Types.LINK) {
        handleLink(path, accumulatedTriples, currentSubject, currentObject, undefined, optional);
      } else if (path.type === Algebra.Types.NPS) {
        handleNegatedPropertyLink(path, accumulatedTriples, currentSubject, currentObject, optional)
      } else if (path.type === Algebra.Types.ALT) {
        accumulatedUnion.push(handleAltPropertyPath(currentSubject, path.input, currentObject, accumulatedValues, optional));
      }
    }

  }

  /**
   * Build a standalone query branch for one sequence path expression.
   */
  function handleSeqPathQuery(
    element: Algebra.Seq,
    accumulatedValues: Map<string, Term[]>,
    subject: Term,
    object: Term,
    optional?: boolean
  ): IQuery {
    const accumulatedTriples = new Map<string, IAccumulatedTriples>();
    const accumulatedUnion: IQuery[][] = [];

    handleSeqPath(element, accumulatedValues, accumulatedTriples, accumulatedUnion, subject, object, optional);

    return buildQuery(accumulatedTriples, accumulatedValues, accumulatedUnion);
  }

  /**
   * Map algebra cardinality path operators to the internal min/max representation.
   */
  function getCardinality(nodeType: string): ICardinality | undefined {
    switch (nodeType) {
      case Algebra.Types.ZERO_OR_MORE_PATH:
        return { min: 0, max: -1 }
      case Algebra.Types.ZERO_OR_ONE_PATH:
        return { min: 0, max: 1 };
      case Algebra.Types.ONE_OR_MORE_PATH:
        return { min: 1, max: -1 };
    }
  }

  /**
   * Add a simple forward predicate link as a triple to the accumulated subject map.
   */
  function handleLink(element: Algebra.Link,
    accumulatedTriples: Map<string, IAccumulatedTriples>,
    subject: Term,
    object: Term,
    cardinality?: ICardinality,
    optional?: boolean
  ): void {
    const triple: ITriple = new Triple({
      subject: subject.value,
      predicate: element.iri.value,
      object,
      cardinality,
      isOptional: optional
    });

    accumulatedTriples.set(subject.value,
      {
        triples: new Map([[triple.toString(), triple]]),
        isVariable: subject.termType === "Variable"
      });
  }

  /**
   * Build a standalone query branch for one direct link path.
   */
  function handleLinkQuery(
    element: Algebra.Link,
    accumulatedValues: Map<string, Term[]>,
    subject: Term,
    object: Term,
    cardinality?: ICardinality,
    optional?: boolean,
  ): IQuery {
    const accumulatedTriples = new Map<string, IAccumulatedTriples>();
    handleLink(element, accumulatedTriples, subject, object, cardinality, optional);
    return buildQuery(accumulatedTriples, accumulatedValues, []);
  }

  /**
   * Represent a negated property set path as a synthetic triple carrying the excluded predicate IRIs.
   */
  function handleNegatedPropertyLink(
    element: Algebra.Nps,
    accumulatedTriples: Map<string, IAccumulatedTriples>,
    subject: Term,
    object: Term,
    optional?: boolean,
  ): void {
    const predicates = element.iris;
    const negatedSet = new Set<string>();
    for (const predicate of predicates) {
      negatedSet.add(predicate.value);
    }

    const triple: ITriple = new Triple({
      subject: subject.value,
      predicate: Triple.NEGATIVE_PREDICATE_SET,
      object,
      negatedSet,
      isOptional: optional
    });

    accumulatedTriples.set(subject.value,
      {
        triples: new Map([[triple.toString(), triple]]),
        isVariable: subject.termType === "Variable"
      });

  }

  /**
   * Build a standalone query branch for one negated property set path.
   */
  function handleNegatedPropertyQuery(
    element: Algebra.Nps,
    accumulatedValues: Map<string, Term[]>,
    subject: Term,
    object: Term,
    optional?: boolean,
  ): IQuery {
    const accumulatedTriples = new Map<string, IAccumulatedTriples>();
    handleNegatedPropertyLink(element, accumulatedTriples, subject, object, optional);
    return buildQuery(accumulatedTriples, accumulatedValues, []);
  }

  /**
   * Convert a top-level negated property set path into a triple result consumable by direct path insertion.
   */
  function handleNegatedPropertySet(element: NpsPath, optional?: boolean): { triple: ITriple, isVariable: boolean } | undefined {
    const subject = element.subject as Term;
    const object = element.object as Term;
    const predicates = element.predicate.iris;
    const negatedSet = new Set<string>();
    for (const predicate of predicates) {
      negatedSet.add(predicate.value);
    }

    return {
      triple: new Triple({
        subject: subject.value,
        predicate: Triple.NEGATIVE_PREDICATE_SET,
        object,
        negatedSet: negatedSet,
        isOptional: optional
      }),
      isVariable: subject.termType === "Variable"
    };
  }

  /**
   * Narrow a generic algebra operation to the subset of path operators that encode cardinality.
   */
  function isCardinalityPropertyPath(operation: Algebra.Operation): operation is CardinalityPropertyPathSymbol {
    return operation.type === Algebra.Types.ZERO_OR_MORE_PATH ||
      operation.type === Algebra.Types.ZERO_OR_ONE_PATH ||
      operation.type === Algebra.Types.ONE_OR_MORE_PATH;
  }
}
