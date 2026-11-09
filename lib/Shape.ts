import { RDF } from './constant';
import type { UnsupportedConstruct } from './query';

/**
 * A shape interface
 */
export interface IShape extends IShapeObj {
  /**
   * Convert a shape to an object
   * @returns {IShapeObj}
   */
  toObject: () => IShapeObj;
  /**
   * convert to a JSON object
   */
  toJson: () => IShapeJson;
  /**
   * Get the information about a predicate
   * @param {string} predicate - the predicate
   * @returns {IPredicate | undefined} - the information about the predicate or undefined if it is not in the shape
   */
  get: (predicate: string) => IPredicate | undefined;
  /**
   * Get all the predicates with all their information
   * @returns {IPredicate[]} - all the predicates with extra information
   */
  getAll: () => IPredicate[];
  /**
   * get the IRIs of the shape necessary for the constraint
   * @returns {Set<string>} - IRIs of the shape necessary for the constraint
   */
  getLinkedShapeIri: () => Set<string>;
  // A shape always has the fields that its serialized form leaves out when they are empty
  negativePredicates: string[];
  oneOf: OneOf[];
  oneOfIndexed: OneOfIndexed[];
  targets: IShapeTargets;
  ignoredProperties: string[];
  unsupported: UnsupportedConstruct[];
}

/**
 * A predicate
 */
export interface IPredicate {
  name: string;
  constraint?: IConstraint;
  cardinality?: ICardinality;
  negative?: boolean;
  optional?: boolean;
}

function toJsonPredicate(predicate: IPredicate): IPredicateJson {
  return {
    ...predicate,
    constraint: predicate.constraint !== undefined ? toJsonConstraint(predicate.constraint) : undefined
  }
}

export type IPredicateJson = Omit<IPredicate, "constraint"> & {
  constraint?: IConstraintJson;
}

/**
 * The numeric and string facets that restrict the literal values of a datatype constraint
 */
export interface IConstraintFacets {
  minInclusive?: number;
  maxInclusive?: number;
  minExclusive?: number;
  maxExclusive?: number;
  pattern?: string;
  flags?: string;
}

const FACET_KEYS: (keyof IConstraintFacets)[] = [
  'minInclusive',
  'maxInclusive',
  'minExclusive',
  'maxExclusive',
  'pattern',
  'flags',
];

/**
 * A constraint
 */
export interface IConstraint extends IConstraintFacets {
  value: Set<string>;
  type: ConstraintType;
}

function toJsonConstraint(constraint: IConstraint): IConstraintJson {
  return {
    ...constraint,
    value: Array.from(constraint.value)
  }
}

export type IConstraintJson = Omit<IConstraint, "value"> & {
  value: string[]
};

/**
 * A cardinality
 */
export interface ICardinality {
  min: number;
  // If the value is -1 then there is no limit
  max: number;
}

export type IShapeJson = Omit<IShapeObj, "positivePredicates" | "negativePredicates" | "oneOf" | "oneOfIndexed"> & {
  positivePredicates: IPredicateJson[];
  negativePredicates: IPredicateJson[];
  oneOf: OneOfJson[];
}
/**
 * A constraint type
 */
export const enum ConstraintType {
  // Is bound to another shape
  SHAPE,
  // The value is one of the IRIs, compared by IRI: the class of rdf:type that a class target implies,
  // or a ShEx value set on rdf:type
  CLASS,
  // Is bound by a literal datatype IRI
  DATATYPE,
  // The value is a SHACL instance of the class (sh:class), which only the data decides
  INSTANCE,
}
/**
 * The SHACL targets of a shape: the nodes it describes when it is used on its own. SHACL ignores
 * them when the shape is reached through `sh:node`. A shape with no target at all is treated as
 * describing any node.
 */
export interface IShapeTargets {
  // sh:targetNode values, as keys made by nodeTargetKey: an IRI is its value
  nodes: string[];
  // sh:targetClass values, and the shape itself when it is also an rdfs:Class (implicit class target)
  classes: string[];
  // sh:targetSubjectsOf values
  subjectsOf: string[];
  // sh:targetObjectsOf values
  objectsOf: string[];
}

/**
 * A simple Shape object
 */
