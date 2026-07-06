import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'rdf-data-factory';
import { SHEX, RDF as RDF_VOCAB, XSD } from './constant';
import type {
  ShapeError,
  OneOf,
  IShape,
  IPredicate
} from './Shape';
import { PoorlyFormatedShapeError, walkRdfList, buildShapeFromRaw, predicateToParts, buildConstraint, isNegativeCardinality } from './Shape';
import { addDiagnostic, getPolicy, type IShapeParserOptions } from './parser-policy';

const DF = new DataFactory();
const RDF_TRUE = DF.literal('true', DF.namedNode(XSD.boolean));

/**
 * Parse a Shex shape from a set of quads
 * @param {RDF.Stream | RDF.Quad[]} quads - Quads representing a shape
 * @param {string} shapeIri - The iri of the desired shape
 * @returns {Promise<IShape | ShapeError>} The shape
 * @todo support for `OR` statement
 */
export function shexShapeFromQuads(
  quads: RDF.Stream | RDF.Quad[],
  shapeIri: string,
  options?: IShapeParserOptions,
): Promise<IShape | ShapeError> {
  if (Array.isArray(quads)) {
    return new Promise(resolve => {
      resolve(shapeFromQuadArray(quads, shapeIri, options));
    });
  }
  return shapeFromQuadStream(quads, shapeIri, options);
}

/**
 * Parse a Shex shape from a quad stream
 * @param {RDF.Stream} quads - Quads representing a shape
 * @param {string} shapeIri - The iri of the desired shape
 * @returns {Promise<IShape | ShapeError>} The shape
 */
function shapeFromQuadStream(
  quadSteam: RDF.Stream,
  shapeIri: string,
  options?: IShapeParserOptions,
): Promise<IShape | ShapeError> {
  const mapTripleShex: IMapTripleShex = defaultMapTripleShex();

  return new Promise(resolve => {
    quadSteam.on('data', (quad: RDF.Quad) => {
      parseShapeQuads(
        quad,
        mapTripleShex,
      );
    });

    quadSteam.on('error', (error: any) => {
      resolve(error);
    });
    quadSteam.on('end', () => {
      const shape = concatShapeInfo(
        mapTripleShex,
        shapeIri,
        options,
      );
      resolve(shape);
    });
  });
}

/**
 * Parse a Shex shape from an array of quad
 * @param {RDF.Quad[]} quads - Quads representing a shape
 * @param {string} shapeIri - The iri of the desired shape
 * @returns {Promise<IShape | ShapeError>} The shape
 */
function shapeFromQuadArray(
  quads: RDF.Quad[],
  shapeIri: string,
  options?: IShapeParserOptions,
): IShape | ShapeError {
  const mapTripleShex: IMapTripleShex = defaultMapTripleShex();

  for (const quad of quads) {
    parseShapeQuads(
      quad,
      mapTripleShex,
    );
  }

  const shape = concatShapeInfo(
    mapTripleShex,
    shapeIri,
    options,
  );
  return shape;
}

/**
 * Transform an arranged set of triple into a Shape
 * @param {IMapTripleShex} mapTripleShex - Triple information to build a shape
 * @param {string} shapeIri - The iri of a shape
 * @returns {IShape | ShapeError} - The resulting shape
 */
