import type * as RDFJS from '@rdfjs/types';
import { SHACL, SHEX } from './constant';
import { forEachQuad, type IShapeParserOptions, type ShapeFormat } from './parser-policy';
import { type IShape, PoorlyFormatedShapeError, type ShapeError } from './Shape';
import { shaclShapeFromQuads } from './shacl';
import { shexShapeFromQuads } from './shex';

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
  // The format is detected from the whole graph, so a stream is collected first
  const collected: RDFJS.Quad[] = [];
  const error = await forEachQuad(quads, quad => collected.push(quad));
  if (error !== undefined) {
    return error;
  }

  const requestedFormat = options?.format ?? 'auto';
  const format = requestedFormat === 'auto' ? detectShapeFormat(collected) : requestedFormat;
  if (format === undefined) {
    return new PoorlyFormatedShapeError('Cannot detect shape format automatically. Please provide options.format.');
  }
  return format === 'shacl' ?
    shaclShapeFromQuads(collected, shapeIri, options) :
    shexShapeFromQuads(collected, shapeIri, options);
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
      || quad.predicate.equals(SHACL.terms.targetNode)
      || quad.predicate.equals(SHACL.terms.targetClass)
      || quad.predicate.equals(SHACL.terms.targetSubjectsOf)
      || quad.predicate.equals(SHACL.terms.targetObjectsOf)
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
