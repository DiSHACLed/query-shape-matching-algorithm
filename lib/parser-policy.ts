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
