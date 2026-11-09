import type { Term } from '@rdfjs/types';
import { algebraUtils, Algebra } from '@traqula/algebra-transformations-1-1';
import { DataFactory } from 'rdf-data-factory';
import { ITripleWithDependencies, Triple, type IStarPatternWithDependencies, ITriple } from './Triple';
import type { ICardinality } from './Shape';
import { getNegatedExistenceInput, type INegatedPattern, reportExistence, toNegatedPattern } from './negation';

const DF = new DataFactory();

interface IAccumulatedTriples { triples: Map<string, ITriple>, isVariable: boolean }

/** What normalizing a query branch accumulates while walking its algebra. */
interface INormalizationState {
  // triple patterns by subject
  triples: Map<string, IAccumulatedTriples>;
  // VALUES bindings by variable name
  values: Map<string, Term[]>;
  unions: IQuery[][];
  filters: Algebra.Expression[];
  unsupported: Set<UnsupportedConstruct>;
  // an unrestricted triple pattern (a variable predicate) was found
  matchesAnyTriple: boolean;
  negatedPatterns: INegatedPattern[];
}

/**
 * An empty normalization state. The branch built for one alternative of a property path shares the
 * VALUES bindings of the query it belongs to.
 */
function createNormalizationState(values = new Map<string, Term[]>()): INormalizationState {
  return {
    triples: new Map(),
    values,
    unions: [],
    filters: [],
    unsupported: new Set(),
    matchesAnyTriple: false,
    negatedPatterns: [],
  };
}

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
 *
 * `SUBQUERY` is a sub-SELECT, whose graph pattern is discarded. `BIND` is an expression bound to a
 * variable, and `AGGREGATE` a grouping, an aggregate or a HAVING condition: they are discarded, but the
 * graph pattern they apply to is kept. `PATH` is a property path outside the supported forms, which
 * is discarded as a whole, or a SHACL property shape whose path is not an IRI, which is ignored.
 *
 * `TARGETS` reports the targets of an input shape that could not be translated: node or objects-of
 * targets combined with other targets, or several objects-of targets. They are ignored. `NOT` reports
 * a sh:not of an input shape that does not forbid a single property, or that constrains a node about
 * which the input asks nothing else.
 */
export type UnsupportedConstruct = 'MINUS' | 'SERVICE' | 'EXISTS' | 'NOT EXISTS' | 'TARGETS' | 'NOT' |
  'SUBQUERY' | 'BIND' | 'AGGREGATE' | 'PATH';

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
 * Whether a subject is a variable of the pattern. A blank node in a SPARQL pattern behaves as a
 * variable that is not projected.
 */
function isVariableTerm(term: Term): boolean {
  return term.termType === 'Variable' || term.termType === 'BlankNode';
}


/**
 * Divide a query into star patterns
 * @param {Algebra.Operation} algebraQuery - the algebra of a query
 * @returns {Query} - A query divided into subject group where the predicate has to be an IRI
 */
export function generateQuery(algebraQuery: Algebra.Operation, optional?: boolean): IQuery {
  return normalizeGraphPattern(queryGraphPattern(algebraQuery), optional);
}

/**
 * Normalize a graph pattern, such as the operand of a UNION, which unlike a query has no query form
 * or solution modifier to leave out.
 */
function normalizeGraphPattern(operation: Algebra.Operation, optional?: boolean): IQuery {
  const state = createNormalizationState();
  QueryHandler.collectFromAlgebra(operation, state, optional);
  return buildQuery(state);
}

/**
 * The graph pattern of a query. The query form and the solution modifiers only shape the answers
 * to that pattern, so they are left out. So are the expressions bound on top of the graph pattern,
 * such as those of the SELECT clause: no triple pattern uses their variables. A PROJECT below them
 * is a sub-SELECT.
 */
