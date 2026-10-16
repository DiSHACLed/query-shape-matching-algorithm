import { Bindings, ContainmentType, IBindings } from './Binding'
import { generateStarPatternUnion, type IQuery, type UnsupportedConstruct } from './query';
import { shapeToQuery } from './shapeToQuery';
import type { IShape } from './Shape';
import type { IStarPatternWithDependencies } from './Triple';
import { describesStarPattern, incomingRequiredPredicates } from './target';
import { evaluateFiltersForShape, FilterTruth } from './filter-compatibility';

/**
 * Determine if a query is contained inside a shape.
 * It provides detailed information about the containment and whether or not
 * the documents linked with the shape should be followed.
 * @param param {IContainementArg} - the shape and the query to evaluate
 * @returns {IResult} result relative to the containement of the query inside of the shape
 */
export function solveShapeQueryContainment({ query, shapes, dependentShapes, decidingShapes }: IContainementArg): IResult {
  if (decidingShapes !== undefined) {
    // Role filtering selects the candidates; it does not hide shapes from sh:node resolution. A shape
    // outside `decidingShapes` is therefore only a dependency: it still resolves the references of the
    // candidates, but neither decides a star pattern, nor lends evidence through references of its own,
    // nor receives a visit indication.
    return solveShapeQueryContainment({
      query,
      shapes: shapes.filter(shape => decidingShapes.has(shape.name)),
      dependentShapes: (dependentShapes ?? []).concat(shapes.filter(shape => !decidingShapes.has(shape.name))),
    });
  }
  if (query.starPatterns.size === 0) {
    // A query whose only triple patterns are unrestricted (?s ?p ?o) asks for every triple of the
    // resource, so every resource is relevant and every shape is worth visiting. That is a real
    // answer, not a failure: the query is maximally unselective, which is a property of the query.
    if (query.matchesAnyTriple === true) {
      return buildMatchesAnyTripleResult(shapes, query.unsupported);
    }
    // A query with no triple pattern at all (an empty WHERE, VALUES/FILTER only, or a body made
    // solely of discarded constructs) never asks the resource for data, so relevance is undefined.
    throw new EmptyQueryError(
      'the normalized query has no triple pattern, so no relevance degree can be assigned' +
      (query.unsupported !== undefined ? `; discarded constructs: ${query.unsupported.join(', ')}` : ''),
    );
  }
  const bindingResult = new Map<ShapeName, Map<StarPatternName, IBindingStatus>>();
  const starPatternsContainment = new Map<StarPatternName, IContainmentResult>();
  const classificationStats = new Map<StarPatternName, IContainmentStats>();

  const groupedShapes = groupShapeBydependencies(shapes, dependentShapes);

  // Initialize per-star-pattern classification state.
  for (const [starPatternsName] of query.starPatterns) {
    starPatternsContainment.set(starPatternsName, { result: ContainmentResult.REJECTED, bindings: new Map() });
    classificationStats.set(starPatternsName, {
      hasOpenShape: false,
      hasClosedShape: false,
      hasUndescribedShape: false,
      rootTargetsOpen: new Set<string>(),
      rootTargetsClosed: new Set<string>(),
      containedTargets: new Set<string>(),
      bindings: new Map<string, IBindings>()
    });
  }

  // Evaluate each star pattern against each candidate shape.
  const incoming = incomingRequiredPredicates(query.starPatterns);
  for (const { shape, dependencies } of groupedShapes) {
    bindingResult.set(shape.name, new Map());
    const bindingResultofShape = bindingResult.get(shape.name)!;
    for (const [starPatternName, starPattern] of query.starPatterns) {
      const starPatternUnion = generateStarPatternUnion(query.union ?? [], starPatternName);
      const bindings = new Bindings(shape, starPattern, dependencies, starPatternUnion);
      const filterCompatibility = evaluateFiltersForShape(query.filters, starPattern, shape);
      bindingResultofShape.set(starPatternName, { result: bindings, shape });
      const describes = describesStarPattern(shape, starPattern, incoming);
      updateContainmentStats(classificationStats, starPatternName, shape, bindings, groupedShapes, filterCompatibility !== FilterTruth.FALSE, describes);
    }
  }

  // A shape reached only as an sh:node target is not a candidate, but it is the shape that governs
  // the nested star pattern it resolves. Classify that pattern against it, so a nested pattern is
  // neither rejected on the strength of shapes that never described it, nor left rejected while
  // the shape that does describe it binds the pattern completely. Only candidates have bindings here,
  // so the evidence covers exactly the references reached from a candidate: a shape excluded by
  // `decidingShapes` still governs the patterns a candidate resolves through it, but its own
  // references lend no evidence.
  for (const starPatternBindings of bindingResult.values()) {
    for (const { result } of starPatternBindings.values()) {
      for (const evidence of result.getDependencyEvidence()) {
        const stats = classificationStats.get(evidence.starPatternName);
        if (stats === undefined) {
          continue;
        }
        // As for a candidate shape, a contradiction is evidence of incompatibility: the referenced
        // shape counts as closed and contributes no match.
        const contradicts = evidence.bindings.hasNegativeContradiction();
        if (evidence.closed || contradicts) {
          stats.hasClosedShape = true;
        } else {
          stats.hasOpenShape = true;
        }
        if (contradicts) {
          continue;
        }
        if (evidence.contained) {
          stats.containedTargets.add(evidence.shapeName);
        }
        if (evidence.hasMatch || evidence.contained) {
          stats.bindings.set(evidence.shapeName, evidence.bindings);
          if (evidence.closed) {
            stats.rootTargetsClosed.add(evidence.shapeName);
          } else {
            stats.rootTargetsOpen.add(evidence.shapeName);
          }
        }
      }
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
        // Rejection needs a shape that describes the star pattern and excludes it. Without any shape
        // describing it, while the resource has shapes, nothing is known about the pattern.
        const weaklyRejected = stats.hasOpenShape || (!stats.hasClosedShape && stats.hasUndescribedShape);
        const rejectedResult = weaklyRejected ? ContainmentResult.WEAKLY_REJECTED : ContainmentResult.REJECTED;
        currentResult = { result: rejectedResult, bindings: new Map() };
      }
    }

    starPatternsContainment.set(starPatternName, currentResult);
  }

  const report: Omit<IResult, 'result'> = {
    starPatternsContainment,
    visitShapeBoundedResource: generateVisitStatus(bindingResult, shapes),
    ...(query.unsupported !== undefined ? { unsupported: query.unsupported } : {}),
  };

  Object.defineProperty(report, 'result', {
    value: getQueryContainmentResult(starPatternsContainment),
    enumerable: false,
    writable: false,
  });

  return report as IResult;

}

