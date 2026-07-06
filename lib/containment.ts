import { Bindings, ContainmentType, IBindings } from './Binding'
import { generateStarPatternUnion, type IQuery } from './query';
import { ConstraintType, IShape } from './Shape';
import type { IStarPatternWithDependencies } from './Triple';
import type { Term } from '@rdfjs/types';

/**
 * Determine if a query is contained inside a shape.
 * It provides detailed information about the containment and whether or not
 * the documents linked with the shape should be followed.
 * @param param {IContainementArg} - the shape and the query to evaluate
 * @returns {IResult} result relative to the containement of the query inside of the shape
 */
export function solveShapeQueryContainment({ query, shapes, decidingShapes }: IContainementArg): IResult {
  const bindingResult = new Map<ShapeName, Map<StarPatternName, IBindingStatus>>();
  const starPatternsContainment = new Map<StarPatternName, IContainmentResult>();
  const classificationStats = new Map<StarPatternName, IContainmentStats>();

  const groupedShapes = groupShapeBydependencies(shapes);

  for (const [starPatternsName] of query.starPatterns) {
    starPatternsContainment.set(starPatternsName, { result: ContainmentResult.REJECTED, bindings: new Map() });
    classificationStats.set(starPatternsName, {
      hasOpenShape: false,
      hasClosedShape: false,
      rootTargetsOpen: new Set<string>(),
      rootTargetsClosed: new Set<string>(),
      containedTargets: new Set<string>(),
      bindings: new Map<string, IBindings>()
    });
  }

  for (const { shape, dependencies } of groupedShapes) {
    bindingResult.set(shape.name, new Map());
    const bindingResultofShape = bindingResult.get(shape.name)!;
    for (const [starPatternName, starPattern] of query.starPatterns) {
      const starPatternUnion = generateStarPatternUnion(query.union ?? [], starPatternName);
      const bindings = new Bindings(shape, starPattern, dependencies, starPatternUnion);
      const filterCompatibility = evaluateFiltersForShape(query.filters, starPattern, shape);
      bindingResultofShape.set(starPatternName, { result: bindings, shape });
      updateContainmentStats(classificationStats, starPatternName, shape, bindings, groupedShapes, decidingShapes, filterCompatibility !== FilterTruth.FALSE);
    }
  }

  for (const [starPatternName, starPattern] of query.starPatterns) {
    const stats = classificationStats.get(starPatternName)!;
    const rootTargetsOpen = Array.from(stats.rootTargetsOpen);
    const rootTargetsClosed = Array.from(stats.rootTargetsClosed);
    const containedTargets = Array.from(stats.containedTargets);
    const nestedTargets = Array.from(getNestedMatchingTargets(starPattern, classificationStats));

    let currentResult: IContainmentResult;
    if (containedTargets.length > 0) {
      currentResult = { result: ContainmentResult.CONTAINED, target: containedTargets, bindings: new Map(stats.bindings) };
    } else if (rootTargetsOpen.length > 0) {
      currentResult = { result: ContainmentResult.ALIGNED, target: rootTargetsOpen, bindings: new Map(stats.bindings) };
    } else {
      const unalignedTargets = Array.from(new Set(rootTargetsClosed.concat(nestedTargets)));
      if (unalignedTargets.length > 0) {
        const bindings = rootTargetsClosed.length > 0 ? new Map(stats.bindings) : new Map();
        currentResult = { result: ContainmentResult.UNALINGED, target: unalignedTargets, bindings };
      } else {
        const rejectedResult = stats.hasOpenShape ? ContainmentResult.WEAKLY_REJECTED : ContainmentResult.REJECTED;
        currentResult = { result: rejectedResult, bindings: new Map() };
      }
    }

    starPatternsContainment.set(starPatternName, currentResult);
  }

  return {
    starPatternsContainment,
    visitShapeBoundedResource: generateVisitStatus(bindingResult, shapes)
  };

}