export interface IShapeObj {
  name: string;
  closed: boolean;
  positivePredicates: string[];
  negativePredicates?: string[];
  oneOf?: OneOf[];
  // only present when the shape declares at least one target
  targets?: IShapeTargets;
  // sh:ignoredProperties of a closed shape; only present when there is at least one
  ignoredProperties?: string[];
  // constructs of the shapes graph the shape could not represent; only present when there is one
  unsupported?: UnsupportedConstruct[];
}

/**
 * The argument to generate a {Shape} instance
 */
export interface IShapeArgs {
  name: string;
  positivePredicates: (IPredicate | string)[];
  negativePredicates?: (IPredicate | string)[];
  linkedShapeIri?: string[]
  closed?: boolean;
  oneOf?: OneOf[];
  targets?: Partial<IShapeTargets>;
  ignoredProperties?: string[];
  unsupported?: UnsupportedConstruct[];
}

export type OneOf = OneOfPath[];
export type OneOfJson = OneOfPathJson[];
export type OneOfPath = IPredicate[];
export type OneOfPathJson = IPredicateJson[];

export type OneOfPathIndexedJson = Record<string, IPredicateJson>;
export type OneOfPathIndexed = Map<string, IPredicate>;
export type OneOfIndexed = OneOfPathIndexed[];
export type OneOfIndexedJson = OneOfPathIndexedJson[];

function toOneOfJson(oneOf: OneOf): OneOfJson {
  const oneOfJson: OneOfJson = [];
  for (const oneOfPath of oneOf) {
    const oneofPathJson: OneOfPathJson = [];
    for (const predicate of oneOfPath) {
      oneofPathJson.push(toJsonPredicate(predicate))
    }
    oneOfJson.push(oneofPathJson);
  }
  return oneOfJson;
}

/**
 * A shape
 */
export class Shape implements IShape {
  public readonly name: string;
  public readonly positivePredicates: string[];
  public readonly negativePredicates: string[];
  public readonly closed: boolean;
  public readonly linkedShapeIri: Set<string>;
  // All the predicate with extra information
  private readonly predicates = new Map<string, IPredicate>();
  public readonly oneOf: OneOf[];
  public readonly oneOfIndexed: OneOfIndexed[] = [];
  public readonly targets: IShapeTargets;
  public readonly ignoredProperties: string[];
  public readonly unsupported: UnsupportedConstruct[];

  /**
   *
   * @param {IShapeArgs} args - The argument to build a shape
   */
  public constructor({ name, positivePredicates, negativePredicates, closed, oneOf, targets, ignoredProperties, unsupported }: IShapeArgs) {
    this.name = name;
    this.closed = closed ?? false;
    this.oneOf = oneOf ? oneOf : [];
    this.targets = {
      nodes: [...targets?.nodes ?? []],
      classes: [...targets?.classes ?? []],
      subjectsOf: [...targets?.subjectsOf ?? []],
      objectsOf: [...targets?.objectsOf ?? []],
    };
    this.ignoredProperties = [...ignoredProperties ?? []];
    this.unsupported = [...new Set(unsupported)];
    const linkedShapeIri = new Set<string>();
    for (const oneOf of this.oneOf) {
      const currentOneOf: OneOfIndexed = [];
      for (const oneOfPath of oneOf) {
        const currentOneOfPath: OneOfPathIndexed = new Map(oneOfPath.map((predicate) => [predicate.name, predicate]));
        currentOneOf.push(currentOneOfPath);
      }
      this.oneOfIndexed?.push(currentOneOf);
    }

    this.positivePredicates = positivePredicates.map(val => {
      if (typeof val === 'string') {
        return val;
      }
      return val.name;
    });
    this.negativePredicates = negativePredicates === undefined ?
      [] :
      negativePredicates.map(val => {
        if (typeof val === 'string') {
          return val;
        }
        return val.name;
      });

    this.validatePredicates();

    for (const predicate of positivePredicates) {
      if (typeof predicate === 'string') {
        this.predicates.set(predicate, { name: predicate });
      } else {
        if (predicate.constraint !== undefined && predicate?.constraint.type === ConstraintType.SHAPE) {
          for (const value of predicate.constraint.value) {
            if (value !== name) {
              linkedShapeIri.add(value);
            }
          }
        }
        this.predicates.set(predicate.name,
          {
            ...predicate,
            optional: predicate?.cardinality?.min === 0,
          });
      }
    }

    for (const paths of this.oneOf) {
      for (const path of paths) {
        for (const predicate of path) {
          if (predicate.constraint !== undefined && predicate?.constraint.type === ConstraintType.SHAPE) {
            for (const value of predicate.constraint.value) {
              if (value !== name) {
                linkedShapeIri.add(value);
              }
            }
          }
        }
      }
    }

    this.linkedShapeIri = linkedShapeIri;

    for (const predicate of negativePredicates ?? []) {
      if (typeof predicate === 'string') {
        this.predicates.set(predicate, { name: predicate, negative: true });
      } else {
        this.predicates.set(predicate.name, { ...predicate, negative: true });
      }
    }

    Object.freeze(this.name);
    Object.freeze(this.positivePredicates);
    Object.freeze(this.negativePredicates);
    Object.freeze(this.predicates);
    Object.freeze(this.closed);
    Object.freeze(this.oneOf);
    Object.freeze(this.oneOfIndexed);
    for (const values of Object.values(this.targets)) {
      Object.freeze(values);
    }
    Object.freeze(this.targets);
    Object.freeze(this.ignoredProperties);
    Object.freeze(this.unsupported);
    Object.freeze(this);
  }