/**
 * Report for a query that asks for every triple of a resource: contained by any shape, and every
 * shape is visitable. Marking the shapes visitable matters — a CONTAINED result whose visit
 * indications were all false would tell a client to fetch nothing for a query that wants everything.
 */
function buildMatchesAnyTripleResult(shapes: IShape[], unsupported?: UnsupportedConstruct[]): IResult {
  const report: Omit<IResult, 'result'> = {
    starPatternsContainment: new Map(),
    visitShapeBoundedResource: new Map(shapes.map(shape => [shape.name, true])),
    ...(unsupported !== undefined ? { unsupported } : {}),
  };

  Object.defineProperty(report, 'result', {
    value: ContainmentResult.CONTAINED,
    enumerable: false,
    writable: false,
  });

  return report as IResult;
}

export interface IShapeContainmentArg {
  sourceShape: IShape;
  sourceLinkedShapes?: IShape[] | Map<string, IShape>;
  targetShapes: IShape[];
  decidingShapes?: Set<string>;
}

/**
 * Convenience wrapper to compare a source shape against candidate target shapes.
 *
 * Internally this translates the source shape into a best-effort query and then
 * delegates to the standard query-to-shape containment solver.
 */
export function solveShapeShapeContainment({ sourceShape, sourceLinkedShapes, targetShapes, decidingShapes }: IShapeContainmentArg): IResult {
  const query = shapeToQuery(sourceShape, { linkedShapes: sourceLinkedShapes });
  return solveShapeQueryContainment({ query, shapes: targetShapes, decidingShapes });
}

