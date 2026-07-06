import { Bindings, ContainmentType, IBindings } from './Binding'
import { generateStarPatternUnion, type IQuery } from './query';
import { ConstraintType, IConstraint, IShape } from './Shape';
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

  // Initialize per-star-pattern classification state.
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

  // Evaluate each star pattern against each candidate shape.
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

  // Collapse collected stats into the final containment label per star pattern.
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
  // Skip shapes that are not part of the current decision scope.
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

  // Track root-level alignment independently from full containment.
  const hasRootMatch = bindings.getBoundTriple().length > 0;
  if (hasRootMatch) {
    stats.bindings.set(shape.name, bindings);
    if (shape.closed) {
      stats.rootTargetsClosed.add(shape.name);
    } else {
      stats.rootTargetsOpen.add(shape.name);
    }
  }

  // Full binding means this shape fully contains the star pattern.
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
  // Search whether unresolved disjunctive branches can be absorbed by another shape.
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
  // Include shapes that only become reachable through nested star-pattern dependencies.
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
  // Break cycles in recursive dependency graphs.
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

interface INumericBounds {
  minInclusive?: number;
  maxInclusive?: number;
  minExclusive?: number;
  maxExclusive?: number;
}

interface IVariableDatatypeConstraint {
  datatypes: Set<string>;
  bounds?: INumericBounds;
  pattern?: string;
  flags?: string;
}

function evaluateFiltersForShape(
  filters: unknown[] | undefined,
  starPattern: IStarPatternWithDependencies,
  shape: IShape,
): FilterTruth {
  // Filters are evaluated conservatively: we only reject on proven contradiction.
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
    case 'regex':
      return evaluateRegexCompatibility(args, context);
    default:
      return FilterTruth.UNKNOWN;
  }
}

function combineLogicalAnd(args: unknown[], context: IFilterEvalContext): FilterTruth {
  // AND is false as soon as one branch is false; true only if at least one branch is provably true.
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
  // OR is false only if every branch is false.
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
  // First check datatype() comparisons, then numeric inequalities.
  const datatypeCheck = evaluateDatatypeCompatibility(operator, left, right, context)
    ?? evaluateDatatypeCompatibility(operator, right, left, context);
  if (datatypeCheck !== undefined) {
    return datatypeCheck;
  }

  if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
    const numericCheck = evaluateNumericComparisonCompatibility(operator, left, right, context, true)
      ?? evaluateNumericComparisonCompatibility(operator, right, left, context, false);
    if (numericCheck !== undefined) {
      return numericCheck;
    }
  }

  return FilterTruth.UNKNOWN;
}

function evaluateNumericComparisonCompatibility(
  operator: string,
  variableExpr: unknown,
  otherExpr: unknown,
  context: IFilterEvalContext,
  variableOnLeft: boolean,
): FilterTruth | undefined {
  // This branch only reasons about variable-vs-literal numeric constraints.
  const variableName = extractVariableName(variableExpr);
  if (variableName === undefined) {
    return undefined;
  }

  const literal = extractLiteral(otherExpr);
  if (literal === undefined || getNumericLiteralValue(literal) === undefined) {
    return FilterTruth.UNKNOWN;
  }

  const variableConstraint = extractVariableDatatypeConstraint(variableName, context);
  if (variableConstraint === undefined) {
    return FilterTruth.UNKNOWN;
  }

  for (const datatype of variableConstraint.datatypes) {
    if (isNumericDatatype(datatype)) {
      const filterBounds = boundsFromNumericFilter(operator, getNumericLiteralValue(literal)!, variableOnLeft);
      const shapeBounds = variableConstraint.bounds;
      if (shapeBounds === undefined || filterBounds === undefined) {
        return FilterTruth.UNKNOWN;
      }

      // Contradiction when filter bounds and shape bounds have an empty intersection.
      const bounds = intersectBounds(shapeBounds, filterBounds);
      if (bounds === undefined) {
        return FilterTruth.FALSE;
      }

      return FilterTruth.UNKNOWN;
    }
  }
  return FilterTruth.FALSE;
}

function evaluateDatatypeCompatibility(operator: string, datatypeExpr: unknown, otherExpr: unknown, context: IFilterEvalContext): FilterTruth | undefined {
  // Handle FILTER(datatype(?v) = iri) and FILTER(datatype(?v) != iri) forms.
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
  return extractVariableDatatypeConstraint(variableName, context)?.datatypes;
}