  /**
   * Validate if the shape don't have inconsistencies with the positive and negative properties
   * @throws {InconsistentPositiveAndNegativePredicateError}
   */
  private validatePredicates(): void {
    const setNegativePredicates = new Set(this.negativePredicates);
    for (const predicate of this.positivePredicates) {
      if (setNegativePredicates.has(predicate)) {
        throw new InconsistentPositiveAndNegativePredicateError(
          `the predicate ${predicate} is defined in the positive and the negative property`,
        );
      }
    }
  }

  public toObject(): IShapeObj {
    const obj: IShapeObj = {
      name: this.name,
      closed: this.closed,
      positivePredicates: this.positivePredicates,
      negativePredicates: this.negativePredicates,
      oneOf: this.oneOf
    };
    if (declaresTargets(this.targets)) {
      obj.targets = this.targets;
    }
    if (this.ignoredProperties.length > 0) {
      obj.ignoredProperties = this.ignoredProperties;
    }
    if (this.unsupported.length > 0) {
      obj.unsupported = this.unsupported;
    }
    return obj;
  }

  public toJson():  IShapeJson{
    const obj = this.toObject();
    const positivePredicates: IPredicateJson[] = [];
    const negativePredicates: IPredicateJson[] = [];

    for (const predicate of this.positivePredicates) {
      const detailedPredicate = this.predicates.get(predicate);
      if (detailedPredicate !== undefined) {
        const jsonDetailPredicate = toJsonPredicate(detailedPredicate)
        positivePredicates.push(jsonDetailPredicate);
      }
    }

    for (const predicate of this.negativePredicates) {
      const detailedPredicate = this.predicates.get(predicate);
      if (detailedPredicate !== undefined) {
        const jsonDetailPredicate = toJsonPredicate(detailedPredicate)
        negativePredicates.push(jsonDetailPredicate);
      }
    }

    const oneOfs: OneOfJson[] = [];
    for (const oneOfobj of this.oneOf) {
      oneOfs.push(toOneOfJson(oneOfobj))
    }

    const jsonObj: IShapeJson = {
      ...obj,
      positivePredicates,
      negativePredicates,
      oneOf: oneOfs,
    };
    return jsonObj;
  }

  public get(predicate: string): IPredicate | undefined {
    return this.predicates.get(predicate);
  }

  public getAll(): IPredicate[] {
    return [...this.predicates.values()];
  }

  public getLinkedShapeIri(): Set<string> {
    return this.linkedShapeIri;
  }
}

export interface IRdfListIndex {
  firstByNode: Map<string, string>;
  restByNode: Map<string, string>;
}

export interface IRdfListWalkResult {
  values: string[];
  malformed: boolean;
  cycleDetected: boolean;
}

/**
 * Walk an RDF collection linked with rdf:first / rdf:rest.
 *
 * Returns all list member values found from `head` until rdf:nil.
 * If the collection is malformed, traversal stops and marks `malformed`.
 */
