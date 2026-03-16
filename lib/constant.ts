import type { BaseQuad } from '@rdfjs/types';
import { DataFactory } from 'rdf-data-factory';

export const DF = new DataFactory<BaseQuad>();

export const SHEX_PREDICATE = DF.namedNode('http://www.w3.org/ns/shex#predicate');
export const SHEX_SHAPE_EXPRESSION = DF.namedNode('http://www.w3.org/ns/shex#shapeExpr');
export const SHEX_EXPRESSION = DF.namedNode('http://www.w3.org/ns/shex#expression');
export const SHEX_SHAPE = DF.namedNode('http://www.w3.org/ns/shex#Shape');
export const SHEX_EXPRESSIONS = DF.namedNode('http://www.w3.org/ns/shex#expressions');
export const SHEX_CLOSED_SHAPE = DF.namedNode('http://www.w3.org/ns/shex#closed');
export const SHEX_VALUE_EXPR = DF.namedNode('http://www.w3.org/ns/shex#valueExpr');
export const SHEX_NODE_KIND = DF.namedNode('http://www.w3.org/ns/shex#nodeKind');
export const SHEX_MAX = DF.namedNode('http://www.w3.org/ns/shex#max');
export const SHEX_MIN = DF.namedNode('http://www.w3.org/ns/shex#min');
export const SHEX_DATA_TYPE = DF.namedNode('http://www.w3.org/ns/shex#datatype');

export const SHEX_LITERAL = DF.namedNode('http://www.w3.org/ns/shex#literal');
export const SHEX_IRI = DF.namedNode('http://www.w3.org/ns/shex#iri');
export const SHEX_BNODE = DF.namedNode('http://www.w3.org/ns/shex#bnode');
export const SHEX_NON_LITERAL = DF.namedNode('http://www.w3.org/ns/shex#nonliteral');
export const SHEX_VALUES = DF.namedNode('http://www.w3.org/ns/shex#values');

export const SHEX_EACH_OF = DF.namedNode("http://www.w3.org/ns/shex#EachOf");
export const SHEX_ONE_OF = DF.namedNode("http://www.w3.org/ns/shex#OneOf");

export const TYPE_DEFINITION = DF.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
export const IRI_FIRST_RDF_LIST = DF.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#first');
export const IRI_REST_RDF_LIST = DF.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#rest');
export const IRI_END_RDF_LIST = DF.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#nil');
export const XSD_BOOLEAN = DF.namedNode('http://www.w3.org/2001/XMLSchema#boolean');
export const RDF_TRUE = DF.literal('true', XSD_BOOLEAN);

export const SHACL_SH = 'http://www.w3.org/ns/shacl#';
export const SHACL_PROPERTY = DF.namedNode(`${SHACL_SH}property`);
export const SHACL_PATH = DF.namedNode(`${SHACL_SH}path`);
export const SHACL_MIN_COUNT = DF.namedNode(`${SHACL_SH}minCount`);
export const SHACL_MAX_COUNT = DF.namedNode(`${SHACL_SH}maxCount`);
export const SHACL_CLOSED = DF.namedNode(`${SHACL_SH}closed`);
export const SHACL_CLASS = DF.namedNode(`${SHACL_SH}class`);
export const SHACL_DATATYPE = DF.namedNode(`${SHACL_SH}datatype`);
export const SHACL_NODE = DF.namedNode(`${SHACL_SH}node`);
export const SHACL_OR = DF.namedNode(`${SHACL_SH}or`);
export const SHACL_XONE = DF.namedNode(`${SHACL_SH}xone`);
export const SHACL_NOT = DF.namedNode(`${SHACL_SH}not`);
