import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'rdf-data-factory';
import { SHEX, RDF as RDF_VOCAB, XSD } from './constant';
import type {
  ShapeError,
  OneOf,
  IShape,
  IPredicate,
  IConstraint,
  IConstraintFacets,
} from './Shape';
import { PoorlyFormatedShapeError, tryCreateShape, buildConstraint, isNegativeCardinality } from './Shape';
import { type IShapeParserOptions, readRdfList } from './parser-policy';

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
    map: mapTripleShex,
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
  const context: IShexParseContext = { map: mapTripleShex, shapeIri, options };
  // If there is only one expression
  if (expressions === undefined) {
    // an undefined expression without expressions has already returned an error above
    const predicateAdded = expression !== undefined && appendPredicates(argsFunctionPredicate, expression);
    if (!predicateAdded) {
      return new PoorlyFormatedShapeError('there are no predicates in the shape');
    }
  } else if (expression === undefined || mapTripleShex.setIriEachOf.has(expression)) {
    const members = readExpressionList(expressions, 'eachOf', context);
    if (members instanceof PoorlyFormatedShapeError) {
      return members;
    }
    const error = handleEachOf(members, argsFunctionPredicate, context);
    if (error !== undefined) {
      return error;
    }
  } else if (mapTripleShex.setIriOneOf.has(expression)) {
    const error = handleOneOf(expression, expression, argsFunctionPredicate, mapTripleShex.setIriEachOf.has(expression), context);
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
    return tryCreateShape({
      name: shapeIri,
      positivePredicates,
      negativePredicates,
      closed: isClosed,
      oneOf: oneOfs,
    });
}

/**
 * Interpret an RDF term of a constraint into an object
 * @param {RDF.Term | undefined} constraint - The constraint RDF term
 * @param {IMapTripleShex} map - The ShEx shape information, for the datatype and facets of a node constraint
 * @param {string} predicate - The predicate the constraint applies to
 * @returns {IConstraint | undefined} - The constraint or undefined if the constraint is not supported
 */
function interpretConstraint(
  constraint: RDF.Term | undefined,
  map: IMapTripleShex,
  predicate: string,
): IConstraint | undefined {
  if (constraint === undefined) {
    return undefined;
  }

  if (constraint.termType === 'NamedNode') {
    return buildConstraint({ shapeConstraint: constraint.value }, predicate);
  }

  if (constraint.termType === 'BlankNode') {
    const datatypeConstraint = map.mapIriDatatype.get(constraint.value);
    if (datatypeConstraint !== undefined) {
      return buildConstraint({ datatypeConstraint, ...map.mapIriFacets.get(constraint.value) }, predicate);
    }
  }

  return undefined;
}

/**
 * Add the predicate of a triple expression to the predicate lists
 * @param {IAppendPredicateArgs} args - The lists to add to, and the shape information
 * @param {string} current - The triple expression
 * @returns {boolean} - return true if the predicate was added
 */
