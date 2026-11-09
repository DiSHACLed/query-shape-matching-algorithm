import type { Term } from '@rdfjs/types';
import { type Algebra, AlgebraFactory } from '@traqula/algebra-transformations-1-1';
import { DataFactory } from 'rdf-data-factory';
import { type ITripleWithDependencies, Triple, type IStarPatternWithDependencies, type ITriple } from './Triple';
import { ConstraintType, type IPredicate, type IShape } from './Shape';
import { RDF, XSD } from './constant';
import { focusNodes, type ITargetAlternative } from './target';
import type { IQuery, UnsupportedConstruct } from './query';

const DF = new DataFactory();
const AF = new AlgebraFactory();

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
  unsupported: Set<UnsupportedConstruct>;
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
 * - Targets of the given shape -> patterns about its focus node (see {@link addTargetsOfInputShape})
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
    unsupported: new Set(),
  };

  buildStarPatternFromShape(shape, context);
  addTargetsOfInputShape(shape, context);
  const prunedSubjectRestriction = pruneEmptyStarPatterns(context);

  const query: IQuery = { starPatterns: context.starPatterns };
  if (context.filters.length > 0) {
    query.filters = context.filters;
  }
  if (context.unions.length > 0) {
    query.union = context.unions;
  }
  if (context.unsupported.size > 0) {
    query.unsupported = Array.from(context.unsupported);
  }
  // A shape about given nodes that constrains none of their properties asks for any triple about them
  if (context.starPatterns.size === 0 && prunedSubjectRestriction) {
    query.matchesAnyTriple = true;
  }

  return query;
}

/**
 * Translate the targets of the input shape into patterns about its focus node. Only the input
 * shape's own targets are translated: SHACL ignores the targets of the shapes it reaches through
 * sh:node.
 *
 * - A class target requires `rdf:type` with the class as value.
 * - A subjects-of target requires the predicate.
 * - Several class and subjects-of targets are alternatives, because the focus nodes of a shape are
 *   the union of the nodes of its targets: each target becomes a branch of a UNION, as the branches
 *   of an sh:or do.
 * - Node targets restrict the subject of the focus star pattern to the target nodes.
 * - An objects-of target adds a star pattern whose triple pattern has the focus node as object.
 *
 * Node and objects-of targets are not representable as alternatives of other targets. When they are
 * combined with other targets, or when several objects-of targets are declared, the targets are
 * ignored and reported, which can only over-estimate relevance.
 */
function addTargetsOfInputShape(shape: IShape, context: IShapeToQueryBuildContext): void {
  const focus = context.starPatterns.get(shape.name);
  const focusNodesOfShape = focusNodes(shape.targets);
  if (focus === undefined) {
    return;
  }

  switch (focusNodesOfShape.kind) {
    case 'any':
      return;
    case 'mixed':
      context.unsupported.add('TARGETS');
      return;
    case 'nodes':
      focus.subjectValues = new Set(focusNodesOfShape.nodes);
      return;
    case 'objectsOf': {
      const { predicate } = focusNodesOfShape;
      const incomingName = `${shape.name}#targetObjectsOf`;
      const triple = new Triple({ subject: incomingName, predicate, object: DF.namedNode(shape.name) });
      context.starPatterns.set(incomingName, {
        starPattern: new Map([[ predicate, { triple, dependencies: focus } ]]),
        name: incomingName,
        isVariable: true,
      });
      return;
    }
    case 'alternatives':
      addTargetAlternatives(shape.name, focus, focusNodesOfShape.alternatives, context);
  }
}

/**
 * Require the focus node to satisfy one of the target alternatives: each target class, or each
 * subjects-of predicate, is a branch of a UNION, or a triple pattern of the focus star pattern when
 * it is the only one.
 */
function addTargetAlternatives(
  shapeName: string,
  focus: IStarPatternWithDependencies,
  targetAlternatives: ITargetAlternative[],
  context: IShapeToQueryBuildContext,
): void {
  const alternatives: ITripleWithDependencies[] = [];
  for (const { predicate, classes } of targetAlternatives) {
    if (classes !== undefined) {
      for (const value of classes) {
        alternatives.push({ triple: new Triple({ subject: shapeName, predicate, object: DF.namedNode(value) }) });
      }
      continue;
    }
    // A declared property constraint on the predicate keeps its object and dependency, but is now required
    const declared = focus.starPattern.get(predicate);
    const object = declared?.triple.object ?? DF.variable(nextVariableName(shapeName, predicate, context.variableCounts));
    alternatives.push({ triple: new Triple({ subject: shapeName, predicate, object }), dependencies: declared?.dependencies });
  }

  if (alternatives.length === 1) {
    focus.starPattern.set(alternatives[0].triple.predicate, alternatives[0]);
    return;
  }
  context.unions.push(alternatives.map(alternative => ({
    starPatterns: new Map([[ shapeName, {
      starPattern: new Map([[ alternative.triple.predicate, alternative ]]),
      name: shapeName,
      isVariable: true,
    } ]]),
  })));
}

