import { Bindings, ContainmentType, IBindings, IDependentStarPattern } from './Binding'
import { TYPE_DEFINITION } from './constant';
import { generateStarPatternUnion, type IQuery } from './query';
import { IShape } from './Shape';
import type { IStarPatternWithDependencies, ITriple } from './Triple';

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
  const queryStarPattern: QueryStarPattern = new Map();

  const groupedShapes = groupShapeBydependencies(shapes);

  for (const [starPatternsName, starPatternWithDependencies] of query.starPatterns) {
    for (const { triple } of starPatternWithDependencies.starPattern.values()) {
      queryStarPattern.set(triple.toString(), triple);
    }
    starPatternsContainment.set(starPatternsName, { result: ContainmentResult.REJECTED, bindings: new Map() });
  }

  // dependent, origin 
  const nestedContainedStarPatterns = new Map<string, Map<string, IDependentStarPattern>>();

  for (const { shape, dependencies } of groupedShapes) {
    bindingResult.set(shape.name, new Map());
    const bindingResultofShape = bindingResult.get(shape.name)!;
    for (const [starPatternName, starPattern] of query.starPatterns) {
      const starPatternUnion = generateStarPatternUnion(query.union ?? [], starPatternName);
      const bindings = new Bindings(shape, starPattern, dependencies, starPatternUnion);
      const currentNestedStarPattern = bindings.getNestedContainedStarPatternName();
      for (const starPattern of currentNestedStarPattern) {
        const currentNestedContainedStarPatterns = nestedContainedStarPatterns.get(starPattern.starPattern);
        if (currentNestedContainedStarPatterns === undefined) {
          nestedContainedStarPatterns.set(starPattern.starPattern, new Map([[starPatternName, starPattern]]));
        } else {
          currentNestedContainedStarPatterns.set(starPatternName, starPattern);
        }
      }
      bindingResultofShape.set(starPatternName, { result: bindings, shape });
      for (const triple of bindings.getBoundTriple()) {
        queryStarPattern.set(triple.toString(), undefined);
      }
    }
  }

  for (const [shapeName, starPatternBinding] of bindingResult) {
    const currentShapeBindingResult = bindingResult.get(shapeName)!;
    for (const [starPatternName, bindingResult] of starPatternBinding) {
      const originOfDependency = nestedContainedStarPatterns.get(starPatternName);
      // validate that there are no cycles if there are cycles we analyse the star pattern independently
      for (const [origin, dependencyInfo] of originOfDependency ?? []) {
        if (!nestedContainedStarPatterns.has(origin)) {
          currentShapeBindingResult.set(starPatternName, { ...bindingResult, dependent: dependencyInfo });
          break;
        }
      }
    }
  }

  for (const starPatternBinding of bindingResult.values()) {
    for (const [starPatternName, result] of starPatternBinding) {
      if (result.dependent === undefined) {
        updateStarPatternContainment(starPatternsContainment, result.result, starPatternName, result.shape, groupedShapes, decidingShapes);
      } else {
        // check the shape contained related to the dependent star pattern
        const dependendShapes = [];
        for (const [shapeName, nestedBinding] of bindingResult) {
          const nestedResult = nestedBinding.get(starPatternName);
          if (nestedResult !== undefined) {
            if (nestedResult.result.isFullyBounded()) {
              dependendShapes.push(shapeName);
            }
          }
        }

        const constraintTarget = [];
        for (const nestedBinding of bindingResult.values()) {
          const originBinding = nestedBinding.get(result.dependent.origin);
          if (originBinding !== undefined) {
            const constraintShape = originBinding.result.getNestedContainedStarPatternNameShapesContained().get(starPatternName);
            if (constraintShape !== undefined) {
              constraintTarget.push(constraintShape);
            }
          }
        }
        // we check if there is less shapes contained than the constraint of the dependency
        const target = constraintTarget.length >= dependendShapes.length
          || constraintTarget.length === 0
          ? dependendShapes : result.dependent.shape;

        starPatternsContainment.set(starPatternName, { result: ContainmentResult.DEPEND, target: target?.length === 0 ? undefined : target, bindings: new Map() });
      }
    }
  }

  return {
    starPatternsContainment,
    visitShapeBoundedResource: generateVisitStatus(bindingResult, shapes)
  };

}