function extractVariableDatatypeConstraint(variableName: string, context: IFilterEvalContext): IVariableDatatypeConstraint | undefined {
  let collectedDatatypes: Set<string> | undefined;
  let collectedBounds: INumericBounds | undefined;
  let collectedPattern: string | undefined;
  let collectedFlags: string | undefined;

  for (const { triple } of context.starPattern.starPattern.values()) {
    const matchesVariable = (!Array.isArray(triple.object) && triple.object.termType === 'Variable' && triple.object.value === variableName)
      || (Array.isArray(triple.object) && triple.boundVariable === variableName);
    if (!matchesVariable) {
      continue;
    }
    const predicateConstraint = context.shape.get(triple.predicate)?.constraint;
    if (predicateConstraint?.type !== ConstraintType.DATATYPE || predicateConstraint.value.size === 0) {
      continue;
    }

    // Multiple occurrences of the same variable are merged by intersection.
    if (collectedDatatypes === undefined) {
      collectedDatatypes = new Set(predicateConstraint.value);
    } else {
      collectedDatatypes = new Set(Array.from(collectedDatatypes).filter((value) => predicateConstraint.value.has(value)));
    }

    const bounds = extractNumericBounds(predicateConstraint);
    if (bounds !== undefined) {
      if (collectedBounds === undefined) {
        collectedBounds = bounds;
      } else {
        const intersected = intersectBounds(collectedBounds, bounds);
        if (intersected === undefined) {
          return {
            datatypes: collectedDatatypes,
            bounds: {
              minInclusive: 1,
              maxInclusive: 0,
            },
          };
        }
        collectedBounds = intersected;
      }
    }

    // Regex reasoning is only kept when all matching constraints agree on pattern/flags.
    if (predicateConstraint.pattern !== undefined) {
      if (collectedPattern === undefined) {
        collectedPattern = predicateConstraint.pattern;
        collectedFlags = predicateConstraint.flags;
      } else if (collectedPattern !== predicateConstraint.pattern || collectedFlags !== predicateConstraint.flags) {
        return {
          datatypes: collectedDatatypes,
          bounds: collectedBounds,
        };
      }
    }
  }

  if (collectedDatatypes === undefined) {
    return undefined;
  }

  return {
    datatypes: collectedDatatypes,
    bounds: collectedBounds,
    pattern: collectedPattern,
    flags: collectedFlags,
  };
}

function evaluateRegexCompatibility(args: unknown[], context: IFilterEvalContext): FilterTruth {
  // Supported form: FILTER(regex(str(?v), pattern, flags?)).
  const variableName = extractRegexVariableName(args[0]);
  if (variableName === undefined) {
    return FilterTruth.UNKNOWN;
  }

  const regexPattern = extractStringLiteralValue(args[1]);
  if (regexPattern === undefined) {
    return FilterTruth.UNKNOWN;
  }

  const regexFlags = extractStringLiteralValue(args[2]) ?? '';
  const variableConstraint = extractVariableDatatypeConstraint(variableName, context);
  if (variableConstraint?.pattern === undefined) {
    return FilterTruth.UNKNOWN;
  }

  // Equality alone is not strong enough to prove containment in this conservative pass,
  // so we keep it as UNKNOWN and only return TRUE/FALSE for explicit implication/conflict.
  if (variableConstraint.pattern === regexPattern && (variableConstraint.flags ?? '') === regexFlags) {
    return FilterTruth.UNKNOWN;
  }

  const shapePatternTest = buildRegex(variableConstraint.pattern, variableConstraint.flags);
  const filterPatternTest = buildRegex(regexPattern, regexFlags);
  if (shapePatternTest === undefined || filterPatternTest === undefined) {
    return FilterTruth.UNKNOWN;
  }

  // TRUE when the shape regex is strictly stronger and therefore always satisfies the filter.
  if (doesRegexConstraintImplyFilter(variableConstraint.pattern, variableConstraint.flags, regexPattern, regexFlags)) {
    return FilterTruth.TRUE;
  }

  // FALSE when prefix/literal heuristics identify an obvious incompatibility.
  if (hasRegexPrefixIncompatibility(variableConstraint.pattern, regexPattern)) {
    return FilterTruth.FALSE;
  }

  return FilterTruth.UNKNOWN;
}

interface IAnchoredLiteralPrefix {
  prefix: string;
  anchoredEnd: boolean;
}