function concatShapeInfo(
  mapTripleShex: IMapTripleShex,
  shapeIri: string,
  options?: IShapeParserOptions,
): IShape | ShapeError {
  const positivePredicates: IPredicate[] = [];
  const negativePredicates: string[] = [];
  const argsFunctionPredicate: IAppendPredicateArgs = {
    mapIdPredicate: mapTripleShex.mapIdPredicate,
    mapIriCardinalityMin: mapTripleShex.mapIriCardinalityMin,
    mapIriCardinalityMax: mapTripleShex.mapIriCardinalityMax,
    mapIriConstraint: mapTripleShex.mapIriConstraint,
    mapIriDatatype: mapTripleShex.mapIriDatatype,
    mapIriMinInclusive: mapTripleShex.mapIriMinInclusive,
    mapIriMaxInclusive: mapTripleShex.mapIriMaxInclusive,
    mapIriMinExclusive: mapTripleShex.mapIriMinExclusive,
    mapIriMaxExclusive: mapTripleShex.mapIriMaxExclusive,
    mapIriPattern: mapTripleShex.mapIriPattern,
    mapIriFlags: mapTripleShex.mapIriFlags,
    positivePredicates,
    negativePredicates,
    oneOf: new Map(),
  };
  const shapeExpr = mapTripleShex.mapIriShapeExpression.get(shapeIri);
  let expression;
  if (shapeExpr === undefined) {
    expression = mapTripleShex.mapShapeExpressionId.get(shapeIri);
  } else {
    expression = mapTripleShex.mapShapeExpressionId.get(shapeExpr);
  }
  let expressions;
  if (expression === undefined) {
    expressions = mapTripleShex.mapLogicLinkIdExpressions.get(shapeIri);
    if (expressions === undefined) {
      return new PoorlyFormatedShapeError('there are no expressions in the shape');
    }
  } else {
    expressions = mapTripleShex.mapLogicLinkIdExpressions.get(expression);
  }
  // If there is only one expression
  if (expressions === undefined) {
    argsFunctionPredicate.current = expression;
    const predicateAdded = appendPredicates((argsFunctionPredicate as Required<IAppendPredicateArgs>));
    if (!predicateAdded) {
      return new PoorlyFormatedShapeError('there are no predicates in the shape');
    }
  } else if (expression === undefined) {
    const current = mapTripleShex.mapPrevCurrentList.get(expressions);
    const next = mapTripleShex.mapPrevNextList.get(expressions);
    const error = handleEachOf(current, next, mapTripleShex, argsFunctionPredicate, shapeIri, options);
    if (error !== undefined) {
      return error;
    }
  } else if (mapTripleShex.setIriEachOf.has(expression)) {
    const policy = getPolicy(options);
    const walked = walkRdfList(expressions, {
      firstByNode: mapTripleShex.mapPrevCurrentList,
      restByNode: mapTripleShex.mapPrevNextList,
    });
    if (walked.malformed) {
      addDiagnostic(options, {
        level: policy.strictRdfLists ? 'error' : 'warning',
        code: 'MALFORMED_RDF_LIST',
        message: `Malformed RDF list while resolving eachOf for <${shapeIri}>`,
        shapeIri,
        nodeId: expressions,
      });
      if (policy.strictRdfLists) {
        return new PoorlyFormatedShapeError('An RDF list is poorly defined');
      }
    }

    const current = mapTripleShex.mapPrevCurrentList.get(expressions);
    const next = mapTripleShex.mapPrevNextList.get(expressions);
    const error = handleEachOf(
      current,
      next,
      mapTripleShex,
      argsFunctionPredicate,
      shapeIri,
      options,
    );
    if (error !== undefined) {
      return error;
    }
  } else if (mapTripleShex.setIriOneOf.has(expression)) {
    const error = handleOneOf(
      expression,
      expression,
      mapTripleShex,
      argsFunctionPredicate,
      mapTripleShex.setIriEachOf.has(expression),
      shapeIri,
      options,
    );
    if (error !== undefined) {
      return error;
    }
  }

  let isClosed;
  if (shapeExpr === undefined) {
    isClosed = mapTripleShex.mapShapeExpressionClosedShape.get(shapeIri);
  } else {
    isClosed = mapTripleShex.mapShapeExpressionClosedShape.get(shapeExpr);
  }
  let oneOfs: OneOf[] = [];
    for (const currentOneOf of argsFunctionPredicate.oneOf.values()) {
      const oneOf: OneOf = [];
      for (const currentPath of currentOneOf) {
        const deleteDuplicate = new Map(currentPath.map((predicate) => [predicate.name, predicate]));
        oneOf.push(Array.from(deleteDuplicate.values()));
      }
      oneOfs.push(oneOf);
    }
    oneOfs = deleteIdenticalBranch(oneOfs)
    return buildShapeFromRaw({
      name: shapeIri,
      positivePredicates: positivePredicates.map(predicateToParts),
      negativePredicates,
      closed: isClosed,
      oneOf: oneOfs.map(currentOneOf => currentOneOf.map(path => path.map(predicateToParts))),
    });
}