function updateContainmentStats(
  classificationStats: Map<StarPatternName, IContainmentStats>,
  starPatternName: StarPatternName,
  shape: IShape,
  bindings: IBindings,
  groupedShapes: IShapeWithDependencies[],
  decidingShapes?: Set<string>,
  filterCompatible = true,
): void {
  if (decidingShapes !== undefined && !decidingShapes.has(shape.name)) {
    return;
  }

  const stats = classificationStats.get(starPatternName)!;
  if (shape.closed) {
    stats.hasClosedShape = true;
  } else {
    stats.hasOpenShape = true;
  }

  if (!filterCompatible) {
    return;
  }

  const hasRootMatch = bindings.getBoundTriple().length > 0;
  if (hasRootMatch) {
    stats.bindings.set(shape.name, bindings);
    if (shape.closed) {
      stats.rootTargetsClosed.add(shape.name);
    } else {
      stats.rootTargetsOpen.add(shape.name);
    }
  }

  if (bindings.isFullyBounded() && bindings.containmentType().result === ContainmentType.FULL) {
    stats.bindings.set(shape.name, bindings);
    stats.containedTargets.add(shape.name);
  }

  // Preserve previous behavior where a disjunction can be considered fully covered
  // when unresolved alternatives are contained by another deciding shape.
  if (bindings.isFullyBounded() && bindings.containmentType().result === ContainmentType.PARTIAL) {
    const unContaineStarPattern = bindings.containmentType().unContaineStarPattern!;
    const hasDisjuncContainment = findDisjunctContainment(unContaineStarPattern, groupedShapes, shape, decidingShapes);
    if (hasDisjuncContainment) {
      stats.bindings.set(shape.name, bindings);
      stats.containedTargets.add(shape.name);
    }
  }
}

function findDisjunctContainment(starPatterns: IStarPatternWithDependencies[], groupedShapes: IShapeWithDependencies[], shapeExcluded: IShape, decidingShapes?: Set<string>): boolean {
  let haveContainment = false;
  for (const starPattern of starPatterns) {
    for (const { shape, dependencies } of groupedShapes) {
      if (shape.name !== shapeExcluded.name && (decidingShapes === undefined || decidingShapes.has(shape.name))) {
        const bindings = new Bindings(shape, starPattern, dependencies);
        haveContainment = haveContainment || bindings.isFullyBounded();
      }
    }
  }
  return haveContainment;
}

function getNestedMatchingTargets(starPattern: IStarPatternWithDependencies, classificationStats: Map<StarPatternName, IContainmentStats>, visited: Set<string> = new Set()): Set<string> {
  const nestedNames = getNestedDependencyNames(starPattern, visited);
  const nestedTargets = new Set<string>();

  for (const nestedName of nestedNames) {
    const stats = classificationStats.get(nestedName);
    if (stats === undefined) {
      continue;
    }
    for (const target of stats.rootTargetsOpen) {
      nestedTargets.add(target);
    }
    for (const target of stats.rootTargetsClosed) {
      nestedTargets.add(target);
    }
  }

  return nestedTargets;
}

function getNestedDependencyNames(starPattern: IStarPatternWithDependencies, visited: Set<string>): Set<string> {
  const nestedNames = new Set<string>();
  if (visited.has(starPattern.name)) {
    return nestedNames;
  }
  visited.add(starPattern.name);

  for (const { dependencies } of starPattern.starPattern.values()) {
    if (dependencies === undefined) {
      continue;
    }

    nestedNames.add(dependencies.name);
    for (const nestedName of getNestedDependencyNames(dependencies, visited)) {
      nestedNames.add(nestedName);
    }
  }

  return nestedNames;
}

enum FilterTruth {
  TRUE = 'true',
  FALSE = 'false',
  UNKNOWN = 'unknown',
}

interface IFilterEvalContext {
  starPattern: IStarPatternWithDependencies;
  shape: IShape;
}

