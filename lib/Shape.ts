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
  oneOf: OneOf[];
  oneOfIndexed: OneOfIndexed[];
}

/**
 * A predicate
 */
export interface IPredicate {
  name: string;
  constraint?: IContraint;
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
  constraint?: IContraintJson;
}

/**
 * A constraint
 */
export interface IContraint {
  value: Set<string>;
  type: ConstraintType;
}

function toJsonConstraint(constraint: IContraint): IContraintJson {
  return {
    ...constraint,
    value: Array.from(constraint.value)
  }
}

export type IContraintJson = Omit<IContraint, "value"> & {
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
  // Is bound by an RDF type
  TYPE
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

  /**
   *
   * @param {IShapeArgs} args - The argument to build a shape
   */
  public constructor({ name, positivePredicates, negativePredicates, closed, oneOf }: IShapeArgs) {
    this.name = name;
    this.closed = closed ?? false;
    this.oneOf = oneOf ? oneOf : [];
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
    return {
      name: this.name,
      closed: this.closed,
      positivePredicates: this.positivePredicates,
      negativePredicates: this.negativePredicates,
      oneOf: this.oneOf
    };
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