/**
 * Interpret an RDF term of a constraint into an object
 * @param {RDF.Term | undefined} constraint - The constraint RDF term
 * @param {Map<string, string>} mapIriDatatype - A map of IRI and data type
 * @returns {IConstraint | undefined} - The constraint or undefined if the constraint is not supported
 */
function interpretConstraint(
  constraint: RDF.Term | undefined,
  mapIriDatatype: Map<string, string>,
  mapIriMinInclusive: Map<string, number>,
  mapIriMaxInclusive: Map<string, number>,
  mapIriMinExclusive: Map<string, number>,
  mapIriMaxExclusive: Map<string, number>,
  mapIriPattern: Map<string, string>,
  mapIriFlags: Map<string, string>,
  predicate?: string,
){
  if (constraint === undefined) {
    return undefined;
  }

  if (constraint.termType === 'NamedNode') {
    return buildConstraint({ shapeConstraint: constraint.value }, predicate);
  }

  if (constraint.termType === 'BlankNode') {
    const dataType = mapIriDatatype.get(constraint.value);
    if (dataType !== undefined) {
      const minInclusive = mapIriMinInclusive.get(constraint.value);
      const maxInclusive = mapIriMaxInclusive.get(constraint.value);
      const minExclusive = mapIriMinExclusive.get(constraint.value);
      const maxExclusive = mapIriMaxExclusive.get(constraint.value);
      const pattern = mapIriPattern.get(constraint.value);
      const flags = mapIriFlags.get(constraint.value);

      return buildConstraint({
        datatypeConstraint: dataType,
        minInclusive,
        maxInclusive,
        minExclusive,
        maxExclusive,
        pattern,
        flags,
      }, predicate);
    }
  }

  return undefined;
}

/**
 * Add the predicate to the predicat lists
 * @param {Required<IAppendPredicateArgs>} args - Argument to build a predicate
 * @returns {boolean} - return true if the predicate was added
 */
function appendPredicates(
  args: Required<IAppendPredicateArgs>,
): boolean {
  const predicate = args.mapIdPredicate.get(args.current);
  if (predicate !== undefined) {
    const min = args.mapIriCardinalityMin.get(args.current);
    const max = args.mapIriCardinalityMax.get(args.current);
    if (isNegativeCardinality(min, max)) {
      args.negativePredicates.push(predicate);
    } else {
      const constraintIri = args.mapIriConstraint.get(args.current);
      const constraint = interpretConstraint(
        constraintIri,
        args.mapIriDatatype,
        args.mapIriMinInclusive,
        args.mapIriMaxInclusive,
        args.mapIriMinExclusive,
        args.mapIriMaxExclusive,
        args.mapIriPattern,
        args.mapIriFlags,
        predicate,
      );
      args.positivePredicates.push({
        name: predicate,
        cardinality: {
          min: min ?? 1,
          max: max ?? 1,
        },
        constraint,
      });
    }
    return true;
  }
  return false;
}