function evaluateFiltersForShape(
  filters: unknown[] | undefined,
  starPattern: IStarPatternWithDependencies,
  shape: IShape,
): FilterTruth {
  if (filters === undefined || filters.length === 0) {
    return FilterTruth.UNKNOWN;
  }

  const context: IFilterEvalContext = { starPattern, shape };
  let status = FilterTruth.UNKNOWN;
  for (const filter of filters) {
    const result = evaluateFilterCompatibility(filter, context);
    if (result === FilterTruth.FALSE) {
      return FilterTruth.FALSE;
    }
    if (result === FilterTruth.TRUE) {
      status = FilterTruth.TRUE;
    }
  }
  return status;
}

function evaluateFilterCompatibility(expression: unknown, context: IFilterEvalContext): FilterTruth {
  if (typeof expression !== 'object' || expression === null) {
    return FilterTruth.UNKNOWN;
  }

  const castExpression = expression as { subType?: string; operator?: string; args?: unknown[] };
  if (castExpression.subType === 'term') {
    // Boolean literals like FILTER(true/false) are intentionally ignored for containment.
    return FilterTruth.UNKNOWN;
  }
  if (castExpression.subType !== 'operator') {
    return FilterTruth.UNKNOWN;
  }

  const args = castExpression.args ?? [];
  switch (castExpression.operator) {
    case '&&':
      return combineLogicalAnd(args, context);
    case '||':
      return combineLogicalOr(args, context);
    case '!': {
      // Negation does not provide a safe contradiction signal in this conservative check.
      return FilterTruth.UNKNOWN;
    }
    case '=':
    case '!=':
    case '<':
    case '<=':
    case '>':
    case '>=':
      return evaluateComparisonCompatibility(castExpression.operator, args[0], args[1], context);
    default:
      return FilterTruth.UNKNOWN;
  }
}

function combineLogicalAnd(args: unknown[], context: IFilterEvalContext): FilterTruth {
  let hasTrue = false;
  for (const arg of args) {
    const current = evaluateFilterCompatibility(arg, context);
    if (current === FilterTruth.FALSE) {
      return FilterTruth.FALSE;
    }
    if (current === FilterTruth.TRUE) {
      hasTrue = true;
    }
  }
  return hasTrue ? FilterTruth.TRUE : FilterTruth.UNKNOWN;
}

function combineLogicalOr(args: unknown[], context: IFilterEvalContext): FilterTruth {
  let hasNonFalse = false;
  for (const arg of args) {
    const current = evaluateFilterCompatibility(arg, context);
    if (current !== FilterTruth.FALSE) {
      hasNonFalse = true;
    }
  }
  return hasNonFalse ? FilterTruth.UNKNOWN : FilterTruth.FALSE;
}

function evaluateComparisonCompatibility(operator: string, left: unknown, right: unknown, context: IFilterEvalContext): FilterTruth {
  const datatypeCheck = evaluateDatatypeCompatibility(operator, left, right, context)
    ?? evaluateDatatypeCompatibility(operator, right, left, context);
  if (datatypeCheck !== undefined) {
    return datatypeCheck;
  }

  if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
    const numericCheck = evaluateNumericComparisonCompatibility(left, right, context)
      ?? evaluateNumericComparisonCompatibility(right, left, context);
    if (numericCheck !== undefined) {
      return numericCheck;
    }
  }

  return FilterTruth.UNKNOWN;
}

function evaluateNumericComparisonCompatibility(variableExpr: unknown, otherExpr: unknown, context: IFilterEvalContext): FilterTruth | undefined {
  const variableName = extractVariableName(variableExpr);
  if (variableName === undefined) {
    return undefined;
  }

  const literal = extractLiteral(otherExpr);
  if (literal === undefined || getNumericLiteralValue(literal) === undefined) {
    return FilterTruth.UNKNOWN;
  }

  const datatypes = extractVariableDatatypes(variableName, context);
  if (datatypes === undefined) {
    return FilterTruth.UNKNOWN;
  }

  for (const datatype of datatypes) {
    if (isNumericDatatype(datatype)) {
      return FilterTruth.UNKNOWN;
    }
  }
  return FilterTruth.FALSE;
}

