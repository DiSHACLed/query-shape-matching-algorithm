import type * as RDF from '@rdfjs/types';
import { type IRdfListIndex, PoorlyFormatedShapeError, type ShapeError, walkRdfList } from './Shape';

export type ShapeFormat = 'shacl' | 'shex';

export interface ParserDiagnostic {
  level: 'warning' | 'error';
  code: string;
  message: string;
  shapeIri?: string;
  nodeId?: string;
}

export interface ShapeParserPolicy {
  /**
   * If true, malformed RDF lists are treated as parse errors.
   * Defaults to true.
   */
  strictRdfLists?: boolean;
}

export interface IShapeParserOptions {
  policy?: ShapeParserPolicy;
  diagnostics?: ParserDiagnostic[];
}

export function getPolicy(options?: IShapeParserOptions): Required<ShapeParserPolicy> {
  return {
    strictRdfLists: options?.policy?.strictRdfLists ?? true,
  };
}

export function addDiagnostic(
  options: IShapeParserOptions | undefined,
  diagnostic: ParserDiagnostic,
): void {
  options?.diagnostics?.push(diagnostic);
}

/**
 * Where an RDF list is read, for its diagnostic.
 */
export interface IRdfListContext {
  shapeIri: string;
  // the construct the list belongs to, such as `sh:or`
  construct: string;
  options?: IShapeParserOptions;
}

/**
 * The members of an RDF list of a shapes graph. A malformed list is reported as a diagnostic; it is
 * a parse error under the strict policy (the default), and otherwise its members up to the defect
 * are used.
 */
export function readRdfList(
  head: string,
  index: IRdfListIndex,
  context: IRdfListContext,
): string[] | PoorlyFormatedShapeError {
  const walked = walkRdfList(head, index);
  if (!walked.malformed) {
    return walked.values;
  }
  const { strictRdfLists } = getPolicy(context.options);
  addDiagnostic(context.options, {
    level: strictRdfLists ? 'error' : 'warning',
    code: 'MALFORMED_RDF_LIST',
    message: `Malformed RDF list while resolving ${context.construct} for <${context.shapeIri}>`,
    shapeIri: context.shapeIri,
    nodeId: head,
  });
  return strictRdfLists ? new PoorlyFormatedShapeError('An RDF list is poorly defined') : walked.values;
}

/**
 * Pass every quad of a shapes graph, given as an array or as a stream, to `onQuad`. The promise
 * resolves when all the quads are passed, with the error of the stream if it fails: the parsers
 * return their errors rather than throw them.
 */
export function forEachQuad(
  quads: RDF.Stream | RDF.Quad[],
  onQuad: (quad: RDF.Quad) => void,
): Promise<ShapeError | undefined> {
  if (Array.isArray(quads)) {
    quads.forEach(onQuad);
    return Promise.resolve(undefined);
  }
  return new Promise(resolve => {
    quads.on('data', onQuad);
    quads.on('error', (error: ShapeError) => resolve(error));
    quads.on('end', () => resolve(undefined));
  });
}
