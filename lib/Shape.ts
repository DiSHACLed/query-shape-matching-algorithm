import type * as RDFJS from '@rdfjs/types';
import { RDF, SHACL, SHEX } from './constant';
import type { IShapeParserOptions, ShapeFormat } from './parser-policy';

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
 * A constraint
 */
export interface IConstraint {
  value: Set<string>;
  type: ConstraintType;
  minInclusive?: number;
  maxInclusive?: number;
  minExclusive?: number;
  maxExclusive?: number;
  pattern?: string;
  flags?: string;
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
  // Is bound by a class IRI (typically object is a NamedNode)
  CLASS,
  // Is bound by a literal datatype IRI
  DATATYPE,
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

export interface IConstraintParts {
  shapeConstraint?: string;
  classConstraint?: string;
  datatypeConstraint?: string;
  minInclusive?: number;
  maxInclusive?: number;
  minExclusive?: number;
  maxExclusive?: number;
  pattern?: string;
  flags?: string;
}

export interface IPredicateParts {
  name: string;
  minCount?: number;
  maxCount?: number;
  constraintParts?: IConstraintParts;
}

export interface IRawShape {
  name: string;
  closed?: boolean;
  positivePredicates: IPredicateParts[];
  negativePredicates?: string[];
  oneOf?: IRawOneOf[];
}

export type IRawOneOfPath = IPredicateParts[];
export type IRawOneOf = IRawOneOfPath[];

/**
 * Shared parser-neutral assembly from raw parser data into IShape.
 */
export function buildShapeFromRaw(raw: IRawShape): IShape | ShapeError {
  try {
    const positivePredicates = raw.positivePredicates.map(buildPredicate);
    const oneOf: OneOf[] = (raw.oneOf ?? []).map(currentOneOf =>
      currentOneOf.map(path => path.map(buildPredicate)),
    );

    return new Shape({
      name: raw.name,
      positivePredicates,
      negativePredicates: raw.negativePredicates ?? [],
      closed: raw.closed ?? false,
      oneOf,
    });
  } catch (error: unknown) {
    return error as ShapeError;
  }
}

export function predicateToParts(predicate: IPredicate): IPredicateParts {
  return {
    name: predicate.name,
    minCount: predicate.cardinality?.min,
    maxCount: predicate.cardinality?.max,
    constraintParts: constraintToParts(predicate.constraint),
  };
}

export function buildPredicate(parts: IPredicateParts): IPredicate {
  const hasCardinality = parts.minCount !== undefined || parts.maxCount !== undefined;
  return {
    name: parts.name,
    constraint: parts.constraintParts !== undefined ? buildConstraint(parts.constraintParts, parts.name) : undefined,
    cardinality: hasCardinality
      ? {
        min: parts.minCount ?? 1,
        max: parts.maxCount ?? 1,
      }
      : undefined,
  };
}

export function buildConstraint(parts: IConstraintParts, predicateName?: string): IConstraint | undefined {
  if (parts.classConstraint !== undefined) {
    return {
      value: new Set([parts.classConstraint]),
      type: ConstraintType.CLASS,
    };
  }

  if (parts.shapeConstraint !== undefined) {
    return {
      value: new Set([parts.shapeConstraint]),
      type: ConstraintType.SHAPE,
    };
  }

  if (parts.datatypeConstraint !== undefined) {
    const facets: Partial<IConstraint> = {};
    if (parts.minInclusive !== undefined) {
      facets.minInclusive = parts.minInclusive;
    }
    if (parts.maxInclusive !== undefined) {
      facets.maxInclusive = parts.maxInclusive;
    }
    if (parts.minExclusive !== undefined) {
      facets.minExclusive = parts.minExclusive;
    }
    if (parts.maxExclusive !== undefined) {
      facets.maxExclusive = parts.maxExclusive;
    }
    if (parts.pattern !== undefined) {
      facets.pattern = parts.pattern;
    }
    if (parts.flags !== undefined) {
      facets.flags = parts.flags;
    }

    return {
      value: new Set([parts.datatypeConstraint]),
      type: predicateName === RDF.type
        ? ConstraintType.CLASS
        : ConstraintType.DATATYPE,
      ...facets,
    };
  }

  return undefined;
}

export function isNegativeCardinality(minCount?: number, maxCount?: number): boolean {
  return minCount === 0 && maxCount === 0;
}

function constraintToParts(constraint: IConstraint | undefined): IConstraintParts | undefined {
  if (constraint === undefined) {
    return undefined;
  }

  const firstValue = constraint.value.values().next().value as string | undefined;
  const facets: IConstraintParts = {
    minInclusive: constraint.minInclusive,
    maxInclusive: constraint.maxInclusive,
    minExclusive: constraint.minExclusive,
    maxExclusive: constraint.maxExclusive,
    pattern: constraint.pattern,
    flags: constraint.flags,
  };

  if (firstValue === undefined) {
    return facets;
  }

  if (constraint.type === ConstraintType.SHAPE) {
    facets.shapeConstraint = firstValue;
  } else if (constraint.type === ConstraintType.CLASS) {
    facets.classConstraint = firstValue;
  } else if (constraint.type === ConstraintType.DATATYPE) {
    facets.datatypeConstraint = firstValue;
  }

  return facets;
}

export interface IParseShapeFromQuadsOptions extends IShapeParserOptions {
  format?: ShapeFormat | 'auto';
}

/**
 * Unified parser entrypoint for SHACL and ShEx shape graphs.
 */
export async function parseShapeFromQuads(
  quads: RDFJS.Stream | RDFJS.Quad[],
  shapeIri: string,
  options?: IParseShapeFromQuadsOptions,
): Promise<IShape | ShapeError> {
  const format = options?.format ?? 'auto';

  if (Array.isArray(quads)) {
    return parseFromArray(quads, shapeIri, format, options);
  }

  return new Promise(resolve => {
    const buffer: RDFJS.Quad[] = [];
    quads.on('data', (quad: RDFJS.Quad) => {
      buffer.push(quad);
    });
    quads.on('error', (error: any) => {
      resolve(error);
    });
    quads.on('end', () => {
      parseFromArray(buffer, shapeIri, format, options).then(resolve);
    });
  });
}

async function parseFromArray(
  quads: RDFJS.Quad[],
  shapeIri: string,
  requestedFormat: ShapeFormat | 'auto',
  options?: IParseShapeFromQuadsOptions,
): Promise<IShape | ShapeError> {
  const format = requestedFormat === 'auto'
    ? detectShapeFormat(quads)
    : requestedFormat;

  if (format === undefined) {
    return new PoorlyFormatedShapeError('Cannot detect shape format automatically. Please provide options.format.');
  }

  if (format === 'shacl') {
    const module = await import('./shacl');
    return module.shaclShapeFromQuads(quads, shapeIri, options);
  }

  const module = await import('./shex');
  return module.shexShapeFromQuads(quads, shapeIri, options);
}

function detectShapeFormat(quads: RDFJS.Quad[]): ShapeFormat | undefined {
  let shaclScore = 0;
  let shexScore = 0;

  for (const quad of quads) {
    if (
      quad.predicate.equals(SHACL.terms.property)
      || quad.predicate.equals(SHACL.terms.path)
      || quad.predicate.equals(SHACL.terms.or)
      || quad.predicate.equals(SHACL.terms.xone)
      || quad.predicate.equals(SHACL.terms.node)
      || quad.predicate.equals(SHACL.terms.datatype)
    ) {
      shaclScore++;
    }

    if (
      quad.predicate.equals(SHEX.terms.expression)
      || quad.predicate.equals(SHEX.terms.expressions)
      || quad.predicate.equals(SHEX.terms.predicate)
      || quad.predicate.equals(SHEX.terms.valueExpr)
      || quad.object.equals(SHEX.terms.Shape)
      || quad.object.equals(SHEX.terms.EachOf)
      || quad.object.equals(SHEX.terms.OneOf)
    ) {
      shexScore++;
    }
  }

  if (shaclScore > shexScore) {
    return 'shacl';
  }
  if (shexScore > shaclScore) {
    return 'shex';
  }
  return undefined;
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