function handleOneOf(
  iri: string,
  index: string,
  mapTripleShex: IMapTripleShex,
  prevArgsFunctionPredicate: IAppendPredicateArgs,
  eachOf: boolean,
  shapeIri: string,
  options?: IShapeParserOptions,
): undefined | PoorlyFormatedShapeError {
  const positivePredicates: IPredicate[] = [];
  const negativePredicates: string[] = [];
  const argsFunctionPredicate: IAppendPredicateArgs = {
    mapIdPredicate: mapTripleShex.mapIdPredicate,
    mapIriCardinalityMin: mapTripleShex.mapIriCardinalityMin,
    mapIriCardinalityMax: mapTripleShex.mapIriCardinalityMax,
    mapIriConstraint: mapTripleShex.mapIriConstraint,
    mapIriDatatype: mapTripleShex.mapIriDatatype,
    mapIriMinInclusive: mapTripleShex.mapIriMinInclusive,
    mapIriMaxInclusive: mapTripleShex.mapIriMaxInclusive,
    mapIriMinExclusive: mapTripleShex.mapIriMinExclusive,
    mapIriMaxExclusive: mapTripleShex.mapIriMaxExclusive,
    mapIriPattern: mapTripleShex.mapIriPattern,
    mapIriFlags: mapTripleShex.mapIriFlags,
    positivePredicates,
    negativePredicates,
    oneOf: new Map()
  };
  const expressions = mapTripleShex.mapLogicLinkIdExpressions.get(iri);
  // we don't really support validation of format
  /* istanbul ignore next */
  if (expressions === undefined) {
    return new PoorlyFormatedShapeError('There are no expressions in a one of');
  }

  const policy = getPolicy(options);
  const walked = walkRdfList(expressions, {
    firstByNode: mapTripleShex.mapPrevCurrentList,
    restByNode: mapTripleShex.mapPrevNextList,
  });

  if (walked.malformed) {
    addDiagnostic(options, {
      level: policy.strictRdfLists ? 'error' : 'warning',
      code: 'MALFORMED_RDF_LIST',
      message: `Malformed RDF list while resolving oneOf for <${shapeIri}>`,
      shapeIri,
      nodeId: expressions,
    });
    if (policy.strictRdfLists) {
      return new PoorlyFormatedShapeError('An RDF list is poorly defined');
    }
  }

  let current = mapTripleShex.mapPrevCurrentList.get(expressions);
  let next = mapTripleShex.mapPrevNextList.get(expressions);
  while (current !== undefined) {
    if (!mapTripleShex.setIriOneOf.has(current) && !mapTripleShex.setIriEachOf.has(current)) {
      const error = handleEachOf(current, next, mapTripleShex, argsFunctionPredicate, shapeIri, options);
      if (error !== undefined) {
        return error;
      }
    } else {
      const error = handleOneOf(
        current,
        iri,
        mapTripleShex,
        prevArgsFunctionPredicate,
        mapTripleShex.setIriEachOf.has(current),
        shapeIri,
        options,
      );
      if (error !== undefined) {
        return error;
      }
    }

    if (next === undefined) {
      return new PoorlyFormatedShapeError('An RDF list is poorly defined');
    }

    current = mapTripleShex.mapPrevCurrentList.get(next);
    next = mapTripleShex.mapPrevNextList.get(next);
  }
  const currentOneOf = prevArgsFunctionPredicate.oneOf.get(index);
  if (currentOneOf === undefined) {
    if (!eachOf) {
      prevArgsFunctionPredicate.oneOf.set(index, Array.from(argsFunctionPredicate.positivePredicates.values()).map((predicate) => [predicate]));
    } else {
      prevArgsFunctionPredicate.oneOf.set(index, [Array.from(argsFunctionPredicate.positivePredicates.values())]);
    }
  } else {
    if (!eachOf) {
      for (const value of Array.from(argsFunctionPredicate.positivePredicates.values())) {
        currentOneOf.push([value]);
      }
    } else {
      currentOneOf.push(Array.from(argsFunctionPredicate.positivePredicates.values()));

    }
  }

  return undefined;
}