function updateContainmentStats(
  classificationStats: Map<StarPatternName, IContainmentStats>,
  starPatternName: StarPatternName,
  shape: IShape,
  bindings: IBindings,
  groupedShapes: IShapeWithDependencies[],
  filterCompatible = true,
  describes = true,
): void {
  const stats = classificationStats.get(starPatternName)!;
  // A shape with targets only constrains the nodes of its targets. When the nodes matching the star
  // pattern need not be among them, its closedness and negative constraints say nothing about those
  // nodes: it neither supports nor softens a rejection, and its matches count as on an open shape.
  const closed = describes && shape.closed;
  // A shape that explicitly forbids a required predicate (sh:not) proves incompatibility, so it
  // must not count as the "open shape" that would soften REJECTED into WEAKLY_REJECTED.
  const contradicts = describes && bindings.hasNegativeContradiction();
  if (!describes) {
    stats.hasUndescribedShape = true;
  } else if (closed || contradicts) {
    stats.hasClosedShape = true;
  } else {
    stats.hasOpenShape = true;
  }

  if (!filterCompatible || contradicts) {
    return;
  }

  // Track root-level alignment independently from full containment. A predicate whose sh:node
  // dependency was neither established nor refuted still matched this shape, so it counts here:
  // otherwise a root pattern the shape does declare would be reported as no match at all.
  const hasRootMatch = bindings.getBoundTriple().length > 0 || bindings.hasNonRefutedDependency();
  if (hasRootMatch) {
    stats.bindings.set(shape.name, bindings);
    if (closed) {
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
  // when unresolved alternatives are contained by another candidate shape.
  if (bindings.isFullyBounded() && bindings.containmentType().result === ContainmentType.PARTIAL) {
    const unContaineStarPattern = bindings.containmentType().unContaineStarPattern!;
    const hasDisjuncContainment = findDisjunctContainment(unContaineStarPattern, groupedShapes, shape);
    if (hasDisjuncContainment) {
      stats.bindings.set(shape.name, bindings);
      stats.containedTargets.add(shape.name);
    }
  }
}

function findDisjunctContainment(starPatterns: IStarPatternWithDependencies[], groupedShapes: IShapeWithDependencies[], shapeExcluded: IShape): boolean {
  // Search whether unresolved disjunctive branches can be absorbed by another shape.
  let haveContainment = false;
  for (const starPattern of starPatterns) {
    for (const { shape, dependencies } of groupedShapes) {
      if (shape.name !== shapeExcluded.name) {
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
  // an open shape describes the star pattern
  hasOpenShape: boolean;
  // a closed or contradicting shape describes the star pattern
  hasClosedShape: boolean;
  // a shape with targets does not describe the star pattern
  hasUndescribedShape: boolean;
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
  // names of the shapes in `shapes` that are candidates; the others only resolve sh:node references
  decidingShapes?: Set<string>;
}


export type ShapeName = string;

/**
 * The result of the alignment
 */
export interface IResult {
  // The aggregate containment result for the complete query or source shape.
  result: ContainmentResult;
  // The documents associated with a shape that can be followed
  visitShapeBoundedResource: Map<ShapeName, boolean>;
  // The type of containment of each star patterns with there associated shapes
  starPatternsContainment: Map<StarPatternName, IContainmentResult>;
  /**
   * Constructs of the input that were discarded because they are outside the supported profile.
   * When non-empty, the result was computed over a sub-query of the given query and therefore
   * over-estimates relevance.
   */
  unsupported?: UnsupportedConstruct[];
}

/**
 * Raised when the normalized input has no star pattern, so there is no constraint to assess.
 * Returning a relevance degree in that case would rank every resource on no evidence at all.
 */
export class EmptyQueryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'EmptyQueryError';
  }
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

function getQueryContainmentResult(
  starPatternsContainment: Map<StarPatternName, IContainmentResult>,
): ContainmentResult {
  let queryResult = ContainmentResult.CONTAINED;

  for (const { result } of starPatternsContainment.values()) {
    queryResult = Math.max(queryResult, result);
  }

  return queryResult;
}
