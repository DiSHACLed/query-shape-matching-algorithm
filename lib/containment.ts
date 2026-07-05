import { Bindings, ContainmentType, IBindings } from './Binding'
import { generateStarPatternUnion, type IQuery } from './query';
import { IShape } from './Shape';
import type { IStarPatternWithDependencies } from './Triple';

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
      bindingResultofShape.set(starPatternName, { result: bindings, shape });
      updateContainmentStats(classificationStats, starPatternName, shape, bindings, groupedShapes, decidingShapes);
    }
  }

  for (const [starPatternName, starPattern] of query.starPatterns) {
    const stats = classificationStats.get(starPatternName)!;
    const rootTargetsOpen = Array.from(stats.rootTargetsOpen);
    const rootTargetsClosed = Array.from(stats.rootTargetsClosed);
    const containedTargets = Array.from(stats.containedTargets);
    const nestedTargets = Array.from(getNestedMatchingTargets(starPattern, classificationStats));

    if (containedTargets.length > 0) {
      starPatternsContainment.set(starPatternName, { result: ContainmentResult.CONTAINED, target: containedTargets, bindings: new Map(stats.bindings) });
      continue;
    }

    if (rootTargetsOpen.length > 0) {
      starPatternsContainment.set(starPatternName, { result: ContainmentResult.ALIGNED, target: rootTargetsOpen, bindings: new Map(stats.bindings) });
      continue;
    }

    const unalignedTargets = Array.from(new Set(rootTargetsClosed.concat(nestedTargets)));
    if (unalignedTargets.length > 0) {
      const bindings = rootTargetsClosed.length > 0 ? new Map(stats.bindings) : new Map();
      starPatternsContainment.set(starPatternName, { result: ContainmentResult.UNALINGED, target: unalignedTargets, bindings });
      continue;
    }

    const rejectedResult = stats.hasOpenShape ? ContainmentResult.WEAKLY_REJECTED : ContainmentResult.REJECTED;
    starPatternsContainment.set(starPatternName, { result: rejectedResult, bindings: new Map() });
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