function handleEachOf(
  current: string | undefined,
  next: string | undefined,
  mapTripleShex: IMapTripleShex,
  argsFunctionPredicate: IAppendPredicateArgs,
  _shapeIri: string,
  _options?: IShapeParserOptions,
): undefined | PoorlyFormatedShapeError {
  // Traverse the RDF list
  while (current !== undefined) {
    if (!mapTripleShex.setIriOneOf.has(current)) {
      argsFunctionPredicate.current = current;
      appendPredicates((argsFunctionPredicate as Required<IAppendPredicateArgs>));
    } else {
      const error = handleOneOf(
        current,
        current,
        mapTripleShex,
        argsFunctionPredicate,
        mapTripleShex.setIriEachOf.has(current),
        _shapeIri,
        _options,
      );
      if (error !== undefined) {
        return error;
      }
    }

    if (next === undefined) {
      return new PoorlyFormatedShapeError('An RDF list is poorly defined');
    }

    current = mapTripleShex.mapPrevCurrentList.get(next);
    next = mapTripleShex.mapPrevNextList.get(next);
  }

  return undefined;
}

function deleteIdenticalBranch(oneOfs: OneOf[]): OneOf[] {

  for (let i = 0; i < oneOfs.length; ++i) {
    const identicalIndex = new Set<number>();
    const indexed = new Set<string>();
    const oneOf = oneOfs[i];
    for (let j = 0; j < oneOf.length; ++j) {
      const stringElement = JSON.stringify(oneOf[j], (key, value) => {
        if (key === "value") {
          return Array.from(value);
        }
        return value
      })
      if (indexed.has(stringElement)) {
        identicalIndex.add(j);
      }
      indexed.add(stringElement);
    }
    oneOfs[i] = oneOfs[i].filter((_, k) => {
      return !identicalIndex.has(k);
    });
  }

  return oneOfs;
}

/**
 * Parse the quad into the ShEx map object
 * @param {RDF.Quad} quad - A quad
 * @param {IMapTripleShex} mapTripleShex - A map of ShEx shape information
 */
function parseShapeQuads(
  quad: RDF.Quad,
  mapTripleShex: IMapTripleShex,
): void {
  if (quad.predicate.equals(SHEX.terms.predicate)) {
    mapTripleShex.mapIdPredicate.set(quad.subject.value, quad.object.value);
  }
  if (quad.predicate.equals(RDF_VOCAB.terms.first)) {
    mapTripleShex.mapPrevCurrentList.set(quad.subject.value, quad.object.value);
  }
  if (quad.predicate.equals(RDF_VOCAB.terms.rest)) {
    mapTripleShex.mapPrevNextList.set(quad.subject.value, quad.object.value);
  }
  if (quad.predicate.equals(SHEX.terms.expressions)) {
    mapTripleShex.mapLogicLinkIdExpressions.set(quad.subject.value, quad.object.value);
  }
  if (quad.predicate.equals(SHEX.terms.expression)) {
    mapTripleShex.mapShapeExpressionId.set(quad.subject.value, quad.object.value);
  }
  if (quad.predicate.equals(SHEX.terms.closed)) {
    mapTripleShex.mapShapeExpressionClosedShape.set(quad.subject.value, quad.object.equals(RDF_TRUE));
  }
  if (quad.predicate.equals(SHEX.terms.shapeExpr)) {
    mapTripleShex.mapIriShapeExpression.set(quad.subject.value, quad.object.value);
  }
  if (quad.predicate.equals(SHEX.terms.max)) {
    mapTripleShex.mapIriCardinalityMax.set(quad.subject.value, Number(quad.object.value));
  }
  if (quad.predicate.equals(SHEX.terms.min)) {
    mapTripleShex.mapIriCardinalityMin.set(quad.subject.value, Number(quad.object.value));
  }
  if (quad.predicate.equals(SHEX.terms.valueExpr)) {
    mapTripleShex.mapIriConstraint.set(quad.subject.value, quad.object);
  }
  if (quad.predicate.equals(SHEX.terms.datatype)) {
    mapTripleShex.mapIriDatatype.set(quad.subject.value, quad.object.value);
  }
  if (quad.predicate.equals(SHEX.terms.mininclusive)) {
    mapTripleShex.mapIriMinInclusive.set(quad.subject.value, Number(quad.object.value));
  }
  if (quad.predicate.equals(SHEX.terms.maxinclusive)) {
    mapTripleShex.mapIriMaxInclusive.set(quad.subject.value, Number(quad.object.value));
  }
  if (quad.predicate.equals(SHEX.terms.minexclusive)) {
    mapTripleShex.mapIriMinExclusive.set(quad.subject.value, Number(quad.object.value));
  }
  if (quad.predicate.equals(SHEX.terms.maxexclusive)) {
    mapTripleShex.mapIriMaxExclusive.set(quad.subject.value, Number(quad.object.value));
  }
  if (quad.predicate.equals(SHEX.terms.pattern)) {
    mapTripleShex.mapIriPattern.set(quad.subject.value, quad.object.value);
  }
  if (quad.predicate.equals(SHEX.terms.flags)) {
    mapTripleShex.mapIriFlags.set(quad.subject.value, quad.object.value);
  }
  if (quad.object.equals(SHEX.terms.EachOf)) {
    mapTripleShex.setIriEachOf.add(quad.subject.value);
  }
  if (quad.object.equals(SHEX.terms.OneOf)) {
    mapTripleShex.setIriOneOf.add(quad.subject.value);
  }
}