function appendPredicates(
  args: IAppendPredicateArgs,
  current: string,
): boolean {
  const predicate = args.map.mapIdPredicate.get(current);
  if (predicate !== undefined) {
    const min = args.map.mapIriCardinalityMin.get(current);
    const max = args.map.mapIriCardinalityMax.get(current);
    if (isNegativeCardinality(min, max)) {
      args.negativePredicates.push(predicate);
    } else {
      const constraint = interpretConstraint(args.map.mapIriConstraint.get(current), args.map, predicate);
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

/**
 * What the ShEx list handlers need besides the lists they fill.
 */
interface IShexParseContext {
  map: IMapTripleShex;
  shapeIri: string;
  options?: IShapeParserOptions;
}

function readExpressionList(head: string, construct: string, context: IShexParseContext): string[] | PoorlyFormatedShapeError {
  return readRdfList(head, {
    firstByNode: context.map.mapPrevCurrentList,
    restByNode: context.map.mapPrevNextList,
  }, { shapeIri: context.shapeIri, construct, options: context.options });
}

/**
 * Add the triple expressions of a oneOf (or of an eachOf inside a oneOf) as branches of the oneOf
 * stored at `index` in `prevArgsFunctionPredicate`. Nested oneOf and eachOf expressions add their
 * branches to the same oneOf.
 */
function handleOneOf(
  iri: string,
  index: string,
  prevArgsFunctionPredicate: IAppendPredicateArgs,
  eachOf: boolean,
  context: IShexParseContext,
): undefined | PoorlyFormatedShapeError {
  const { map } = context;
  const positivePredicates: IPredicate[] = [];
  const negativePredicates: string[] = [];
  const argsFunctionPredicate: IAppendPredicateArgs = {
    map,
    positivePredicates,
    negativePredicates,
    oneOf: new Map()
  };
  const expressions = map.mapLogicLinkIdExpressions.get(iri);
  // we don't really support validation of format
  /* istanbul ignore next */
  if (expressions === undefined) {
    return new PoorlyFormatedShapeError('There are no expressions in a one of');
  }

  const members = readExpressionList(expressions, 'oneOf', context);
  if (members instanceof PoorlyFormatedShapeError) {
    return members;
  }
  for (const member of members) {
    if (!map.setIriOneOf.has(member) && !map.setIriEachOf.has(member)) {
      appendPredicates(argsFunctionPredicate, member);
      continue;
    }
    const error = handleOneOf(member, iri, prevArgsFunctionPredicate, map.setIriEachOf.has(member), context);
    if (error !== undefined) {
      return error;
    }
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

/**
 * Add the triple expressions of an eachOf to the predicate lists; a oneOf among them adds a oneOf.
 */
function handleEachOf(
  members: string[],
  argsFunctionPredicate: IAppendPredicateArgs,
  context: IShexParseContext,
): undefined | PoorlyFormatedShapeError {
  for (const member of members) {
    if (!context.map.setIriOneOf.has(member)) {
      appendPredicates(argsFunctionPredicate, member);
      continue;
    }
    const error = handleOneOf(member, member, argsFunctionPredicate, context.map.setIriEachOf.has(member), context);
    if (error !== undefined) {
      return error;
    }
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
  const numericFacet = NUMERIC_FACETS.get(quad.predicate.value);
  if (numericFacet !== undefined) {
    getOrCreateFacets(mapTripleShex, quad.subject.value)[numericFacet] = Number(quad.object.value);
  }
  if (quad.predicate.equals(SHEX.terms.pattern)) {
    getOrCreateFacets(mapTripleShex, quad.subject.value).pattern = quad.object.value;
  }
  if (quad.predicate.equals(SHEX.terms.flags)) {
    getOrCreateFacets(mapTripleShex, quad.subject.value).flags = quad.object.value;
  }
  if (quad.object.equals(SHEX.terms.EachOf)) {
    mapTripleShex.setIriEachOf.add(quad.subject.value);
  }
  if (quad.object.equals(SHEX.terms.OneOf)) {
    mapTripleShex.setIriOneOf.add(quad.subject.value);
  }
}

// The ShEx numeric facets, by the facet they set
const NUMERIC_FACETS = new Map<string, 'minInclusive' | 'maxInclusive' | 'minExclusive' | 'maxExclusive'>([
  [SHEX.mininclusive, 'minInclusive'],
  [SHEX.maxinclusive, 'maxInclusive'],
  [SHEX.minexclusive, 'minExclusive'],
  [SHEX.maxexclusive, 'maxExclusive'],
]);

function getOrCreateFacets(mapTripleShex: IMapTripleShex, nodeId: string): IConstraintFacets {
  let facets = mapTripleShex.mapIriFacets.get(nodeId);
  if (facets === undefined) {
    facets = {};
    mapTripleShex.mapIriFacets.set(nodeId, facets);
  }
  return facets;
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
  mapIriFacets: Map<string, IConstraintFacets>;
  setIriEachOf: Set<string>;
  setIriOneOf: Set<string>;
}

interface IAppendPredicateArgs {
  map: IMapTripleShex;
  positivePredicates: IPredicate[];
  negativePredicates: string[];
  oneOf: Map<string, OneOf>;
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
    mapIriFacets: new Map(),
    setIriEachOf: new Set(),
    setIriOneOf: new Set()
  };
}