function doesRegexConstraintImplyFilter(
  shapePattern: string,
  shapeFlags: string | undefined,
  filterPattern: string,
  filterFlags: string,
): boolean {
  // We only reason about implication when both regexes run under the same flags.
  const normalizedShapeFlags = shapeFlags ?? '';
  if (normalizedShapeFlags !== filterFlags) {
    return false;
  }

  const shapePrefix = extractAnchoredLiteralPrefix(shapePattern);
  const filterPrefix = extractAnchoredLiteralPrefix(filterPattern);
  if (shapePrefix === undefined || filterPrefix === undefined) {
    return false;
  }

  // If the filter is end-anchored (^x$), implication requires exact same anchored literal.
  if (filterPrefix.anchoredEnd) {
    return shapePrefix.anchoredEnd && shapePrefix.prefix === filterPrefix.prefix;
  }

  // For simple start-anchored prefixes, ^foo implies ^f.
  return shapePrefix.prefix.startsWith(filterPrefix.prefix);
}

function extractRegexVariableName(expression: unknown): string | undefined {
  // Accept both regex(?v, ...) and regex(str(?v), ...).
  if (typeof expression !== 'object' || expression === null) {
    return undefined;
  }

  const castExpression = expression as { subType?: string; operator?: string; args?: unknown[] };
  if (castExpression.subType === 'operator' && castExpression.operator === 'str') {
    return extractVariableName((castExpression.args ?? [])[0]);
  }

  return extractVariableName(expression);
}

function extractStringLiteralValue(expression: unknown): string | undefined {
  const literal = extractLiteral(expression);
  if (literal === undefined) {
    return undefined;
  }
  return literal.value;
}

function buildRegex(pattern: string, flags?: string): RegExp | undefined {
  // Invalid regexes are ignored in conservative compatibility checks.
  try {
    return new RegExp(pattern, flags);
  } catch {
    return undefined;
  }
}

function hasRegexPrefixIncompatibility(shapePattern: string, filterPattern: string): boolean {
  const shapePrefix = extractAnchoredLiteralPrefix(shapePattern);
  const filterPrefix = extractAnchoredLiteralPrefix(filterPattern);
  // Different anchored prefixes cannot both hold (e.g., ^foo vs ^bar).
  if (shapePrefix !== undefined && filterPrefix !== undefined && shapePrefix.prefix !== filterPrefix.prefix) {
    return true;
  }

  const shapeContains = extractContainsLiteral(shapePattern);
  const filterContains = extractContainsLiteral(filterPattern);
  if (shapeContains !== undefined && filterContains !== undefined && shapeContains !== filterContains) {
    return false;
  }

  // Mixed anchored-prefix/plain-literal incompatibility checks.
  if (shapePrefix !== undefined && filterContains !== undefined && !shapePrefix.prefix.includes(filterContains) && !filterContains.includes(shapePrefix.prefix)) {
    return true;
  }
  if (filterPrefix !== undefined && shapeContains !== undefined && !filterPrefix.prefix.includes(shapeContains) && !shapeContains.includes(filterPrefix.prefix)) {
    return true;
  }

  return false;
}

function extractAnchoredLiteralPrefix(pattern: string): IAnchoredLiteralPrefix | undefined {
  const match = pattern.match(/^\^([A-Za-z0-9 _-]+)(\$)?$/);
  if (match === null) {
    return undefined;
  }

  return {
    prefix: match[1],
    anchoredEnd: match[2] !== undefined,
  };
}

function extractContainsLiteral(pattern: string): string | undefined {
  const match = pattern.match(/^([A-Za-z0-9 _-]+)$/);
  return match?.[1];
}

function extractNumericBounds(constraint: IConstraint): INumericBounds | undefined {
  // Normalize optional SHACL numeric facets into a single interval object.
  const bounds: INumericBounds = {};
  if (constraint.minInclusive !== undefined) {
    bounds.minInclusive = constraint.minInclusive;
  }
  if (constraint.maxInclusive !== undefined) {
    bounds.maxInclusive = constraint.maxInclusive;
  }
  if (constraint.minExclusive !== undefined) {
    bounds.minExclusive = constraint.minExclusive;
  }
  if (constraint.maxExclusive !== undefined) {
    bounds.maxExclusive = constraint.maxExclusive;
  }

  return Object.keys(bounds).length === 0 ? undefined : bounds;
}

function boundsFromNumericFilter(operator: string, literalValue: number, variableOnLeft: boolean): INumericBounds | undefined {
  // Convert a comparison operator to an interval on the variable.
  const normalizedOperator = normalizeComparisonOperator(operator, variableOnLeft);
  switch (normalizedOperator) {
    case '>':
      return { minExclusive: literalValue };
    case '>=':
      return { minInclusive: literalValue };
    case '<':
      return { maxExclusive: literalValue };
    case '<=':
      return { maxInclusive: literalValue };
    default:
      return undefined;
  }
}