interface IMapTripleShex {
  mapIdPredicate: Map<string, string>;
  mapPrevCurrentList: Map<string, string>;
  mapLogicLinkIdExpressions: Map<string, string>;
  mapShapeExpressionId: Map<string, string>;
  mapPrevNextList: Map<string, string>;
  mapShapeExpressionClosedShape: Map<string, boolean>;
  mapIriShapeExpression: Map<string, string>;
  mapIriCardinalityMax: Map<string, number>;
  mapIriCardinalityMin: Map<string, number>;
  mapIriConstraint: Map<string, RDF.Term>;
  mapIriDatatype: Map<string, string>;
  mapIriMinInclusive: Map<string, number>;
  mapIriMaxInclusive: Map<string, number>;
  mapIriMinExclusive: Map<string, number>;
  mapIriMaxExclusive: Map<string, number>;
  mapIriPattern: Map<string, string>;
  mapIriFlags: Map<string, string>;
  setIriEachOf: Set<string>;
  setIriOneOf: Set<string>;
}

interface IAppendPredicateArgs {
  mapIdPredicate: Map<string, string>;
  mapIriCardinalityMin: Map<string, number>;
  mapIriCardinalityMax: Map<string, number>;
  mapIriConstraint: Map<string, RDF.Term>;
  mapIriDatatype: Map<string, string>;
  mapIriMinInclusive: Map<string, number>;
  mapIriMaxInclusive: Map<string, number>;
  mapIriMinExclusive: Map<string, number>;
  mapIriMaxExclusive: Map<string, number>;
  mapIriPattern: Map<string, string>;
  mapIriFlags: Map<string, string>;
  positivePredicates: IPredicate[];
  negativePredicates: string[];
  oneOf: Map<string, OneOf>;
  current?: string;
}

function defaultMapTripleShex(): IMapTripleShex {
  return {
    mapIdPredicate: new Map(),
    mapPrevCurrentList: new Map(),
    mapLogicLinkIdExpressions: new Map(),
    mapShapeExpressionId: new Map(),
    mapPrevNextList: new Map(),
    mapShapeExpressionClosedShape: new Map(),
    mapIriShapeExpression: new Map(),
    mapIriCardinalityMax: new Map(),
    mapIriCardinalityMin: new Map(),
    mapIriConstraint: new Map(),
    mapIriDatatype: new Map(),
    mapIriMinInclusive: new Map(),
    mapIriMaxInclusive: new Map(),
    mapIriMinExclusive: new Map(),
    mapIriMaxExclusive: new Map(),
    mapIriPattern: new Map(),
    mapIriFlags: new Map(),
    setIriEachOf: new Set(),
    setIriOneOf: new Set()
  };
}