function evaluateDatatypeCompatibility(operator: string, datatypeExpr: unknown, otherExpr: unknown, context: IFilterEvalContext): FilterTruth | undefined {
  const variableName = extractDatatypeVariableName(datatypeExpr);
  if (variableName === undefined) {
    return undefined;
  }

  const expectedDatatype = extractNamedNodeValue(otherExpr);
  if (expectedDatatype === undefined) {
    return FilterTruth.UNKNOWN;
  }

  const datatypes = extractVariableDatatypes(variableName, context);
  if (datatypes === undefined) {
    return FilterTruth.UNKNOWN;
  }

  if (operator === '=' && !datatypes.has(expectedDatatype)) {
    return FilterTruth.FALSE;
  }
  if (operator === '!=' && datatypes.size === 1 && datatypes.has(expectedDatatype)) {
    return FilterTruth.FALSE;
  }
  return FilterTruth.UNKNOWN;
}

function extractVariableDatatypes(variableName: string, context: IFilterEvalContext): Set<string> | undefined {
  let collected: Set<string> | undefined;
  for (const { triple } of context.starPattern.starPattern.values()) {
    if (Array.isArray(triple.object) || triple.object.termType !== 'Variable' || triple.object.value !== variableName) {
      continue;
    }
    const predicateConstraint = context.shape.get(triple.predicate)?.constraint;
    if (predicateConstraint?.type !== ConstraintType.TYPE || predicateConstraint.value.size === 0) {
      continue;
    }
    if (collected === undefined) {
      collected = new Set(predicateConstraint.value);
      continue;
    }
    collected = new Set(Array.from(collected).filter((value) => predicateConstraint.value.has(value)));
  }

  return collected;
}

function extractVariableName(expression: unknown): string | undefined {
  if (typeof expression !== 'object' || expression === null) {
    return undefined;
  }
  const castExpression = expression as { subType?: string; term?: Term };
  if (castExpression.subType !== 'term' || castExpression.term === undefined || castExpression.term.termType !== 'Variable') {
    return undefined;
  }
  return castExpression.term.value;
}

function extractDatatypeVariableName(expression: unknown): string | undefined {
  if (typeof expression !== 'object' || expression === null) {
    return undefined;
  }
  const castExpression = expression as { subType?: string; operator?: string; args?: unknown[] };
  if (castExpression.subType !== 'operator' || castExpression.operator !== 'datatype') {
    return undefined;
  }
  return extractVariableName((castExpression.args ?? [])[0]);
}

function extractLiteral(expression: unknown): Term | undefined {
  if (typeof expression !== 'object' || expression === null) {
    return undefined;
  }
  const castExpression = expression as { subType?: string; term?: Term };
  if (castExpression.subType !== 'term' || castExpression.term === undefined || castExpression.term.termType !== 'Literal') {
    return undefined;
  }
  return castExpression.term;
}

function extractNamedNodeValue(expression: unknown): string | undefined {
  if (typeof expression !== 'object' || expression === null) {
    return undefined;
  }
  const castExpression = expression as { subType?: string; term?: Term };
  if (castExpression.subType !== 'term' || castExpression.term === undefined || castExpression.term.termType !== 'NamedNode') {
    return undefined;
  }
  return castExpression.term.value;
}

function getNumericLiteralValue(term: Term): number | undefined {
  if (term.termType !== 'Literal') {
    return undefined;
  }
  if (!isNumericDatatype(term.datatype.value)) {
    return undefined;
  }

  const value = Number(term.value);
  return Number.isNaN(value) ? undefined : value;
}