function queryGraphPattern(operation: Algebra.Operation): Algebra.Operation {
  switch (operation.type) {
    case Algebra.Types.ASK:
    case Algebra.Types.CONSTRUCT:
    case Algebra.Types.DESCRIBE:
    case Algebra.Types.DISTINCT:
    case Algebra.Types.EXTEND:
    case Algebra.Types.FROM:
    case Algebra.Types.ORDER_BY:
    case Algebra.Types.PROJECT:
    case Algebra.Types.REDUCED:
    case Algebra.Types.SLICE:
      return queryGraphPattern(operation.input);
    default:
      return operation;
  }
}

/**
 * Index a triple pattern by subject. A triple pattern that is already there stays required when either
 * of the two is required: an OPTIONAL copy of a required triple pattern asks for nothing more.
 */
function addTriple(accumulatedTriples: Map<string, IAccumulatedTriples>, subject: Term, triple: ITriple): void {
  let accumulated = accumulatedTriples.get(subject.value);
  if (accumulated === undefined) {
    accumulated = { triples: new Map(), isVariable: isVariableTerm(subject) };
    accumulatedTriples.set(subject.value, accumulated);
  }
  const key = triple.toString();
  if (accumulated.triples.get(key)?.isOptional !== false) {
    accumulated.triples.set(key, triple);
  }
}

/**
 * Finalize the accumulated parsing state into the query structure used by containment.
 */
function buildQuery(state: INormalizationState): IQuery {
  const { triples: tripleArgs, values, unions: accumulatedUnion, filters, unsupported } = state;
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
            negatedSet: triple.negatedSet,
            isOptional: triple.isOptional,
          });
        }
      }
      let starPattern = innerQuery.get(starPatternSubject);
      if (starPattern === undefined) {
        starPattern = { starPattern: new Map(), name: starPatternSubject, isVariable: isVariable };
        innerQuery.set(starPatternSubject, starPattern);
      }
      // A star pattern is indexed by predicate; another triple pattern on the same predicate, with
      // another object, is kept under its own key.
      const key = starPattern.starPattern.has(triple.predicate) ? triple.toString() : triple.predicate;
      starPattern.starPattern.set(key, { triple: triple, dependencies: undefined });
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
  addStarPatternsOfEveryBranch(resp);
  return resp;
}

/**
 * Give a subject that has a star pattern in every branch of a UNION, but none in the body, an empty
 * star pattern of the body, so that it is classified through its branches. A subject that only some
 * branches have is left out: a solution through another branch need not bind it. The empty star
 * pattern is added last, so that no triple pattern depends on it.
 */
