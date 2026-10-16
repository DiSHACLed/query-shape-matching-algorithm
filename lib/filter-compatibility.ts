import type { Term } from '@rdfjs/types';
import { ConstraintType, type IConstraint, type IShape } from './Shape';
import type { IStarPatternWithDependencies } from './Triple';

/**
 * Whether the FILTER expressions of a query are compatible with what a shape says about the values
 * of a star pattern. Filters are evaluated conservatively: FALSE only on a proven contradiction.
 */
export enum FilterTruth {
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

export function evaluateFiltersForShape(
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

  // FALSE only when no string can match both literal patterns.
  if (hasRegexPrefixIncompatibility(variableConstraint.pattern, variableConstraint.flags, regexPattern, regexFlags)) {
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

function hasRegexPrefixIncompatibility(
  shapePattern: string,
  shapeFlags: string | undefined,
  filterPattern: string,
  filterFlags: string,
): boolean {
  // Flags change what a literal pattern matches (`i` folds case, `x` drops whitespace, `q` makes `^` and `$` literal,
  // `m` anchors at every line), so a contradiction is only decided between patterns without flags.
  if ((shapeFlags ?? '') !== '' || filterFlags !== '') {
    return false;
  }

  const shapePrefix = extractAnchoredLiteralPrefix(shapePattern);
  const filterPrefix = extractAnchoredLiteralPrefix(filterPattern);
  if (shapePrefix !== undefined && filterPrefix !== undefined) {
    return !areAnchoredLiteralsCompatible(shapePrefix, filterPrefix);
  }

  // A string can start with one literal and go on to contain another, so a prefix (^foo) contradicts no unanchored
  // literal (bar), and neither do two unanchored literals. Only an exact literal (^foo$) excludes what it lacks.
  const shapeContains = extractContainsLiteral(shapePattern);
  const filterContains = extractContainsLiteral(filterPattern);
  if (shapePrefix?.anchoredEnd === true && filterContains !== undefined) {
    return !shapePrefix.prefix.includes(filterContains);
  }
  if (filterPrefix?.anchoredEnd === true && shapeContains !== undefined) {
    return !filterPrefix.prefix.includes(shapeContains);
  }

  return false;
}

/**
 * Whether some string matches both start-anchored literal patterns: ^foo and ^fo are compatible, ^foo and ^bar are not,
 * and an end-anchored ^foo$ only admits prefixes of "foo".
 */
function areAnchoredLiteralsCompatible(first: IAnchoredLiteralPrefix, second: IAnchoredLiteralPrefix): boolean {
  if (first.anchoredEnd && second.anchoredEnd) {
    return first.prefix === second.prefix;
  }
  if (first.anchoredEnd) {
    return first.prefix.startsWith(second.prefix);
  }
  if (second.anchoredEnd) {
    return second.prefix.startsWith(first.prefix);
  }
  return first.prefix.startsWith(second.prefix) || second.prefix.startsWith(first.prefix);
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
  const candidates: { value: number; exclusive: boolean }[] = [];
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
  const candidates: { value: number; exclusive: boolean }[] = [];
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