function normalizeComparisonOperator(operator: string, variableOnLeft: boolean): string {
  // Re-orient operator so bounds are always computed as variable OP literal.
  if (variableOnLeft) {
    return operator;
  }
  if (operator === '>') {
    return '<';
  }
  if (operator === '>=') {
    return '<=';
  }
  if (operator === '<') {
    return '>';
  }
  if (operator === '<=') {
    return '>=';
  }
  return operator;
}

function intersectBounds(left: INumericBounds, right: INumericBounds): INumericBounds | undefined {
  // Compute interval intersection; undefined means empty intersection.
  const lower = pickLowerBound(
    mergeLowerBound(left.minInclusive, false, left.minExclusive, true),
    mergeLowerBound(right.minInclusive, false, right.minExclusive, true),
  );
  const upper = pickUpperBound(
    mergeUpperBound(left.maxInclusive, false, left.maxExclusive, true),
    mergeUpperBound(right.maxInclusive, false, right.maxExclusive, true),
  );

  if (lower !== undefined && upper !== undefined) {
    if (lower.value > upper.value) {
      return undefined;
    }
    if (lower.value === upper.value && (lower.exclusive || upper.exclusive)) {
      return undefined;
    }
  }

  const bounds: INumericBounds = {};
  if (lower !== undefined) {
    if (lower.exclusive) {
      bounds.minExclusive = lower.value;
    } else {
      bounds.minInclusive = lower.value;
    }
  }
  if (upper !== undefined) {
    if (upper.exclusive) {
      bounds.maxExclusive = upper.value;
    } else {
      bounds.maxInclusive = upper.value;
    }
  }

  return bounds;
}

function mergeLowerBound(inclusive: number | undefined, inclusiveExclusive: boolean, exclusive: number | undefined, exclusiveExclusive: boolean): { value: number; exclusive: boolean } | undefined {
  // Pick the tighter lower bound from inclusive/exclusive candidates.
  const candidates: Array<{ value: number; exclusive: boolean }> = [];
  if (inclusive !== undefined) {
    candidates.push({ value: inclusive, exclusive: inclusiveExclusive });
  }
  if (exclusive !== undefined) {
    candidates.push({ value: exclusive, exclusive: exclusiveExclusive });
  }
  if (candidates.length === 0) {
    return undefined;
  }
  return pickLowerBound(candidates[0], candidates[1]);
}

function mergeUpperBound(inclusive: number | undefined, inclusiveExclusive: boolean, exclusive: number | undefined, exclusiveExclusive: boolean): { value: number; exclusive: boolean } | undefined {
  // Pick the tighter upper bound from inclusive/exclusive candidates.
  const candidates: Array<{ value: number; exclusive: boolean }> = [];
  if (inclusive !== undefined) {
    candidates.push({ value: inclusive, exclusive: inclusiveExclusive });
  }
  if (exclusive !== undefined) {
    candidates.push({ value: exclusive, exclusive: exclusiveExclusive });
  }
  if (candidates.length === 0) {
    return undefined;
  }
  return pickUpperBound(candidates[0], candidates[1]);
}

function pickLowerBound(a?: { value: number; exclusive: boolean }, b?: { value: number; exclusive: boolean }): { value: number; exclusive: boolean } | undefined {
  // Lower bound with the greatest value is the most restrictive.
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  if (a.value > b.value) {
    return a;
  }
  if (b.value > a.value) {
    return b;
  }
  return { value: a.value, exclusive: a.exclusive || b.exclusive };
}

function pickUpperBound(a?: { value: number; exclusive: boolean }, b?: { value: number; exclusive: boolean }): { value: number; exclusive: boolean } | undefined {
  // Upper bound with the smallest value is the most restrictive.
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  if (a.value < b.value) {
    return a;
  }
  if (b.value < a.value) {
    return b;
  }
  return { value: a.value, exclusive: a.exclusive || b.exclusive };
}

function extractVariableName(expression: unknown): string | undefined {
  // Extract a SPARQL variable from a term expression.
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
  // Extract variable name from datatype(?v).
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
  // Extract literal term from a term expression.
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
  // Extract named node IRI value from a term expression.
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
  // Parse numeric literal value only when datatype is numeric.
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
  // Accepted numeric XML Schema datatypes for numeric filter reasoning.
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
  // Build per-shape dependency maps that include all other visible shapes.
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
  // A shape is visitable if at least one star pattern binding marks it as followable.
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
