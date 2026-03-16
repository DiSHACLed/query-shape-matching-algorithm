import type { Term } from '@rdfjs/types';
import { algebraUtils, Algebra } from '@traqula/algebra-transformations-1-1';
import { ITripleWithDependencies, Triple, type IStarPatternWithDependencies, ITriple } from './Triple';
import { ICardinality } from './Shape';
import { DF } from './constant';

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

/**
 * A query divided into star patterns
 */
export interface IQuery {
  // star patterns indexed by subject
  starPatterns: Map<string, IStarPatternWithDependencies>;
  union?: IQuery[][];
  filterExpression?: string;
}

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

  QueryHandler.collectFromAlgebra(algebraQuery, accumulatedTriples, accumulatedValues, accumulatedUnion, optional);

  return buildQuery(accumulatedTriples, accumulatedValues, accumulatedUnion);
}

function buildQuery(
  tripleArgs: Map<string, IAccumulatedTriples>,
  values: Map<string, Term[]>,
  accumulatedUnion: IQuery[][]
): IQuery {
  const innerQuery = new Map<string, IStarPatternWithDependencies>();
  const resp: IQuery = { starPatterns: innerQuery, filterExpression: "" };
  if (accumulatedUnion.length > 0) {
    resp.union = accumulatedUnion;
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
  addUnionDependencies(resp)
  return resp;
}

// could be made so that when adding a union we make sure to find the dependency
// function should be revisited
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

  export function collectFromAlgebra(
    rootAlgebra: Algebra.Operation,
    accumulatedTriples: Map<string, IAccumulatedTriples>,
    accumulatedValues: Map<string, Term[]>,
    accumulatedUnion: IQuery[][],
    optional?: boolean
  ): void {
    algebraUtils.visitOperation(
      rootAlgebra,
      {
        [Algebra.Types.PATTERN]: {
          preVisitor: () => ({ continue: false }),
          visitor: handlePattern(accumulatedTriples, optional),
        },
        [Algebra.Types.VALUES]: {
          preVisitor: () => ({ continue: false }),
          visitor: handleValues(accumulatedValues),
        },
        [Algebra.Types.UNION]: {
          preVisitor: () => ({ continue: false }),
          visitor: handleUnion(accumulatedUnion, optional),
        },
        [Algebra.Types.LEFT_JOIN]: {
          preVisitor: () => ({ continue: false }),
          visitor: handleLeftJoin(accumulatedTriples, accumulatedValues, accumulatedUnion),
        },
        [Algebra.Types.PATH]: {
          preVisitor: () => ({ continue: false }),
          visitor: handlePropertyPath(accumulatedTriples, accumulatedUnion, accumulatedValues, optional),
        },
        [Algebra.Types.FILTER]: {
          // Ignore the expression subtree for now (e.g. FILTER NOT EXISTS) to avoid collecting
          // inner patterns that belong to the filter condition, not the query body.
          preVisitor: () => ({ ignoreKeys: new Set(['expression']) }),
        },
      },
    );
  }

  function handleLeftJoin(accumulatedTriples: Map<string, IAccumulatedTriples>,
    accumulatedValues: Map<string, Term[]>,
    accumulatedUnion: IQuery[][]): (element: Algebra.LeftJoin) => void {
    return (element: Algebra.LeftJoin): void => {
      const joinElement = element.input;
      const requiredElements = joinElement[0];
      const optionalElements = joinElement[1];

      collectFromAlgebra(requiredElements, accumulatedTriples, accumulatedValues, accumulatedUnion);
      collectFromAlgebra(optionalElements, accumulatedTriples, accumulatedValues, accumulatedUnion, true);
    }
  }

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

  function handleUnion(accumulatedUnion: IQuery[][], optional?: boolean): (element: Algebra.Union) => void {
    return (element: Algebra.Union): void => {
      const branches: Algebra.Operation[] = element.input;
      const currentUnion: IQuery[] = [];
      for (const branch of branches) {
        currentUnion.push(generateQuery(branch, optional))
      }
      accumulatedUnion.push(currentUnion);
    };
  }

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

  function handlePattern(
    accumulatedTriples: Map<string, IAccumulatedTriples>,
    optional?: boolean
  ): (element: Algebra.Pattern) => void {
    return (quad: Algebra.Pattern): void => {
      const subject = quad.subject as Term;
      const predicate = quad.predicate as Term;
      const object = quad.object as Term;
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

  // Type guard to check if an Operation is a cardinality property path
  function isCardinalityPropertyPath(operation: Algebra.Operation): operation is CardinalityPropertyPathSymbol {
    return operation.type === Algebra.Types.ZERO_OR_MORE_PATH ||
      operation.type === Algebra.Types.ZERO_OR_ONE_PATH ||
      operation.type === Algebra.Types.ONE_OR_MORE_PATH;
  }
}