export function walkRdfList(
  head: string,
  index: IRdfListIndex,
): IRdfListWalkResult {
  const values: string[] = [];
  const visited = new Set<string>();

  let malformed = false;
  let cycleDetected = false;
  let current: string | undefined = head;

  while (true) {
    if (current === undefined || current === RDF.nil) {
      break;
    }

    if (visited.has(current)) {
      cycleDetected = true;
      malformed = true;
      break;
    }
    visited.add(current);

    const value = index.firstByNode.get(current);
    const next = index.restByNode.get(current);
    if (value === undefined || next === undefined) {
      malformed = true;
      break;
    }

    values.push(value);
    current = next;
  }

  return {
    values,
    malformed,
    cycleDetected,
  };
}

/**
 * What a shapes graph declares about the values of a property: a class, a shape or a datatype, and
 * the facets of the datatype.
 */
export interface IConstraintDeclaration extends IConstraintFacets {
  classConstraint?: string;
  shapeConstraint?: string;
  datatypeConstraint?: string;
}

/**
 * Build the constraint of a property from its declaration. A class takes precedence over a shape,
 * and a shape over a datatype. A datatype on rdf:type names a class.
 */
export function buildConstraint(declaration: IConstraintDeclaration, predicateName: string): IConstraint | undefined {
  if (declaration.classConstraint !== undefined) {
    return { value: new Set([declaration.classConstraint]), type: ConstraintType.INSTANCE };
  }
  if (declaration.shapeConstraint !== undefined) {
    return { value: new Set([declaration.shapeConstraint]), type: ConstraintType.SHAPE };
  }
  if (declaration.datatypeConstraint === undefined) {
    return undefined;
  }
  if (predicateName === RDF.type) {
    return { value: new Set([declaration.datatypeConstraint]), type: ConstraintType.CLASS };
  }
  return { value: new Set([declaration.datatypeConstraint]), type: ConstraintType.DATATYPE, ...definedFacets(declaration) };
}

function definedFacets(facets: IConstraintFacets): IConstraintFacets {
  const defined: IConstraintFacets = {};
  for (const key of FACET_KEYS) {
    if (facets[key] !== undefined) {
      Object.assign(defined, { [key]: facets[key] });
    }
  }
  return defined;
}

/**
 * Build a shape, returning the error instead of throwing it when the shape is inconsistent.
 */
export function tryCreateShape(args: IShapeArgs): IShape | ShapeError {
  try {
    return new Shape(args);
  } catch (error: unknown) {
    if (error instanceof InconsistentPositiveAndNegativePredicateError) {
      return error;
    }
    throw error;
  }
}

/**
 * Whether there is at least one target.
 */
export function declaresTargets(targets: IShapeTargets): boolean {
  return Object.values(targets).some(values => values.length > 0);
}

const TARGETLESS_SHAPES = new WeakMap<IShape, IShape>();

/**
 * The shape as SHACL applies it when the shape is reached through sh:node: without its targets.
 */
export function withoutTargets(shape: IShape): IShape {
  if (!declaresTargets(shape.targets)) {
    return shape;
  }
  let targetless = TARGETLESS_SHAPES.get(shape);
  if (targetless === undefined) {
    targetless = new Shape({
      name: shape.name,
      positivePredicates: shape.positivePredicates.map(predicate => shape.get(predicate) ?? predicate),
      negativePredicates: shape.negativePredicates.map(predicate => shape.get(predicate) ?? predicate),
      closed: shape.closed,
      oneOf: shape.oneOf,
      ignoredProperties: shape.ignoredProperties,
      unsupported: shape.unsupported,
    });
    TARGETLESS_SHAPES.set(shape, targetless);
  }
  return targetless;
}

export function isNegativeCardinality(minCount?: number, maxCount?: number): boolean {
  return minCount === 0 && maxCount === 0;
}

/**
 * An error to indicate that there is an inconsistency with the positive and negative properties
 */
export class InconsistentPositiveAndNegativePredicateError extends Error {
  public constructor(message: string) {
    super(message);

    Object.setPrototypeOf(this, InconsistentPositiveAndNegativePredicateError.prototype);
  }
}

/**
 * An error to indicate that the shape is poorly formated
 */
export class PoorlyFormatedShapeError extends Error {
  public constructor(message: string) {
    super(message);

    Object.setPrototypeOf(this, PoorlyFormatedShapeError.prototype);
  }
}

export type ShapeError = PoorlyFormatedShapeError | InconsistentPositiveAndNegativePredicateError;