/**
 * Remove the star patterns without triple pattern or UNION branch. They come from shapes without
 * positive constraints, such as a shape that only declares targets, and would otherwise count as
 * unmatched. A triple pattern that pointed to one of them is kept, and matches on its predicate
 * alone. A negated triple pattern needs a star pattern to constrain, so the negations of a removed
 * star pattern are discarded and reported.
 * @returns whether a removed star pattern restricted its subject to given nodes
 */
function pruneEmptyStarPatterns(context: IShapeToQueryBuildContext): boolean {
  const inUnion = new Set<string>();
  for (const union of context.unions) {
    for (const branch of union) {
      for (const name of branch.starPatterns.keys()) {
        inUnion.add(name);
      }
    }
  }
  const removed = new Set<string>();
  let prunedSubjectRestriction = false;
  for (const [ name, starPattern ] of context.starPatterns) {
    if (starPattern.starPattern.size === 0 && !inUnion.has(name)) {
      removed.add(name);
      prunedSubjectRestriction = prunedSubjectRestriction || starPattern.subjectValues !== undefined;
      if ((starPattern.excludedPredicates?.size ?? 0) > 0) {
        context.unsupported.add('NOT');
      }
    }
  }
  for (const name of removed) {
    context.starPatterns.delete(name);
  }
  const remaining = [
    ...context.starPatterns.values(),
    ...context.unions.flatMap(union => union.flatMap(branch => [ ...branch.starPatterns.values() ])),
  ];
  for (const starPattern of remaining) {
    for (const tripleWithDependencies of starPattern.starPattern.values()) {
      if (tripleWithDependencies.dependencies !== undefined && removed.has(tripleWithDependencies.dependencies.name)) {
        tripleWithDependencies.dependencies = undefined;
      }
    }
  }
  return prunedSubjectRestriction;
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
  // What the shapes graph declares but the shape could not represent is discarded from the input
  for (const construct of shape.unsupported) {
    context.unsupported.add(construct);
  }

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
  if (shape.negativePredicates.length > 0) {
    starPattern.excludedPredicates = new Set(shape.negativePredicates);
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
    AF.createOperatorExpression('=', [
      AF.createOperatorExpression('datatype', [AF.createTermExpression(object)]),
      AF.createTermExpression(DF.namedNode(datatypeIri)),
    ]),
  );

  if (datatypeFilters.length === 1) {
    collector.push(datatypeFilters[0]);
  } else if (datatypeFilters.length > 1) {
    collector.push(reduceOrExpressions(datatypeFilters));
  }

  if (constraint.minInclusive !== undefined) {
    collector.push(AF.createOperatorExpression('>=', [
      AF.createTermExpression(object),
      AF.createTermExpression(numberLiteral(constraint.minInclusive)),
    ]));
  }
  if (constraint.maxInclusive !== undefined) {
    collector.push(AF.createOperatorExpression('<=', [
      AF.createTermExpression(object),
      AF.createTermExpression(numberLiteral(constraint.maxInclusive)),
    ]));
  }
  if (constraint.minExclusive !== undefined) {
    collector.push(AF.createOperatorExpression('>', [
      AF.createTermExpression(object),
      AF.createTermExpression(numberLiteral(constraint.minExclusive)),
    ]));
  }
  if (constraint.maxExclusive !== undefined) {
    collector.push(AF.createOperatorExpression('<', [
      AF.createTermExpression(object),
      AF.createTermExpression(numberLiteral(constraint.maxExclusive)),
    ]));
  }

  if (constraint.pattern !== undefined) {
    const regexArgs: Algebra.Expression[] = [
      AF.createOperatorExpression('str', [AF.createTermExpression(object)]),
      AF.createTermExpression(DF.literal(constraint.pattern)),
    ];
    if (constraint.flags !== undefined) {
      regexArgs.push(AF.createTermExpression(DF.literal(constraint.flags)));
    }
    collector.push(AF.createOperatorExpression('regex', regexArgs));
  }
}

/**
 * Fold multiple expressions into a left-associated logical OR tree.
 */
function reduceOrExpressions(expressions: Algebra.Expression[]): Algebra.Expression {
  let current = expressions[0];
  for (let i = 1; i < expressions.length; i++) {
    current = AF.createOperatorExpression('||', [current, expressions[i]]);
  }
  return current;
}

/**
 * Build an xsd:decimal literal for numeric facet comparisons.
 */
function numberLiteral(value: number): Term {
  return DF.literal(String(value), DF.namedNode(XSD.decimal));
}
