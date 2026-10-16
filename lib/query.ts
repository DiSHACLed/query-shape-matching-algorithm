import type { Term } from '@rdfjs/types';
import { algebraUtils, Algebra } from '@traqula/algebra-transformations-1-1';
import { DataFactory } from 'rdf-data-factory';
import { ITripleWithDependencies, Triple, type IStarPatternWithDependencies, ITriple } from './Triple';
import type { ICardinality } from './Shape';
import { getNegatedExistenceInput, type INegatedPattern, reportExistence, toNegatedPattern } from './negation';

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
 * `TARGETS` reports the targets of an input shape that could not be translated: node or objects-of
 * targets combined with other targets, or several objects-of targets. They are ignored.
 */
export type UnsupportedConstruct = 'MINUS' | 'SERVICE' | 'EXISTS' | 'NOT EXISTS' | 'TARGETS';

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
 * @todo add support for the bind operator
 */
export function generateQuery(algebraQuery: Algebra.Operation, optional?: boolean): IQuery {
  const state = createNormalizationState();
  QueryHandler.collectFromAlgebra(algebraQuery, state, optional);
  return buildQuery(state);
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
      },
    );
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
   * Dispatch property-path parsing to direct, cardinality, negated-set, or alternative handlers.
   */
  function handlePropertyPath(state: INormalizationState, optional?: boolean): (element: Algebra.Path) => void {
    return (element: Algebra.Path): void => {
      const path = element.predicate.type;
      if (element.predicate.type === Algebra.Types.ALT) {
        state.unions.push(
          handleAltPropertyPath(
            element.subject,
            element.predicate.input,
            element.object,
            state.values,
            optional
          )
        );
      } else if (isCardinalityPropertyPath(element.predicate)) {
        const triple = handleCardinalityPropertyPath(element as CardinalityPath, optional);
        handleDirectPropertyPath(element, state.triples, triple);
      } else if (path === Algebra.Types.NPS) {
        const triple = handleNegatedPropertySet(element as NpsPath, optional);
        handleDirectPropertyPath(element, state.triples, triple);
      }
    };
  }

  /**
   * Convert a SPARQL UNION into a list of independently generated query branches.
   */
  function handleUnion(state: INormalizationState, optional?: boolean): (element: Algebra.Union) => void {
    return (element: Algebra.Union): void => {
      const branches: Algebra.Operation[] = element.input;
      const currentUnion: IQuery[] = [];
      for (const branch of branches) {
        const branchQuery = generateQuery(branch, optional);
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
      const startPattern = state.triples.get(subject.value);
      const triple: ITriple = new Triple({
        subject: subject.value,
        predicate: quad.predicate.value,
        object,
        isOptional: optional
      });
      if (startPattern === undefined) {
        state.triples.set(subject.value,
          { triples: new Map([[triple.toString(), triple]]), isVariable: isVariableTerm(subject) });
      } else {
        startPattern.triples.set(triple.toString(), triple);
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
        isVariable: isVariableTerm(subject)
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
    state: INormalizationState,
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
        handleLink(path, state.triples, currentSubject, currentObject, undefined, optional);
      } else if (path.type === Algebra.Types.NPS) {
        handleNegatedPropertyLink(path, state.triples, currentSubject, currentObject, optional)
      } else if (path.type === Algebra.Types.ALT) {
        state.unions.push(handleAltPropertyPath(currentSubject, path.input, currentObject, state.values, optional));
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
    const branch = createNormalizationState(accumulatedValues);
    handleSeqPath(element, branch, subject, object, optional);
    return buildQuery(branch);
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
        isVariable: isVariableTerm(subject)
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
    const branch = createNormalizationState(accumulatedValues);
    handleLink(element, branch.triples, subject, object, cardinality, optional);
    return buildQuery(branch);
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
        isVariable: isVariableTerm(subject)
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
    const branch = createNormalizationState(accumulatedValues);
    handleNegatedPropertyLink(element, branch.triples, subject, object, optional);
    return buildQuery(branch);
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
      isVariable: isVariableTerm(subject)
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