function updateStarPatternContainment(starPatternsContainment: Map<ShapeName, IContainmentResult>, bindings: IBindings, starPatternName: StarPatternName, shape: IShape, groupedShapes: IShapeWithDependencies[], decidingShapes?: Set<string>): void {
  const prevContainmentResult = starPatternsContainment.get(starPatternName)!;

  if (bindings.shouldVisitShape() && bindings.getUnboundedTriple().length > 0 && prevContainmentResult.result !== ContainmentResult.CONTAIN && prevContainmentResult.result !== ContainmentResult.PARTIALY_CONTAIN) {
    starPatternsContainment.set(starPatternName, {
      result: ContainmentResult.ALIGNED,
      target: (prevContainmentResult.target ?? []).concat(shape.name),
      bindings: prevContainmentResult.bindings.set(shape.name, bindings)
    });

  }
  if (bindings.shouldVisitShape() && bindings.isFullyBounded()) {
    if (bindings.containmentType().result === ContainmentType.FULL) {
      starPatternsContainment.set(starPatternName, {
        result: ContainmentResult.CONTAIN,
        target: prevContainmentResult.result === ContainmentResult.ALIGNED ? [shape.name] :
          (prevContainmentResult.target ?? []).concat(shape.name),
          bindings: prevContainmentResult.bindings.set(shape.name, bindings)
      });
    }
    if (bindings.containmentType().result === ContainmentType.PARTIAL) {
      const unContaineStarPattern = bindings.containmentType().unContaineStarPattern!;
      const hasDisjuncContainment = findDisjunctContainment(unContaineStarPattern, groupedShapes, shape, decidingShapes);
      if (hasDisjuncContainment) {
        starPatternsContainment.set(starPatternName, {
          result: ContainmentResult.CONTAIN,
          target: prevContainmentResult.result === ContainmentResult.ALIGNED ? [shape.name] :
            (prevContainmentResult.target ?? []).concat(shape.name),
          bindings: prevContainmentResult.bindings.set(shape.name, bindings)
        });
      } else {
        starPatternsContainment.set(starPatternName, {
          result: ContainmentResult.PARTIALY_CONTAIN,
          target: prevContainmentResult.result === ContainmentResult.ALIGNED ? [shape.name] :
            (prevContainmentResult.target ?? []).concat(shape.name),
          bindings: prevContainmentResult.bindings.set(shape.name, bindings)
        });
      }
    }
  }
}
/**
 * Check if there is a disjunction. IMPORTANT!! Do not consider nested disjunction.
 * @param {IStarPatternWithDependencies[]} starPatterns 
 * @param {IShapeWithDependencies[]} groupedShapes 
 * @param {IShape} shapeExcluded
 * @returns Whether the disjunction is contained into a shape
 */
function findDisjunctContainment(starPatterns: IStarPatternWithDependencies[], groupedShapes: IShapeWithDependencies[], shapeExcluded: IShape, decidingShapes?: Set<string>): boolean {
  let haveContainment = false;
  for (const starPattern of starPatterns) {
    for (const { shape, dependencies } of groupedShapes) {
      if (shape.name !== shapeExcluded.name && (decidingShapes === undefined || decidingShapes?.has(shape.name))) {
        const bindings = new Bindings(shape, starPattern, dependencies);
        haveContainment = haveContainment || bindings.isFullyBounded();
      }
    }
  }
  return haveContainment;
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
  dependent?: IDependentStarPattern;
}

interface IShapeWithDependencies {
  shape: IShape;
  dependencies: Map<string, IShape>;
}

export type StarPatternName = string;
type QueryStarPattern = Map<string, ITriple | undefined>;

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
  // Is subsum
  CONTAIN,
  // One union statement is subsum
  PARTIALY_CONTAIN,
  // Has at least one binding
  ALIGNED,
  // Is a dependency of a subsuming star pattern
  DEPEND,
  // Has no binding
  REJECTED,
}
