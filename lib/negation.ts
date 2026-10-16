import { Algebra } from '@traqula/algebra-transformations-1-1';
import type { UnsupportedConstruct } from './query';

/** A negated triple pattern, waiting to be attached to the star pattern of its subject. */
export interface INegatedPattern { subject: string, predicate: string, construct: 'MINUS' | 'NOT EXISTS' }

/**
 * Return the graph pattern of a `NOT EXISTS` (or `!EXISTS`) expression, or undefined when the
 * expression is anything else.
 */
export function getNegatedExistenceInput(expression: Algebra.Expression): Algebra.Operation | undefined {
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
export function toNegatedPattern(negated: Algebra.Operation, scope: Algebra.Operation):
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
export function reportExistence(expression: Algebra.Expression, unsupported: Set<UnsupportedConstruct>, negated = false): void {
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