function isNumericDatatype(datatype: string): boolean {
  const numericDatatypes = new Set([
    'http://www.w3.org/2001/XMLSchema#integer',
    'http://www.w3.org/2001/XMLSchema#decimal',
    'http://www.w3.org/2001/XMLSchema#double',
    'http://www.w3.org/2001/XMLSchema#float',
    'http://www.w3.org/2001/XMLSchema#nonNegativeInteger',
    'http://www.w3.org/2001/XMLSchema#nonPositiveInteger',
    'http://www.w3.org/2001/XMLSchema#positiveInteger',
    'http://www.w3.org/2001/XMLSchema#negativeInteger',
    'http://www.w3.org/2001/XMLSchema#long',
    'http://www.w3.org/2001/XMLSchema#int',
    'http://www.w3.org/2001/XMLSchema#short',
    'http://www.w3.org/2001/XMLSchema#byte',
    'http://www.w3.org/2001/XMLSchema#unsignedLong',
    'http://www.w3.org/2001/XMLSchema#unsignedInt',
    'http://www.w3.org/2001/XMLSchema#unsignedShort',
    'http://www.w3.org/2001/XMLSchema#unsignedByte',
  ]);
  return numericDatatypes.has(datatype);
}

function groupShapeBydependencies(shapes: IShape[], dependentShapes?: IShape[]): IShapeWithDependencies[] {
  const resp: IShapeWithDependencies[] = [];
  for (let i = 0; i < shapes.length; i++) {
    const target = shapes[i];
    const others = new Map(
      shapes.slice(0, i).concat(shapes.slice(i + 1)).concat(dependentShapes ?? []).map((shape) => [shape.name, shape]));
    resp.push({
      shape: target,
      dependencies: others
    });
  }
  return resp
}


function generateVisitStatus(bindings: Map<ShapeName, Map<StarPatternName, IBindingStatus>>, shapes: IShape[]): Map<ShapeName, boolean> {
  const visitShapeBoundedResource = new Map<ShapeName, boolean>();
  for (const shape of shapes) {
    visitShapeBoundedResource.set(shape.name, false);
  }

  for (const [shapeName, starPatternBindings] of bindings) {
    for (const bindingShape of starPatternBindings.values()) {
      if (bindingShape !== undefined) {
        const previousStatus = visitShapeBoundedResource.get(shapeName)!;
        const currentStatus = bindingShape.result.shouldVisitShape();

        if (previousStatus === false && currentStatus === true) {
          visitShapeBoundedResource.set(shapeName, true);
        }
      }
    }
  }

  return visitShapeBoundedResource;
}

interface IBindingStatus {
  result: IBindings;
  shape: IShape;
}

interface IContainmentStats {
  hasOpenShape: boolean;
  hasClosedShape: boolean;
  rootTargetsOpen: Set<string>;
  rootTargetsClosed: Set<string>;
  containedTargets: Set<string>;
  bindings: Map<string, IBindings>;
}

interface IShapeWithDependencies {
  shape: IShape;
  dependencies: Map<string, IShape>;
}

export type StarPatternName = string;

/**
 * The argument of the report alignment function
 */
export interface IContainementArg {
  query: IQuery;
  shapes: IShape[];
  dependentShapes?: IShape[];
  // shapes to consider when making a decision
  decidingShapes?: Set<string>;
}


export type ShapeName = string;

/**
 * The result of the alignment
 */
export interface IResult {
  // The documents associated with a shape that can be followed
  visitShapeBoundedResource: Map<ShapeName, boolean>;
  // The type of containment of each star patterns with there associated shapes
  starPatternsContainment: Map<StarPatternName, IContainmentResult>;
}

/**
 * The result of a containement
 */
export type IContainmentResult = Readonly<{
  // The type of containement
  result: ContainmentResult;
  /**
   * The shape iri associated with the containement
   * Will be undefined if the the star pattern has no alignment with any shape
   */
  target?: string[];
  /**
   * Bindings of the containment
   */
  bindings: Map<string, IBindings>;
}>;

/**
 * The result of a containement
 */
export enum ContainmentResult {
  // All root and nested star patterns are fully covered.
  CONTAINED,
  // At least one triple in the root star pattern matches on an open shape.
  ALIGNED,
  // Root only matches on closed shapes, or only nested star patterns match.
  UNALINGED,
  // No triple matches and at least one candidate shape is open.
  WEAKLY_REJECTED,
  // No triple matches and all candidate shapes are closed.
  REJECTED,
}