function addStarPatternsOfEveryBranch(query: IQuery): void {
  for (const union of query.union ?? []) {
    const [first, ...rest] = union.map(branch => new Map(
      Array.from(branch.starPatterns).filter(([ , starPattern ]) => starPattern.starPattern.size > 0),
    ));
    for (const [subject, starPattern] of first ?? []) {
      if (!query.starPatterns.has(subject) && rest.every(branch => branch.has(subject))) {
        query.starPatterns.set(subject, { starPattern: new Map(), name: subject, isVariable: starPattern.isVariable });
      }
    }
  }
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
    state: INormalizationState,
    optional?: boolean,
  ): void {
    algebraUtils.visitOperation(
      rootAlgebra,
      {
        [Algebra.Types.PATTERN]: {
          preVisitor: () => ({ continue: false }),
          visitor: handlePattern(state, optional),
        },
        // MINUS removes solutions and SERVICE evaluates elsewhere, so neither describes data the
        // candidate resource must hold. Their triple patterns must not be collected as required
        // patterns: doing so both inflates and deflates relevance. A MINUS over a single triple
        // pattern is kept as a negated triple pattern instead.
        [Algebra.Types.MINUS]: {
          preVisitor: () => ({ continue: false }),
          visitor: handleMinus(state, optional),
        },
        [Algebra.Types.SERVICE]: {
          preVisitor: () => ({ continue: false }),
          visitor: (): void => { state.unsupported.add('SERVICE'); },
        },
        [Algebra.Types.VALUES]: {
          preVisitor: () => ({ continue: false }),
          visitor: handleValues(state.values),
        },
        [Algebra.Types.UNION]: {
          preVisitor: () => ({ continue: false }),
          visitor: handleUnion(state, optional),
        },
        [Algebra.Types.LEFT_JOIN]: {
          preVisitor: () => ({ continue: false }),
          visitor: handleLeftJoin(state),
        },
        [Algebra.Types.PATH]: {
          preVisitor: () => ({ continue: false }),
          visitor: handlePropertyPath(state, optional),
        },
        [Algebra.Types.FILTER]: {
          visitor: handleFilter(state, optional),
          // Ignore the expression subtree (e.g. FILTER NOT EXISTS) to avoid collecting inner
          // patterns that belong to the filter condition, not the query body.
          preVisitor: () => ({ ignoreKeys: new Set(['expression']) }),
        },
        // A sub-SELECT is outside the supported profile: its patterns are scoped by its own
        // projection and modifiers, so none of them is collected.
        [Algebra.Types.PROJECT]: {
          preVisitor: () => ({ continue: false }),
          visitor: (): void => { state.unsupported.add('SUBQUERY'); },
        },
        // BIND and aggregation are discarded, but the graph pattern they apply to is kept.
        [Algebra.Types.EXTEND]: {
          preVisitor: () => ({ ignoreKeys: new Set(['expression']) }),
          visitor: (element: Algebra.Extend): void => {
            state.unsupported.add(isAggregation(element.input) ? 'AGGREGATE' : 'BIND');
          },
        },
        [Algebra.Types.GROUP]: {
          preVisitor: () => ({ ignoreKeys: new Set(['aggregates']) }),
          visitor: (): void => { state.unsupported.add('AGGREGATE'); },
        },
      },
    );
  }

  /**
   * Whether an operation groups solutions: a GROUP, or an expression or HAVING condition over one.
   */
  function isAggregation(operation: Algebra.Operation): boolean {
    return operation.type === Algebra.Types.GROUP ||
      ((operation.type === Algebra.Types.EXTEND || operation.type === Algebra.Types.FILTER) && isAggregation(operation.input));
  }

  /**
   * Keep the left operand of a MINUS. The right one describes solutions to exclude, not data the
   * candidate resource has to hold: it becomes a negated triple pattern when it is a single triple
   * pattern of the supported form, and is discarded otherwise.
   */
  function handleMinus(state: INormalizationState, optional?: boolean): (element: Algebra.Minus) => void {
    return (element: Algebra.Minus): void => {
      const [left, right] = element.input;
      const negatedPattern = optional === true ? undefined : toNegatedPattern(right, left);
      if (negatedPattern !== undefined) {
        state.negatedPatterns.push({ ...negatedPattern, construct: 'MINUS' });
      } else {
        state.unsupported.add('MINUS');
      }
      collectFromAlgebra(left, state, optional);
    }
  }

  /**
   * Split a LEFT JOIN into required and optional branches and collect both with the right optional flag.
   */
  function handleLeftJoin(state: INormalizationState): (element: Algebra.LeftJoin) => void {
    return (element: Algebra.LeftJoin): void => {
      const joinElement = element.input;
      const requiredElements = joinElement[0];
      const optionalElements = joinElement[1];

      // A filter of the OPTIONAL group only decides whether the optional part binds; it is not
      // evaluated, but an EXISTS or NOT EXISTS inside it is still reported as discarded.
      if (element.expression !== undefined) {
        reportExistence(element.expression, state.unsupported);
      }
      collectFromAlgebra(requiredElements, state);
      collectFromAlgebra(optionalElements, state, true);
    }
  }

  /**
   * Record a top-level FILTER expression without traversing into its expression subtree. A
   * `NOT EXISTS` over a single triple pattern of the supported form becomes a negated triple
   * pattern; any other `EXISTS` or `NOT EXISTS` stays in the expression, where it is undecidable,
   * and is reported as discarded.
   */
  function handleFilter(state: INormalizationState, optional?: boolean): (element: Algebra.Filter) => void {
    return (element: Algebra.Filter): void => {
      // A HAVING condition restricts groups, not the solutions of the graph pattern
      if (isAggregation(element.input)) {
        state.unsupported.add('AGGREGATE');
        return;
      }
      const negatedInput = getNegatedExistenceInput(element.expression);
      const negatedPattern = negatedInput === undefined || optional === true ?
        undefined :
        toNegatedPattern(negatedInput, element.input);
      if (negatedPattern !== undefined) {
        state.negatedPatterns.push({ ...negatedPattern, construct: 'NOT EXISTS' });
        return;
      }
      reportExistence(element.expression, state.unsupported);
      state.filters.push(element.expression);
    }
  }


  /**
   * Normalize a property path. A link and a negated property set, with or without the `?`, `*`, or `+`
   * cardinality, and an alternative of supported paths are supported; an inverse or a sequence is
   * supported within an alternative. Any other path is discarded as a whole and reported: keeping
   * part of it, such as some of its alternatives, would ask for more than the path does.
   */
  function handlePropertyPath(state: INormalizationState, optional?: boolean): (element: Algebra.Path) => void {
    return (element: Algebra.Path): void => {
      const subject = element.subject as Term;
      const object = element.object as Term;
      if (element.predicate.type === Algebra.Types.ALT) {
        const union = handleAltPropertyPath(subject, element.predicate.input, object, state.values, optional);
        if (union === undefined) {
          state.unsupported.add('PATH');
        } else {
          state.unions.push(union);
        }
        return;
      }
      const step = pathStep(subject, element.predicate, object, optional);
      if (step === undefined) {
        state.unsupported.add('PATH');
        return;
      }
      addTriple(state.triples, step.subject, step.triple);
    };
  }

  /**
   * The triple pattern of a path that is one step: a link or a negated property set, with an optional
   * `?`, `*`, or `+` cardinality, or the inverse of one, whose subject and object are swapped.
   * @returns undefined when the path is not one step
   */
  function pathStep(
    subject: Term,
    path: Algebra.Operation,
    object: Term,
    optional?: boolean,
    cardinality?: ICardinality,
  ): { subject: Term, triple: ITriple } | undefined {
    switch (path.type) {
      case Algebra.Types.LINK:
        return {
          subject,
          triple: new Triple({ subject: subject.value, predicate: path.iri.value, object, cardinality, isOptional: optional }),
        };
      case Algebra.Types.NPS:
        return {
          subject,
          triple: new Triple({
            subject: subject.value,
            predicate: Triple.NEGATIVE_PREDICATE_SET,
            object,
            negatedSet: new Set(path.iris.map(iri => iri.value)),
            cardinality,
            isOptional: optional,
          }),
        };
      case Algebra.Types.INV:
        return pathStep(object, path.path, subject, optional, cardinality);
      case Algebra.Types.ZERO_OR_MORE_PATH:
      case Algebra.Types.ZERO_OR_ONE_PATH:
      case Algebra.Types.ONE_OR_MORE_PATH: {
        const inner = path.path;
        if (cardinality !== undefined || (inner.type !== Algebra.Types.LINK && inner.type !== Algebra.Types.NPS)) {
          return undefined;
        }
        return pathStep(subject, inner, object, optional, getCardinality(path.type));
      }
      default:
        return undefined;
    }
  }

  /**
   * Convert a SPARQL UNION into a list of independently generated query branches.
   */
  function handleUnion(state: INormalizationState, optional?: boolean): (element: Algebra.Union) => void {
    return (element: Algebra.Union): void => {
      const branches: Algebra.Operation[] = element.input;
      const currentUnion: IQuery[] = [];
      for (const branch of branches) {
        const branchQuery = normalizeGraphPattern(branch, optional);
        // A construct discarded inside a branch is discarded from the query as a whole.
        for (const construct of branchQuery.unsupported ?? []) {
          state.unsupported.add(construct);
        }
        currentUnion.push(branchQuery);
      }
      state.unions.push(currentUnion);
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
  function handlePattern(state: INormalizationState, optional?: boolean): (element: Algebra.Pattern) => void {
    return (quad: Algebra.Pattern): void => {
      const subject = quad.subject as Term;
      const predicate = quad.predicate as Term;
      const object = quad.object as Term;
      if (predicate.termType !== 'NamedNode') {
        // Shapes constrain named predicates, so an unrestricted pattern yields no star pattern.
        // It still asks for every triple of the resource, which is recorded separately.
        state.matchesAnyTriple = true;
        return;
      }
      addTriple(state.triples, subject, new Triple({
        subject: subject.value,
        predicate: quad.predicate.value,
        object,
        isOptional: optional
      }));
    };
  }

  /**
   * Expand an alternative property path into one query branch per alternative path expression.
   * @returns undefined when an alternative is not supported, so that the path is discarded as a whole
   */
  function handleAltPropertyPath(
    subject: Term,
    alternatives: Algebra.Operation[],
    object: Term,
    accumulatedValues: Map<string, Term[]>,
    optional?: boolean,
  ): IQuery[] | undefined {
    const union: IQuery[] = [];
    for (const path of alternatives) {
      if (path.type === Algebra.Types.ALT || (path.type === Algebra.Types.INV && path.path.type === Algebra.Types.ALT)) {
        const nested = path.type === Algebra.Types.ALT ?
          handleAltPropertyPath(subject, path.input, object, accumulatedValues, optional) :
          handleAltPropertyPath(object, (path.path as Algebra.Alt).input, subject, accumulatedValues, optional);
        if (nested === undefined) {
          return undefined;
        }
        union.push(...nested);
        continue;
      }
      const branch = createNormalizationState(accumulatedValues);
      const supported = path.type === Algebra.Types.SEQ ?
        handleSeqPath(path, branch, subject, object, optional) :
        path.type === Algebra.Types.INV && path.path.type === Algebra.Types.SEQ ?
          handleSeqPath(path.path, branch, object, subject, optional) :
          addPathStep(branch, subject, path, object, optional);
      if (!supported) {
        return undefined;
      }
      union.push(buildQuery(branch));
    }
    return union;
  }

  /**
   * Add the triple pattern of a one-step path to a normalization state.
   * @returns whether the path is one step
   */
  function addPathStep(state: INormalizationState, subject: Term, path: Algebra.Operation, object: Term, optional?: boolean): boolean {
    const step = pathStep(subject, path, object, optional);
    if (step === undefined) {
      return false;
    }
    addTriple(state.triples, step.subject, step.triple);
    return true;
  }

  /**
   * Flatten a sequence path into chained triples and nested unions when intermediate segments require
   * them. Each intermediate node is a blank node of its own.
   * @returns whether every step of the sequence is supported
   */
  function handleSeqPath(
    element: Algebra.Seq,
    state: INormalizationState,
    subject: Term,
    object: Term,
    optional?: boolean): boolean {
    const steps = element.input;
    const first = steps[0];
    const label = `${first.type === Algebra.Types.LINK ? first.iri.value : 'path'}_${subject.value}`;
    let currentObject: Term = object;

    for (let i = 0; i < steps.length; i++) {
      const path = steps[i];
      const currentSubject: Term = i === 0 ? subject : currentObject;
      currentObject = i === steps.length - 1 ? object : DF.blankNode(i === 0 ? label : `${label}_${i}`);

      if (path.type === Algebra.Types.ALT) {
        const union = handleAltPropertyPath(currentSubject, path.input, currentObject, state.values, optional);
        if (union === undefined) {
          return false;
        }
        state.unions.push(union);
      } else if (!addPathStep(state, currentSubject, path, currentObject, optional)) {
        return false;
      }
    }
    return true;
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
}
