import type { NamedNode } from '@rdfjs/types';
import { createUriAndTermNamespace } from '@treecg/types';

type TermVocabulary<T extends string> = {
  namespace: NamedNode<string>;
  custom: (input: string) => NamedNode<string>;
} & {
  [K in T]: NamedNode<string>;
};

type Vocabulary<T extends string> = {
  namespace: string;
  custom: (input: string) => string;
  terms: TermVocabulary<T>;
} & {
  [K in T]: string;
};

function createVocabulary<T extends string>(
  baseUri: string,
  ...localNames: T[]
): Vocabulary<T> {
  return createUriAndTermNamespace(baseUri, ...localNames) as unknown as Vocabulary<T>;
}

export const SHACL = createVocabulary(
  "http://www.w3.org/ns/shacl#",
  "property",
  "path",
  "minCount",
  "maxCount",
  "minInclusive",
  "maxInclusive",
  "minExclusive",
  "maxExclusive",
  "pattern",
  "flags",
  "closed",
  "class",
  "datatype",
  "node",
  "or",
  "xone",
  "not"
);

export const SHEX = createVocabulary(
  "http://www.w3.org/ns/shex#",
  "predicate",
  "shapeExpr",
  "expression",
  "Shape",
  "expressions",
  "closed",
  "valueExpr",
  "nodeKind",
  "max",
  "min",
  "datatype",
  "mininclusive",
  "maxinclusive",
  "minexclusive",
  "maxexclusive",
  "pattern",
  "flags",
  "literal",
  "iri",
  "bnode",
  "nonliteral",
  "values",
  "EachOf",
  "OneOf"
);

export const RDF = createVocabulary(
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  "type",
  "first",
  "rest",
  "nil"
);

export const XSD = createVocabulary(
  "http://www.w3.org/2001/XMLSchema#",
  "string",
  "boolean",
  "decimal",
  "integer",
  "float",
  "double"
);
