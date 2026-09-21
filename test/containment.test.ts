import { Parser as SPARQLParser } from '@traqula/parser-sparql-1-1';
import { toAlgebra } from '@traqula/algebra-sparql-1-1';
import { describe, expect, it, test } from 'vitest';
import { ConstraintType, IShape, Shape } from '../lib/Shape';
import { IStarPatternWithDependencies, Triple } from '../lib/Triple';
import { ContainmentResult, EmptyQueryError, IContainmentResult, IResult as ContainmentReport, StarPatternName, solveShapeQueryContainment, solveShapeShapeContainment } from '../lib/containment';
import { DataFactory } from 'rdf-data-factory';
import { BaseQuad } from '@rdfjs/types';
import { IQuery, generateQuery } from '../lib/query';
import { RDF as RDF_VOCAB } from '../lib/constant';
import type * as RDF from '@rdfjs/types';
import * as N3 from 'n3';
import { readFileSync } from 'fs';
import { streamifyArray } from 'streamify-array';
import { shexShapeFromQuads } from '../lib/shex';
import { shaclShapeFromQuads } from '../lib/shacl';

const DF = new DataFactory<BaseQuad>();
const n3Parser = new N3.Parser();
const sparqlParser = new SPARQLParser();
type IResult = Omit<ContainmentReport, 'result'>;

describe('solveShapeQueryContainment', () => {

    describe('virtual use case', () => {
        const shape: Shape = new Shape({
            name: 'foo', positivePredicates: [
                {
                    name: "https://www.example.ca/p0",
                    constraint: {
                        value: new Set(['foo1']),
                        type: ConstraintType.SHAPE
                    }
                },
                {
                    name: "https://www.example.ca/p1",
                    constraint: {
                        value: new Set(['foo2']),
                        type: ConstraintType.SHAPE
                    }
                },
                {
                    name: "https://www.example.ca/p2",
                    constraint: {
                        value: new Set(['foo3']),
                        type: ConstraintType.SHAPE
                    }
                },
            ], closed: true
        });


        const shapeP1: Shape = new Shape({
            name: 'foo1', positivePredicates: [
                {
                    name: "https://www.example.ca/p1",
                    constraint: {
                        type: ConstraintType.DATATYPE,
                        value: new Set(["https://www.example.ca/t0"])
                    }
                }
            ], closed: true
        });

        const shapeP2: Shape = new Shape({
            name: 'foo2', positivePredicates: [
                "https://www.example.ca/p1",
                "https://www.example.ca/p2"
            ], closed: true
        });

        const shapeP3: Shape = new Shape({
            name: 'foo3', positivePredicates: [
                {
                    name: "https://www.example.ca/p1",
                    constraint: {
                        value: new Set(['foo4']),
                        type: ConstraintType.SHAPE
                    }
                },
                "https://www.example.ca/p3"
            ], closed: true
        });

        const shapeP4: Shape = new Shape({
            name: 'foo4', positivePredicates: [
                {
                    name: "https://www.example.ca/p1",
                    constraint: {
                        value: new Set(['foo5']),
                        type: ConstraintType.SHAPE
                    }
                },
                "https://www.example.ca/p2",
                "https://www.example.ca/p3"
            ], closed: true
        });

        const shapeP5: Shape = new Shape({
            name: 'foo5', positivePredicates: [
                "https://www.example.ca/p1"
            ], closed: true
        });

        const shapeP6: Shape = new Shape({
            name: 'foo6', positivePredicates: [
                "https://www.example.ca/p1000000"
            ], closed: true
        });

        const shapeP7: Shape = new Shape({
            name: 'foo7', positivePredicates: [
                {
                    name: RDF_VOCAB.type,
                    constraint: {
                        value: new Set(['<https://www.example.ca/Type>']),
                        type: ConstraintType.SHAPE
                    }
                }

            ], closed: true
        });

        const shapeP8: Shape = new Shape({
            name: 'foo8', positivePredicates: [
                {
                    name: RDF_VOCAB.type,
                    constraint: {
                        value: new Set(['<https://www.example.ca/Type>']),
                        type: ConstraintType.SHAPE
                    }
                }

            ], closed: true
        });

        /*********************************************************************
         * General tests cases
         * *******************************************************************/

        it('should throw given an empty query and no shape', () => {
            const query: IQuery = {
                starPatterns: new Map()
            };
            const shapes: IShape[] = [];

            // An empty query states no constraint, so no relevance degree can be assigned.
            // Reporting CONTAINED here would rank every resource maximally relevant on no evidence.
            expect(() => solveShapeQueryContainment({ query, shapes })).toThrow(EmptyQueryError);
        });

        it('should throw given an empty query and candidate shapes', () => {
            const query: IQuery = {
                starPatterns: new Map()
            };
            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5];

            expect(() => solveShapeQueryContainment({ query, shapes })).toThrow(EmptyQueryError);
        });

        it('should report the discarded constructs when a query falls outside the profile', () => {
            const query: IQuery = {
                starPatterns: new Map([
                    ["x", generateZStarPattern()]
                ]),
                unsupported: ['MINUS']
            };
            const shapes: IShape[] = [shape];

            expect(solveShapeQueryContainment({ query, shapes }).unsupported).toStrictEqual(['MINUS']);
        });

        it('should return an empty result given no shape', () => {

            const query: IQuery = {
                starPatterns: new Map([
                    ["x", generateZStarPattern()]
                ])
            };
            const shapes: IShape[] = [];
            const expectedResult: IResult = {

                starPatternsContainment: new Map([["x", { result: ContainmentResult.REJECTED, bindings:new Map() }]]),
                visitShapeBoundedResource: new Map()
            };

            expect(solveShapeQueryContainment({ query, shapes })).toStrictEqual(expectedResult);
        });

        it('should handle aligned triple pattern', () => {
            const xStarPattern = generateXStarPattern();
            const query: IQuery = {
                starPatterns: new Map([
                    ["x", xStarPattern]
                ])
            };
            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5];

            const expectedResult: IResult = {

                starPatternsContainment: new Map([
                    ["x", { result: ContainmentResult.CONTAINED, target: [shape.name], bindings:expect.any(Map) }]
                ]),
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                    [shapeP1.name, false],
                    [shapeP2.name, false],
                    [shapeP3.name, false],
                    [shapeP4.name, false],
                    [shapeP5.name, false]
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes })).toStrictEqual(expectedResult);
        });

        it('should handle unaligned triple pattern with term object', () => {
            const zStarPattern = generateZStarPattern();
            const query: IQuery = {
                starPatterns: new Map([
                    ["z", zStarPattern]
                ])
            };
            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5];

            const expectedResult: IResult = {
                starPatternsContainment: new Map([["z", { result: ContainmentResult.REJECTED, bindings: new Map() }]]),
                visitShapeBoundedResource: new Map([
                    [shape.name, false],
                    [shapeP1.name, false],
                    [shapeP2.name, false],
                    [shapeP3.name, false],
                    [shapeP4.name, false],
                    [shapeP5.name, false]
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes })).toStrictEqual(expectedResult);
        });

        it('should handle unaligned triple pattern', () => {
            const zStarPattern = generateZAlternatifStarPattern();
            const query: IQuery = {
                starPatterns: new Map([
                    ["z", zStarPattern]
                ])
            };
            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5];

            const expectedResult: IResult = {
                starPatternsContainment: new Map([["z", { result: ContainmentResult.REJECTED, bindings: new Map() }]]),
                visitShapeBoundedResource: new Map([
                    [shape.name, false],
                    [shapeP1.name, false],
                    [shapeP2.name, false],
                    [shapeP3.name, false],
                    [shapeP4.name, false],
                    [shapeP5.name, false]
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes })).toStrictEqual(expectedResult);
        });


        /*********************************************************************
         * Specific tests cases
         * *******************************************************************/
        it('should return WEAKLY_REJECTED when no triple matches on an open shape', () => {
            const zStarPattern = generateZAlternatifStarPattern();
            const query: IQuery = {
                starPatterns: new Map([
                    ["z", zStarPattern]
                ])
            };
            const openShape: IShape = new Shape({
                name: 'fooOpen',
                positivePredicates: [
                    'https://www.example.ca/p0'
                ],
                closed: false
            });

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["z", { result: ContainmentResult.WEAKLY_REJECTED, bindings: new Map() }]
                ]),
                visitShapeBoundedResource: new Map([
                    [openShape.name, false],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [openShape] })).toStrictEqual(expectedResult);
        });

        it('should return REJECTED when no triple matches on a closed shape', () => {
            const zStarPattern = generateZAlternatifStarPattern();
            const query: IQuery = {
                starPatterns: new Map([
                    ["z", zStarPattern]
                ])
            };
            const closedShape: IShape = new Shape({
                name: 'fooClosed',
                positivePredicates: [
                    'https://www.example.ca/p0'
                ],
                closed: true
            });

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["z", { result: ContainmentResult.REJECTED, bindings: new Map() }]
                ]),
                visitShapeBoundedResource: new Map([
                    [closedShape.name, false],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [closedShape] })).toStrictEqual(expectedResult);
        });

        it('should keep containment with FILTER regex and SHACL pattern constraint', async () => {
            const shapeIri = 'https://www.example.ca/patternShape';
            const shacl = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX sh: <http://www.w3.org/ns/shacl#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

            ex:patternShape a sh:NodeShape ;
                sh:property [
                    sh:path ex:nickname ;
                    sh:datatype xsd:string ;
                    sh:pattern "^foo"
                ] .
            `;
            const parsedShape = await shaclShapeFromQuads(n3Parser.parse(shacl), shapeIri);
            expect(parsedShape).not.toBeInstanceOf(Error);

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            SELECT * WHERE {
              ?s ex:nickname ?nickname .
              FILTER(regex(str(?nickname), "^foo"))
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);
            const shape = parsedShape as IShape;

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["s", { result: ContainmentResult.CONTAINED, target: [shape.name], bindings: expect.any(Map) }],
                ]),
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [shape] })).toStrictEqual(expectedResult);
        });

        it('should keep containment when SHACL pattern implies FILTER regex prefix', async () => {
            const shapeIri = 'https://www.example.ca/patternShape';
            const shacl = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX sh: <http://www.w3.org/ns/shacl#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

            ex:patternShape a sh:NodeShape ;
                sh:closed true ;
                sh:property [
                    sh:path ex:nickname ;
                    sh:datatype xsd:string ;
                    sh:pattern "^foo"
                ] .
            `;
            const parsedShape = await shaclShapeFromQuads(n3Parser.parse(shacl), shapeIri);
            expect(parsedShape).not.toBeInstanceOf(Error);

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            SELECT * WHERE {
              ?s ex:nickname ?nickname .
              FILTER(regex(str(?nickname), "^f"))
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);
            const shape = parsedShape as IShape;

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["s", { result: ContainmentResult.CONTAINED, target: [shape.name], bindings: expect.any(Map) }],
                ]),
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [shape] })).toStrictEqual(expectedResult);
        });

        it('should reject when FILTER regex contradicts SHACL pattern constraint', async () => {
            const shapeIri = 'https://www.example.ca/patternShape';
            const shacl = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX sh: <http://www.w3.org/ns/shacl#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

            ex:patternShape a sh:NodeShape ;
                sh:closed true ;
                sh:property [
                    sh:path ex:nickname ;
                    sh:datatype xsd:string ;
                    sh:pattern "^foo"
                ] .
            `;
            const parsedShape = await shaclShapeFromQuads(n3Parser.parse(shacl), shapeIri);
            expect(parsedShape).not.toBeInstanceOf(Error);

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            SELECT * WHERE {
              ?s ex:nickname ?nickname .
              FILTER(regex(str(?nickname), "^bar"))
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);
            const shape = parsedShape as IShape;

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["s", { result: ContainmentResult.REJECTED, bindings: new Map() }],
                ]),
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [shape] })).toStrictEqual(expectedResult);
        });

        it('should support FILTER datatype(?v) comparison with VALUES', () => {
            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
            SELECT * WHERE {
              ?x ex:p0 ?v .
              FILTER(datatype(?v) = xsd:integer)
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);
            const shapes: IShape[] = [shape];

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["x", { result: ContainmentResult.CONTAINED, target: [shape.name], bindings: expect.any(Map) }],
                ]),
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes })).toStrictEqual(expectedResult);
        });

        it('should keep containment with FILTER numeric comparison and SHACL datatype constraint', async () => {
            const shapeIri = 'https://www.example.ca/myShape';
            const shacl = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX sh: <http://www.w3.org/ns/shacl#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

            ex:myShape a sh:NodeShape ;
                sh:property [
                    sh:path ex:hasAge ;
                    sh:datatype xsd:integer ;
                    sh:minInclusive 15 ;
                    sh:maxInclusive 35
                ] .
            `;
            const parsedShape = await shaclShapeFromQuads(n3Parser.parse(shacl), shapeIri);
            expect(parsedShape).not.toBeInstanceOf(Error);

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            SELECT * WHERE {
              ?s ex:hasAge ?age .
              FILTER (?age > 18)
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);
            const shape = parsedShape as IShape;

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["s", { result: ContainmentResult.CONTAINED, target: [shape.name], bindings: expect.any(Map) }],
                ]),
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [shape] })).toStrictEqual(expectedResult);
        });

        it('should reject when FILTER numeric bound contradicts SHACL inclusive facets', async () => {
            const shapeIri = 'https://www.example.ca/myShape';
            const shacl = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX sh: <http://www.w3.org/ns/shacl#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

            ex:myShape a sh:NodeShape ;
                sh:closed true ;
                sh:property [
                    sh:path ex:hasAge ;
                    sh:datatype xsd:integer ;
                    sh:minInclusive 15 ;
                    sh:maxInclusive 35
                ] .
            `;
            const parsedShape = await shaclShapeFromQuads(n3Parser.parse(shacl), shapeIri);
            expect(parsedShape).not.toBeInstanceOf(Error);

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            SELECT * WHERE {
              ?s ex:hasAge ?age .
              FILTER (?age > 40)
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);
            const shape = parsedShape as IShape;

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["s", { result: ContainmentResult.REJECTED, bindings: new Map() }],
                ]),
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [shape] })).toStrictEqual(expectedResult);
        });

        it('should keep containment when VALUES literal respects SHACL numeric facets', async () => {
            const shapeIri = 'https://www.example.ca/myShape';
            const shacl = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX sh: <http://www.w3.org/ns/shacl#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

            ex:myShape a sh:NodeShape ;
                sh:closed true ;
                sh:property [
                    sh:path ex:hasAge ;
                    sh:datatype xsd:integer ;
                    sh:minInclusive 15 ;
                    sh:maxInclusive 35
                ] .
            `;
            const parsedShape = await shaclShapeFromQuads(n3Parser.parse(shacl), shapeIri);
            expect(parsedShape).not.toBeInstanceOf(Error);

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
            SELECT * WHERE {
              ?s ex:hasAge ?age .
              VALUES ?age { "20"^^xsd:integer }
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);
            const shape = parsedShape as IShape;

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["s", { result: ContainmentResult.CONTAINED, target: [shape.name], bindings: expect.any(Map) }],
                ]),
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [shape] })).toStrictEqual(expectedResult);
        });

        it('should reject when all VALUES literals violate SHACL numeric facets', async () => {
            const shapeIri = 'https://www.example.ca/myShape';
            const shacl = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX sh: <http://www.w3.org/ns/shacl#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

            ex:myShape a sh:NodeShape ;
                sh:closed true ;
                sh:property [
                    sh:path ex:hasAge ;
                    sh:datatype xsd:integer ;
                    sh:minInclusive 15 ;
                    sh:maxInclusive 35
                ] .
            `;
            const parsedShape = await shaclShapeFromQuads(n3Parser.parse(shacl), shapeIri);
            expect(parsedShape).not.toBeInstanceOf(Error);

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
            SELECT * WHERE {
              ?s ex:hasAge ?age .
              VALUES ?age { "10"^^xsd:integer "40"^^xsd:integer }
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);
            const shape = parsedShape as IShape;

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["s", { result: ContainmentResult.REJECTED, bindings: new Map() }],
                ]),
                visitShapeBoundedResource: new Map([
                    [shape.name, false],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [shape] })).toStrictEqual(expectedResult);
        });

        it('should reject when FILTER contradicts SHACL exclusive facets', async () => {
            const shapeIri = 'https://www.example.ca/myShape';
            const shacl = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX sh: <http://www.w3.org/ns/shacl#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

            ex:myShape a sh:NodeShape ;
                sh:closed true ;
                sh:property [
                    sh:path ex:hasAge ;
                    sh:datatype xsd:integer ;
                    sh:minExclusive 18 ;
                    sh:maxExclusive 35
                ] .
            `;
            const parsedShape = await shaclShapeFromQuads(n3Parser.parse(shacl), shapeIri);
            expect(parsedShape).not.toBeInstanceOf(Error);

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            SELECT * WHERE {
              ?s ex:hasAge ?age .
              FILTER (?age <= 18)
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);
            const shape = parsedShape as IShape;

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["s", { result: ContainmentResult.REJECTED, bindings: new Map() }],
                ]),
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [shape] })).toStrictEqual(expectedResult);
        });

        it('should reject numeric FILTER when SHACL datatype constraint is non-numeric', async () => {
            const shapeIri = 'https://www.example.ca/myShape';
            const shacl = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX sh: <http://www.w3.org/ns/shacl#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

            ex:myShape a sh:NodeShape ;
                sh:closed true ;
                sh:property [
                    sh:path ex:hasAge ;
                    sh:datatype xsd:string
                ] .
            `;
            const parsedShape = await shaclShapeFromQuads(n3Parser.parse(shacl), shapeIri);
            expect(parsedShape).not.toBeInstanceOf(Error);

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            SELECT * WHERE {
              ?s ex:hasAge ?age .
              FILTER (?age > 18)
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);
            const shape = parsedShape as IShape;

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["s", { result: ContainmentResult.REJECTED, bindings: new Map() }],
                ]),
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [shape] })).toStrictEqual(expectedResult);
        });

        it('should keep containment for CLASS-constrained named-node values', () => {
            const constrainedShape: IShape = new Shape({
                name: 'fooClassConstraint',
                positivePredicates: [
                    {
                        name: RDF_VOCAB.type,
                        constraint: {
                            type: ConstraintType.CLASS,
                            value: new Set(['https://www.example.ca/Person'])
                        }
                    }
                ],
                closed: true
            });

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            SELECT * WHERE {
                ?x rdf:type ex:Person .
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["x", { result: ContainmentResult.CONTAINED, target: [constrainedShape.name], bindings: expect.any(Map) }],
                ]),
                visitShapeBoundedResource: new Map([
                    [constrainedShape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [constrainedShape] })).toStrictEqual(expectedResult);
        });

        it('should keep containment for numeric FILTER compatible with datatype constraint', () => {
            const constrainedShape: IShape = new Shape({
                name: 'fooAgeRange',
                positivePredicates: [
                    {
                        name: 'https://www.example.ca/age',
                        constraint: {
                            type: ConstraintType.DATATYPE,
                            value: new Set(['http://www.w3.org/2001/XMLSchema#integer'])
                        }
                    }
                ],
                closed: true
            });

                        const queryString = `
                        PREFIX ex: <https://www.example.ca/>
                        SELECT * WHERE {
                            ?x ex:age ?age .
                            FILTER(?age > 18 && ?age <= 35)
                        }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["x", { result: ContainmentResult.CONTAINED, target: [constrainedShape.name], bindings: expect.any(Map) }],
                ]),
                visitShapeBoundedResource: new Map([
                    [constrainedShape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [constrainedShape] })).toStrictEqual(expectedResult);
        });

        it('should keep containment when FILTER value branch fails but datatype constraint is compatible', () => {
            const constrainedShape: IShape = new Shape({
                name: 'fooAgeRange',
                positivePredicates: [
                    {
                        name: 'https://www.example.ca/age',
                        constraint: {
                            type: ConstraintType.DATATYPE,
                            value: new Set(['http://www.w3.org/2001/XMLSchema#integer'])
                        }
                    }
                ],
                closed: true
            });

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
            SELECT * WHERE {
                ?x ex:age ?age .
                FILTER(?age > 18 && ?age <= 35)
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["x", { result: ContainmentResult.CONTAINED, target: [constrainedShape.name], bindings: expect.any(Map) }],
                ]),
                visitShapeBoundedResource: new Map([
                    [constrainedShape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [constrainedShape] })).toStrictEqual(expectedResult);
        });

        it('should keep containment when FILTER upper-bound branch fails but datatype constraint is compatible', () => {
            const constrainedShape: IShape = new Shape({
                name: 'fooAgeRange',
                positivePredicates: [
                    {
                        name: 'https://www.example.ca/age',
                        constraint: {
                            type: ConstraintType.DATATYPE,
                            value: new Set(['http://www.w3.org/2001/XMLSchema#integer'])
                        }
                    }
                ],
                closed: true
            });

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
            SELECT * WHERE {
              ?x ex:age ?age .
              FILTER(?age > 18 && ?age <= 35)
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["x", { result: ContainmentResult.CONTAINED, target: [constrainedShape.name], bindings: expect.any(Map) }],
                ]),
                visitShapeBoundedResource: new Map([
                    [constrainedShape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [constrainedShape] })).toStrictEqual(expectedResult);
        });

        it('should reject when numeric FILTER contradicts non-numeric shape datatype constraint', () => {
            const constrainedShape: IShape = new Shape({
                name: 'fooAgeString',
                positivePredicates: [
                    {
                        name: 'https://www.example.ca/age',
                        constraint: {
                            type: ConstraintType.DATATYPE,
                            value: new Set(['http://www.w3.org/2001/XMLSchema#string'])
                        }
                    }
                ],
                closed: true
            });

            const queryString = `
            PREFIX ex: <https://www.example.ca/>
            SELECT * WHERE {
              ?x ex:age ?age .
              FILTER(?age > 18)
            }`;
            const querySparql = toAlgebra(sparqlParser.parse(queryString));
            const query = generateQuery(querySparql);

            const expectedResult: IResult = {
                starPatternsContainment: new Map([
                    ["x", { result: ContainmentResult.REJECTED, bindings: new Map() }],
                ]),
                visitShapeBoundedResource: new Map([
                    [constrainedShape.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes: [constrainedShape] })).toStrictEqual(expectedResult);
        });

        it('should handle a query contained in every shape', () => {
            const query = generateMatchingQuery();
            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5];

            const resp = solveShapeQueryContainment({ query, shapes });
            expect(resp.starPatternsContainment.get("x")?.result).toBe(ContainmentResult.CONTAINED);
            expect(resp.starPatternsContainment.get("y")?.result).toBe(ContainmentResult.CONTAINED);
            expect(resp.starPatternsContainment.get("z")?.result).toBe(ContainmentResult.CONTAINED);
            expect(resp.starPatternsContainment.get("w")?.result).toBe(ContainmentResult.CONTAINED);
            expect(resp.starPatternsContainment.get("w1")?.result).toBe(ContainmentResult.CONTAINED);
            expect(resp.starPatternsContainment.get("w2")?.result).toBe(ContainmentResult.CONTAINED);
            expect(resp.result).toBe(ContainmentResult.CONTAINED);

            expect(resp.visitShapeBoundedResource).toStrictEqual(new Map([
                [shape.name, true],
                [shapeP1.name, true],
                [shapeP2.name, true],
                [shapeP3.name, true],
                [shapeP4.name, true],
                [shapeP5.name, true]
            ]));

        });

        it('should handle a query with partial containment', () => {
            const query = generateAlignedQuery();

            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5, shapeP6];

            const expectedStarPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                ["x", { result: ContainmentResult.UNALINGED, target: [shape.name, shapeP1.name, shapeP2.name, shapeP3.name, shapeP4.name, shapeP5.name], bindings:expect.any(Map) }],
                ["y", { result: ContainmentResult.CONTAINED, target: [shape.name, shapeP1.name, shapeP2.name, shapeP3.name, shapeP4.name, shapeP5.name], bindings:expect.any(Map) }],
                ["z", { result: ContainmentResult.CONTAINED, target: [shape.name, shapeP2.name, shapeP3.name, shapeP4.name, shapeP5.name], bindings:expect.any(Map) }],
                ["w", { result: ContainmentResult.UNALINGED, target: [shapeP3.name, shapeP4.name], bindings:expect.any(Map) }],
            ]);
            const expectedResult: IResult = {

                starPatternsContainment: expectedStarPatternsContainment,
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                    [shapeP1.name, true],
                    [shapeP2.name, true],
                    [shapeP3.name, true],
                    [shapeP4.name, true],
                    [shapeP5.name, true],
                    [shapeP6.name, false]
                ])
            };

            const result = solveShapeQueryContainment({ query, shapes });
            expect(result).toStrictEqual(expectedResult);
            expect(result.result).toBe(ContainmentResult.UNALINGED);

        });

        it('should handle a query with partial containment and a binding by a class', () => {
            const query = generateAlignedWithRdfTypeQuery();

            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5, shapeP7, shapeP8];

            const expectedStarPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                ["x", { result: ContainmentResult.UNALINGED, target: [shapeP7.name, shapeP8.name, shapeP3.name, shapeP4.name], bindings:expect.any(Map) }],
                ["y", { result: ContainmentResult.CONTAINED, target: [shapeP7.name, shapeP8.name], bindings:expect.any(Map) }],
                ["z", {
                    result: ContainmentResult.UNALINGED,
                    target: [shapeP7.name, shapeP8.name],
                    bindings:expect.any(Map)
                }],
                ["zz", {
                    result: ContainmentResult.UNALINGED,
                    target: [shapeP7.name, shapeP8.name],
                    bindings:expect.any(Map)
                }],
                ["w", { result: ContainmentResult.UNALINGED, target: [shapeP3.name, shapeP4.name], bindings:expect.any(Map) }],
            ]);
            const expectedResult: IResult = {
                starPatternsContainment: expectedStarPatternsContainment,
                visitShapeBoundedResource: new Map([
                    [shape.name, false],
                    [shapeP1.name, false],
                    [shapeP2.name, false],
                    [shapeP3.name, true],
                    [shapeP4.name, true],
                    [shapeP5.name, false],
                    [shapeP7.name, true],
                    [shapeP8.name, true],
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes, dependentShapes: [shapeP6] })).toStrictEqual(expectedResult);

        });

        it('should handle a query with cycle', () => {
            const query = generateQueryWithCycle();
            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5];

            const expectedStarPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                ["x", {
                    result: ContainmentResult.UNALINGED,
                    bindings:expect.any(Map),
                    target: [shape.name, shapeP1.name, shapeP2.name, shapeP4.name, shapeP5.name]
                }],
                ["y", { result: ContainmentResult.CONTAINED, bindings:expect.any(Map), target: [shapeP1.name, shapeP2.name, shapeP5.name] }],
                ["z", { result: ContainmentResult.CONTAINED, bindings:expect.any(Map), target: [shape.name] }],
            ]);
            const expectedResult: IResult = {

                starPatternsContainment: expectedStarPatternsContainment,
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                    [shapeP1.name, true],
                    [shapeP2.name, true],
                    [shapeP3.name, false],
                    [shapeP4.name, true],
                    [shapeP5.name, true]
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes })).toStrictEqual(expectedResult);

        });

        it('should support shape-to-shape containment through shapeToQuery wrapper', () => {
            const sourceShape: IShape = new Shape({
                name: 'https://www.example.ca/source',
                positivePredicates: [
                    {
                        name: RDF_VOCAB.type,
                        constraint: {
                            type: ConstraintType.CLASS,
                            value: new Set(['https://www.example.ca/Person'])
                        }
                    },
                    {
                        name: 'https://www.example.ca/age',
                        constraint: {
                            type: ConstraintType.DATATYPE,
                            value: new Set(['http://www.w3.org/2001/XMLSchema#integer']),
                            minInclusive: 18,
                            maxInclusive: 35
                        }
                    }
                ],
                closed: true,
            });

            const targetShape: IShape = new Shape({
                name: 'https://www.example.ca/target',
                positivePredicates: [
                    {
                        name: RDF_VOCAB.type,
                        constraint: {
                            type: ConstraintType.CLASS,
                            value: new Set(['https://www.example.ca/Person'])
                        }
                    },
                    {
                        name: 'https://www.example.ca/age',
                        constraint: {
                            type: ConstraintType.DATATYPE,
                            value: new Set(['http://www.w3.org/2001/XMLSchema#integer']),
                            minInclusive: 10,
                            maxInclusive: 40
                        }
                    }
                ],
                closed: true,
            });

            const result = solveShapeShapeContainment({
                sourceShape,
                targetShapes: [targetShape],
            });

            expect(result.starPatternsContainment.get(sourceShape.name)?.result).toBe(ContainmentResult.CONTAINED);
            expect(result.result).toBe(ContainmentResult.CONTAINED);
        });

        it('should support shape-to-shape containment with source linked shapes', () => {
            const childSource: IShape = new Shape({
                name: 'https://www.example.ca/sourceChild',
                positivePredicates: [
                    {
                        name: 'https://www.example.ca/nickname',
                        constraint: {
                            type: ConstraintType.DATATYPE,
                            value: new Set(['http://www.w3.org/2001/XMLSchema#string']),
                            pattern: '^a'
                        }
                    }
                ],
                closed: true,
            });

            const sourceShape: IShape = new Shape({
                name: 'https://www.example.ca/sourceRoot',
                positivePredicates: [
                    {
                        name: 'https://www.example.ca/knows',
                        constraint: {
                            type: ConstraintType.SHAPE,
                            value: new Set([childSource.name])
                        }
                    }
                ],
                closed: true,
            });

            const childTarget: IShape = new Shape({
                name: childSource.name,
                positivePredicates: [
                    {
                        name: 'https://www.example.ca/nickname',
                        constraint: {
                            type: ConstraintType.DATATYPE,
                            value: new Set(['http://www.w3.org/2001/XMLSchema#string']),
                            pattern: '^a'
                        }
                    }
                ],
                closed: true,
            });

            const targetShape: IShape = new Shape({
                name: 'https://www.example.ca/targetRoot',
                positivePredicates: [
                    {
                        name: 'https://www.example.ca/knows',
                        constraint: {
                            type: ConstraintType.SHAPE,
                            value: new Set([childTarget.name])
                        }
                    }
                ],
                closed: true,
            });

            const result = solveShapeShapeContainment({
                sourceShape,
                sourceLinkedShapes: [childSource],
                targetShapes: [targetShape, childTarget],
            });

            expect(result.starPatternsContainment.get(sourceShape.name)?.result).toBe(ContainmentResult.CONTAINED);
            expect(result.result).toBe(ContainmentResult.CONTAINED);
        });

        function generateMatchingQuery(): IQuery {
            const queryString = `
            SELECT * WHERE { 
                ?x <https://www.example.ca/p0> ?y .
                ?x <https://www.example.ca/p1> ?z .
                ?x <https://www.example.ca/p2> ?w .
        
                ?y <https://www.example.ca/p1> "foo"^^<https://www.example.ca/t0> .
        
                ?z <https://www.example.ca/p1> "abc" .
                
                ?w <https://www.example.ca/p1> ?w1 .
                
                ?w1 <https://www.example.ca/p1> ?w2 .
        
                ?w2 <https://www.example.ca/p1> "bar"
              }
            `;
            const querySparql = toAlgebra(sparqlParser.parse(queryString))


            return generateQuery(querySparql);
        }

        function generateQueryWithCycle(): IQuery {
            const queryString = `
            SELECT * WHERE { 
                ?x <https://www.example.ca/p0> ?y .
                ?x <https://www.example.ca/p1> ?z .
                ?x <https://www.example.ca/p2> ?w .
        
                ?y <https://www.example.ca/p1> ?x .

                ?z <https://www.example.ca/p0> "abc" .

              }
            `;
            const querySparql = toAlgebra(sparqlParser.parse(queryString))


            return generateQuery(querySparql);
        }

        function generateAlignedQuery(): IQuery {
            const queryString = `
            SELECT * WHERE { 
                ?x <https://www.example.ca/p7> ?y .
                ?x <https://www.example.ca/p6> ?z .
                ?x <https://www.example.ca/p5> ?w .
        
                ?y <https://www.example.ca/p1> "foo"^^<https://www.example.ca/t0> .
        
                ?z <https://www.example.ca/p1> "abc" .
                
                ?w <https://www.example.ca/p3> ?w1 .
                ?w <https://www.example.ca/p10> ?w1 .
              }
            `;
            const querySparql = toAlgebra(sparqlParser.parse(queryString))


            return generateQuery(querySparql);
        }

        function generateAlignedWithRdfTypeQuery(): IQuery {
            const queryString = `
            SELECT * WHERE { 
                ?x <https://www.example.ca/p7> ?y .
                ?x <https://www.example.ca/p6> ?z .
                ?x <https://www.example.ca/p5> ?w .
        
                ?y <${RDF_VOCAB.type}> <https://www.example.ca/Type> .
        
                ?z <${RDF_VOCAB.type}> <https://www.example.ca/Type> .
                ?z <https://www.example.ca/p0972> <https://www.example.ca/Type> .
                
                ?w <https://www.example.ca/p3> ?w1 .
                ?w <https://www.example.ca/p10> ?w1 .
        
                ?zz <${RDF_VOCAB.type}> <https://www.example.ca/Kipe> .
                ?zz <https://www.example.ca/p0972> <https://www.example.ca/IDK> .
              }
            `;
            const querySparql = toAlgebra(sparqlParser.parse(queryString))


            return generateQuery(querySparql);
        }

        function generateXStarPattern(): IStarPatternWithDependencies {
            const triple1: Triple = new Triple({
                subject: 'x',
                predicate: 'https://www.example.ca/p0',
                object: DF.literal('o0', DF.namedNode("https://www.example.ca/t0"))
            });


            const starPattern: IStarPatternWithDependencies = {
                starPattern: new Map([
                    [
                        triple1.predicate,
                        {
                            triple: triple1,
                            dependencies: undefined
                        }
                    ],
                ]),
                name: "x",
                isVariable: true,

            };

            return starPattern;
        }

        function generateZStarPattern(): IStarPatternWithDependencies {
            const triple1: Triple = new Triple({
                subject: 'z',
                predicate: 'p99',
                object: DF.literal('o0', DF.namedNode("https://www.example.ca/t0"))
            });


            const starPattern: IStarPatternWithDependencies = {
                starPattern: new Map([
                    [
                        triple1.predicate,
                        {
                            triple: triple1,
                            dependencies: undefined
                        }
                    ],
                ]),
                name: "z",
                isVariable: true,

            };

            return starPattern;
        }

        function generateZAlternatifStarPattern(): IStarPatternWithDependencies {
            const triple1: Triple = new Triple({
                subject: 'z',
                predicate: 'p99',
                object: DF.namedNode('foo')
            });


            const starPattern: IStarPatternWithDependencies = {
                starPattern: new Map([
                    [
                        triple1.predicate,
                        {
                            triple: triple1,
                            dependencies: undefined
                        }
                    ],
                ]),
                name: "z",
                isVariable: true,

            };

            return starPattern;
        }

    });

    describe('real use case', () => {
        describe('short', () => {
            test('interactive-short-1', async () => {
                const queryString = `
                # Profile of a person
                PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
                PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
                PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
                PREFIX sn: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/data/>
                PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                PREFIX sntag: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/tag/>
                PREFIX foaf: <http://xmlns.com/foaf/0.1/>
                PREFIX dbpedia: <http://localhost:3000/dbpedia.org/resource/>
                PREFIX dbpedia-owl: <http://localhost:3000/dbpedia.org/ontology/>
                
                SELECT
                    ?firstName
                    ?lastName
                    ?birthday
                    ?locationIP
                    ?browserUsed
                    ?cityId
                    ?gender
                    ?creationDate
                WHERE
                {
                    ?person a snvoc:Person .
                    ?person snvoc:id ?personId .
                    ?person snvoc:firstName ?firstName .
                    ?person snvoc:lastName ?lastName .
                    ?person snvoc:gender ?gender .
                    ?person snvoc:birthday ?birthday .
                    ?person snvoc:creationDate ?creationDate .
                    ?person snvoc:locationIP ?locationIP .
                    ?person snvoc:isLocatedIn ?city .
                    ?city snvoc:id ?cityId .
                    ?person snvoc:browserUsed ?browserUsed .
                }`;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["person", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Profile"], bindings:expect.any(Map), }],
                    ["city", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment", "http://example.com#Post", "http://example.com#Profile"], bindings:expect.any(Map), }]
                ]);


                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
            });

            test('interactive-short-2', async () => {
                const queryString = `
                # Recent messages of a person
                PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
                PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
                PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
                PREFIX sn: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/data/>
                PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                PREFIX sntag: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/tag/>
                PREFIX foaf: <http://xmlns.com/foaf/0.1/>
                PREFIX dbpedia: <http://localhost:3000/dbpedia.org/resource/>
                PREFIX dbpedia-owl: <http://localhost:3000/dbpedia.org/ontology/>

                SELECT
                    ?messageId
                    ?messageContent
                    ?messageCreationDate
                    ?originalPostId
                    ?originalPostAuthorId
                    ?originalPostAuthorFirstName
                    ?originalPostAuthorLastName
                WHERE {
                    ?person a snvoc:Person .
                    ?person snvoc:id ?personId .
                    ?message snvoc:hasCreator ?person .
                    ?message snvoc:content|snvoc:imageFile ?messageContent .
                    ?message snvoc:creationDate ?messageCreationDate .
                    ?message snvoc:id ?messageId .
                    OPTIONAL {
                        ?message snvoc:replyOf* ?originalPostInner .
                        ?originalPostInner a snvoc:Post .
                    } .
                    BIND( COALESCE(?originalPostInner, ?message) AS ?originalPost ) .
                    ?originalPost snvoc:id ?originalPostId .
                    ?originalPost snvoc:hasCreator ?creator .
                    ?creator snvoc:firstName ?originalPostAuthorFirstName .
                    ?creator snvoc:lastName ?originalPostAuthorLastName .
                    ?creator snvoc:id ?originalPostAuthorId .
                }
                LIMIT 10
                `;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["person", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Profile"], bindings:expect.any(Map), }],
                    ["message", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["originalPost", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["originalPostInner", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Post"], bindings:expect.any(Map), }],
                    ["creator", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Profile"], bindings:expect.any(Map), }],
                ]);


                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
            });

            test('interactive-short-4', async () => {
                const queryString = `
                PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
                PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
                PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
                PREFIX sn: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/data/>
                PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                PREFIX sntag: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/tag/>
                PREFIX foaf: <http://xmlns.com/foaf/0.1/>
                PREFIX dbpedia: <http://localhost:3000/dbpedia.org/resource/>
                PREFIX dbpedia-owl: <http://localhost:3000/dbpedia.org/ontology/>

                SELECT
                    ?messageCreationDate
                    ?messageContent
                WHERE
                {
                    ?message snvoc:id ?messageId .
                    ?message snvoc:creationDate ?messageCreationDate .
                    ?message snvoc:content|snvoc:imageFile ?messageContent .
                }`;

                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["message", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                ]);


                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
            });

            test('interactive-short-5', async () => {
                const queryString = `PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                SELECT ?personId ?firstName ?lastName WHERE {
                  <http://localhost:3000/pods/00000000000000000150/comments/Mexico#68719564521> snvoc:id ?messageId;
                    snvoc:hasCreator ?creator.
                  ?creator snvoc:id ?personId;
                    snvoc:firstName ?firstName;
                    snvoc:lastName ?lastName.
                }`;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["http://localhost:3000/pods/00000000000000000150/comments/Mexico#68719564521", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["creator", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Profile"], bindings:expect.any(Map), }]
                ]);


                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
            });
        });

        describe('discover', () => {
            test('interactive-discover-1', async () => {
                const queryString = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
                PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                SELECT ?messageId ?messageCreationDate ?messageContent WHERE {
                  ?message snvoc:hasCreator <http://localhost:3000/pods/00000000000000000933/profile/card#me>;
                    rdf:type snvoc:Post;
                    snvoc:content ?messageContent;
                    snvoc:creationDate ?messageCreationDate;
                    snvoc:id ?messageId.
                }`;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                expect(resp.visitShapeBoundedResource).toStrictEqual(new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]));

                const messageContainment = resp.starPatternsContainment.get("message");
                expect(messageContainment).toBeDefined();
                expect([ContainmentResult.CONTAINED, ContainmentResult.UNALINGED]).toContain(messageContainment!.result);
                expect(messageContainment!.target).toEqual(expect.arrayContaining(["http://example.com#Post"]));
            });

            test('interactive-discover-2', async () => {
                const queryString = `
                PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
                PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
                PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
                PREFIX sn: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/data/>
                PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                PREFIX sntag: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/tag/>
                PREFIX foaf: <http://xmlns.com/foaf/0.1/>
                PREFIX dbpedia: <http://localhost:3000/dbpedia.org/resource/>
                PREFIX dbpedia-owl: <http://localhost:3000/dbpedia.org/ontology/>
                

                SELECT
                    ?messageId
                    ?messageCreationDate
                    ?messageContent
                WHERE
                {
                    ?message snvoc:hasCreator ?person;
                        snvoc:content ?messageContent;
                        snvoc:creationDate ?messageCreationDate;
                        snvoc:id ?messageId.
                    { ?message rdf:type snvoc:Post } UNION { ?message rdf:type snvoc:Comment }
                }
                `;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["message", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                ]);


                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
            });

            test('interactive-discover-2 comment missing', async () => {
                const queryString = `
                PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
                PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
                PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
                PREFIX sn: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/data/>
                PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                PREFIX sntag: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/tag/>
                PREFIX foaf: <http://xmlns.com/foaf/0.1/>
                PREFIX dbpedia: <http://localhost:3000/dbpedia.org/resource/>
                PREFIX dbpedia-owl: <http://localhost:3000/dbpedia.org/ontology/>

                SELECT
                    ?messageId
                    ?messageCreationDate
                    ?messageContent
                WHERE
                {
                    ?message snvoc:hasCreator ?person;
                        snvoc:content ?messageContent;
                        snvoc:creationDate ?messageCreationDate;
                        snvoc:id ?messageId.
                    { ?message rdf:type snvoc:Post } UNION { ?message rdf:type snvoc:Comment }
                }
                `;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = [];
                for (const [shapeName, shape] of shapeIndexed) {
                    if (shapeName !== "http://example.com#Comment") {
                        shapes.push(shape);
                    }
                }

                const resp = solveShapeQueryContainment({ query, shapes, decidingShapes: new Set(["http://example.com#Post", "http://example.com#Profile"]) });


                expect(resp.visitShapeBoundedResource).toStrictEqual(new Map([
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]));

                const messageContainment = resp.starPatternsContainment.get("message");
                expect(messageContainment?.result).toBe(ContainmentResult.UNALINGED);
                expect(messageContainment?.target).toEqual(expect.arrayContaining(["http://example.com#Post", "http://example.com#Profile"]));
            });

            test('interactive-discover-3', async () => {
                const queryString = `PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                PREFIX foaf: <http://xmlns.com/foaf/0.1/>
                SELECT ?tagName (COUNT(?message) AS ?messages) WHERE {
                  ?message snvoc:hasCreator <http://localhost:3000/pods/00000000000000000933/profile/card#me>;
                    snvoc:hasTag ?tag.
                  ?tag foaf:name ?tagName.
                }
                GROUP BY ?tagName
                ORDER BY DESC (?messages)`;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", false]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["message", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["tag", { result: ContainmentResult.REJECTED, target: undefined, bindings:expect.any(Map), }],
                ]);

                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
            });

            test('interactive-discover-4', async () => {
                const queryString = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
                PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                PREFIX foaf: <http://xmlns.com/foaf/0.1/>
                SELECT ?locationName (COUNT(?message) AS ?messages) WHERE {
                  ?message snvoc:hasCreator <http://localhost:3000/pods/00000000000000000933/profile/card#me>;
                    rdf:type snvoc:Comment;
                    snvoc:isLocatedIn ?location.
                  ?location foaf:name ?locationName.
                }
                GROUP BY ?locationName
                ORDER BY DESC (?messages)`;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["message", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment"], bindings:expect.any(Map), }],
                    ["location", { result: ContainmentResult.REJECTED, target: undefined, bindings:expect.any(Map), }],
                ]);

                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
            });

            test('interactive-discover-5', async () => {
                const queryString = `PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                SELECT DISTINCT ?locationIp WHERE {
                  ?message snvoc:hasCreator <http://localhost:3000/pods/00000000000000000933/profile/card#me>;
                    snvoc:locationIP ?locationIp.
                }`;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["message", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                ]);

                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
            });

            it('interactive-discover-6', async () => {
                const queryString = `PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                SELECT DISTINCT ?forumId ?forumTitle WHERE {
                  ?message snvoc:hasCreator <http://localhost:3000/pods/00000000000000000933/profile/card#me>.
                  ?forum snvoc:containerOf ?message;
                    snvoc:id ?forumId;
                    snvoc:title ?forumTitle.
                }`;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["message", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["forum",
                        {
                            result: ContainmentResult.UNALINGED,
                            target: ["http://example.com#Comment", "http://example.com#Post", "http://example.com#Profile"],
                            bindings:expect.any(Map),
                        }
                    ],
                ]);

                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
            });

            it('interactive-discover-7', async () => {
                const queryString = `PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                SELECT DISTINCT ?firstName ?lastName WHERE {
                  ?message snvoc:hasCreator <http://localhost:3000/pods/00000000000000000933/profile/card#me>.
                  ?forum snvoc:containerOf ?message;
                    snvoc:hasModerator ?moderator.
                  ?moderator snvoc:firstName ?firstName;
                    snvoc:lastName ?lastName.
                }`;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                expect(resp.visitShapeBoundedResource).toStrictEqual(new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]));

                expect(resp.starPatternsContainment.get("message")?.result).toBe(ContainmentResult.CONTAINED);
                expect(resp.starPatternsContainment.get("forum")?.result).toBe(ContainmentResult.UNALINGED);
                expect(resp.starPatternsContainment.get("forum")?.target).toEqual(expect.arrayContaining(["http://example.com#Profile"]));
                expect(resp.starPatternsContainment.get("moderator")?.result).toBe(ContainmentResult.CONTAINED);
            });

            it('interactive-discover-8', async () => {
                const queryString = `
                    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
                    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
                    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
                    PREFIX sn: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/data/>
                    PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
                    PREFIX sntag: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/tag/>
                    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
                    PREFIX dbpedia: <http://localhost:3000/dbpedia.org/resource/>
                    PREFIX dbpedia-owl: <http://localhost:3000/dbpedia.org/ontology/>

                    SELECT
                    DISTINCT
                        ?creator
                        ?messageContent
                    WHERE
                    {
                        ?person snvoc:likes [ snvoc:hasPost|snvoc:hasComment ?message ].
                        ?message snvoc:hasCreator ?creator.
                        ?otherMessage snvoc:hasCreator ?creator;
                            snvoc:content ?messageContent.
                    } LIMIT 10
                `;
                const querySparql = toAlgebra(sparqlParser.parse(queryString))
                const query = generateQuery(querySparql);

                const shapeIndexed: Map<string, IShape> = await generateSolidBenchShapes();
                const shapes: IShape[] = Array.from(shapeIndexed.values());

                const resp = solveShapeQueryContainment({ query, shapes });


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["person", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Profile"], bindings:expect.any(Map), }],
                    ["message", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["otherMessage", { result: ContainmentResult.CONTAINED, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                ]);

                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
            });
        });

        async function generateSolidBenchShapes(): Promise<Map<string, IShape>> {
            const commentShapeFile = "./test/shape/solidbench_comment.ttl";
            const postShapeFile = "./test/shape/solidbench_post.ttl";
            const profileShapeFile = "./test/shape/solidbench_profile.ttl";

            const commentShape = await shexShapeFromQuads(populateStream(commentShapeFile), "http://example.com#Comment");
            const postShape = await shexShapeFromQuads(populateStream(postShapeFile), "http://example.com#Post");
            const profileShape = await shexShapeFromQuads(populateStream(profileShapeFile), "http://example.com#Profile");
            if ((commentShape instanceof Error) || (postShape instanceof Error) || (profileShape instanceof Error)) {
                throw commentShape
            }

            return new Map([
                [commentShape.name, commentShape],
                [postShape.name, postShape],
                [profileShape.name, profileShape]
            ]);
        }

        function populateStream(source: string | RDF.Quad[]): any {
            let quads;
            if (Array.isArray(source)) {
                quads = source;
            } else {
                quads = n3Parser.parse(readFileSync(source).toString());
            }
            return streamifyArray(quads);
        }
    })
});


describe('supported profile and explicit negation', () => {
    const P = `PREFIX foaf: <http://xmlns.com/foaf/0.1/>
               PREFIX ex: <http://example.org/>`;

    async function classify(rawQuery: string, rawShape: string): Promise<ContainmentResult> {
        const query = generateQuery(toAlgebra(new SPARQLParser().parse(`${P} ${rawQuery}`)));
        const candidate = await shaclShapeFromQuads(new N3.Parser().parse(rawShape), 'http://example.org/S');
        return solveShapeQueryContainment({ query, shapes: [candidate] }).result;
    }

    const SHAPE_PREFIXES = `@prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix foaf: <http://xmlns.com/foaf/0.1/> .
        @prefix ex: <http://example.org/> .`;

    const openNameShape = `${SHAPE_PREFIXES}
        <http://example.org/S> a sh:NodeShape ;
            sh:property [ sh:path foaf:name ] .`;

    const closedNameShape = `${SHAPE_PREFIXES}
        <http://example.org/S> a sh:NodeShape ;
            sh:closed true ;
            sh:property [ sh:path foaf:name ] .`;

    describe('OPTIONAL patterns', () => {
        const query = 'SELECT * WHERE { ?s foaf:name ?n . OPTIONAL { ?s ex:age ?a } }';

        it('should not let an unmatched OPTIONAL pattern block containment on an open shape', async () => {
            expect(await classify(query, openNameShape)).toBe(ContainmentResult.CONTAINED);
        });

        it('should classify the same query identically on the closed counterpart of the shape', async () => {
            expect(await classify(query, closedNameShape)).toBe(ContainmentResult.CONTAINED);
        });

        it('should not consider a star pattern of only unmatched OPTIONAL patterns contained', async () => {
            expect(await classify('SELECT * WHERE { OPTIONAL { ?s ex:email ?e } }', openNameShape))
                .toBe(ContainmentResult.WEAKLY_REJECTED);
        });
    });

    describe('discarded constructs', () => {
        it('should not let a MINUS block lower the result', async () => {
            expect(await classify('SELECT * WHERE { ?s foaf:name ?n . MINUS { ?s ex:age ?a } }', closedNameShape))
                .toBe(ContainmentResult.CONTAINED);
        });

        it('should not let a MINUS block raise the result', async () => {
            expect(await classify('SELECT * WHERE { ?s ex:unknown ?x . MINUS { ?s foaf:name ?n } }', closedNameShape))
                .toBe(ContainmentResult.REJECTED);
        });

        it('should not let a SERVICE clause raise the result', async () => {
            expect(await classify('SELECT * WHERE { ?s ex:unknown ?x . SERVICE <http://x.example/sp> { ?s foaf:name ?n } }', closedNameShape))
                .toBe(ContainmentResult.REJECTED);
        });

        it('should record the discarded constructs on the query', () => {
            const query = generateQuery(toAlgebra(new SPARQLParser().parse(
                `${P} SELECT * WHERE { ?s foaf:name ?n . MINUS { ?s ex:age ?a } }`)));
            expect(query.unsupported).toStrictEqual(['MINUS']);
        });

        it('should throw when every triple pattern came from a discarded construct', () => {
            const query = generateQuery(toAlgebra(new SPARQLParser().parse(
                `${P} SELECT * WHERE { SERVICE <http://x.example/sp> { ?s foaf:name ?n } }`)));
            expect(query.starPatterns.size).toBe(0);
            expect(query.unsupported).toStrictEqual(['SERVICE']);
            expect(() => solveShapeQueryContainment({ query, shapes: [] })).toThrow(EmptyQueryError);
        });
    });

    describe('queries that ask for every triple', () => {
        // `?s ?p ?o` is maximally unselective rather than unanswerable: it asks for every triple of
        // the resource, so any resource is relevant and the honest result is CONTAINED.
        async function report(rawQuery: string) {
            const query = generateQuery(toAlgebra(new SPARQLParser().parse(`${P} ${rawQuery}`)));
            const candidate = await shaclShapeFromQuads(new N3.Parser().parse(closedNameShape), 'http://example.org/S');
            return { query, result: solveShapeQueryContainment({ query, shapes: [candidate] }) };
        }

        it('should report CONTAINED for an unrestricted triple pattern', async () => {
            const { query, result } = await report('SELECT * WHERE { ?s ?p ?o }');
            expect(query.matchesAnyTriple).toBe(true);
            expect(query.unsupported).toBeUndefined();
            expect(result.result).toBe(ContainmentResult.CONTAINED);
        });

        it('should report CONTAINED for an unrestricted OPTIONAL triple pattern', async () => {
            const { result } = await report('SELECT * WHERE { OPTIONAL { ?s ?p ?o } }');
            expect(result.result).toBe(ContainmentResult.CONTAINED);
        });

        it('should mark every candidate shape visitable, since the query wants all their triples', async () => {
            const { result } = await report('SELECT * WHERE { ?s ?p ?o }');
            expect([...result.visitShapeBoundedResource.values()]).toStrictEqual([true]);
        });

        it('should still throw when there is no triple pattern at all', () => {
            const query = generateQuery(toAlgebra(new SPARQLParser().parse('SELECT ?x WHERE { VALUES ?x { 1 2 } }')));
            expect(query.matchesAnyTriple).toBeUndefined();
            expect(() => solveShapeQueryContainment({ query, shapes: [] })).toThrow(EmptyQueryError);
        });
    });

    describe('sh:not', () => {
        const notShape = `${SHAPE_PREFIXES}
            <http://example.org/S> a sh:NodeShape ;
                sh:property [ sh:path foaf:name ] ;
                sh:not [ sh:path ex:secret ] .`;

        it('should reject a predicate the shape explicitly forbids, even on an open shape', async () => {
            expect(await classify('SELECT * WHERE { ?s ex:secret ?x }', notShape))
                .toBe(ContainmentResult.REJECTED);
        });

        it('should still match the positive predicates of the same shape', async () => {
            expect(await classify('SELECT * WHERE { ?s foaf:name ?n }', notShape))
                .toBe(ContainmentResult.CONTAINED);
        });
    });
});

describe('dependency-only shapes', () => {
    // `dependentShapes` carries shapes that are not candidates themselves but are referenced by
    // sh:node from a candidate. They must be resolvable, otherwise the constraint is treated as
    // satisfied (Bindings.handleShapeConstraint returns RESPECT for an unknown linked shape) and
    // the root star pattern binds on a dependency that was never checked.
    const shapesTtl = `
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix foaf: <http://xmlns.com/foaf/0.1/> .
        @prefix ex: <http://example.org/> .

        ex:A a sh:NodeShape ; sh:closed true ;
            sh:property [ sh:path ex:knows ; sh:node ex:B ] .

        ex:B a sh:NodeShape ; sh:closed true ;
            sh:property [ sh:path foaf:name ] .`;

    // Same shapes with ex:A open. Resolving sh:node only asks whether the nested star pattern is
    // fully bound by ex:B, so ex:B's own openness never changes the outcome; ex:A's does, because
    // it decides between the two rejection degrees once the root triple fails to bind.
    const openRootShapesTtl = shapesTtl.replace('ex:A a sh:NodeShape ; sh:closed true ;', 'ex:A a sh:NodeShape ;');

    const PREFIXES = `PREFIX foaf: <http://xmlns.com/foaf/0.1/> PREFIX ex: <http://example.org/>`;

    async function rootResultFor(rawQuery: string, useDependentShapes: boolean, ttl: string = shapesTtl): Promise<ContainmentResult> {
        const query = generateQuery(toAlgebra(new SPARQLParser().parse(`${PREFIXES} ${rawQuery}`)));
        const quads = new N3.Parser().parse(ttl);
        const candidate = await shaclShapeFromQuads(quads, 'http://example.org/A');
        const linked = await shaclShapeFromQuads(quads, 'http://example.org/B');
        const report = solveShapeQueryContainment({
            query,
            shapes: [candidate],
            ...(useDependentShapes ? { dependentShapes: [linked] } : {}),
        });
        return report.starPatternsContainment.get('p')!.result;
    }

    const nonFitting = 'SELECT * WHERE { ?p ex:knows ?f . ?f ex:somethingElse ?x }';
    const fitting = 'SELECT * WHERE { ?p ex:knows ?f . ?f foaf:name ?n }';

    it('should check the dependency when the referenced shape is supplied', async () => {
        expect(await rootResultFor(nonFitting, true)).toBe(ContainmentResult.REJECTED);
    });

    it('should bind the root when the nested pattern fits the referenced shape', async () => {
        expect(await rootResultFor(fitting, true)).toBe(ContainmentResult.CONTAINED);
    });

    it('should weakly reject rather than reject when the referring shape is open', async () => {
        expect(await rootResultFor(nonFitting, true, openRootShapesTtl)).toBe(ContainmentResult.WEAKLY_REJECTED);
    });

    it('should bind the root on a fitting nested pattern whatever the referring shape is', async () => {
        expect(await rootResultFor(fitting, true, openRootShapesTtl)).toBe(ContainmentResult.CONTAINED);
    });

    it('should over-estimate when the referenced shape is unavailable', async () => {
        // Documents the remaining approximation: with no way to resolve ex:B the sh:node
        // constraint cannot be refuted, so the root binds even though the nested pattern does not fit.
        expect(await rootResultFor(nonFitting, false)).toBe(ContainmentResult.CONTAINED);
    });
});

describe('nested dependencies and partial matches', () => {
    // ex:PersonShape is closed and declares foaf:knows, constrained by sh:node ex:FriendShape.
    // Whether the nested pattern is refuted depends on ex:FriendShape: closed, it forbids anything
    // it does not declare; open, it is merely silent.
    const shapesTtl = (friendClosed: boolean) => `
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix foaf: <http://xmlns.com/foaf/0.1/> .
        @prefix ex: <http://example.org/> .

        ex:PersonShape a sh:NodeShape ; sh:closed true ;
            sh:property [ sh:path foaf:knows ; sh:node ex:FriendShape ] .

        ex:FriendShape a sh:NodeShape ; ${friendClosed ? 'sh:closed true ;' : ''}
            sh:property [ sh:path foaf:name ] .`;

    const PREFIXES = `PREFIX foaf: <http://xmlns.com/foaf/0.1/> PREFIX ex: <http://example.org/>`;
    // foaf:mbox is not declared by ex:FriendShape; foaf:name is.
    const NOT_DECLARED = 'SELECT * WHERE { ?p foaf:knows ?f . ?f foaf:mbox ?m }';
    const DECLARED = 'SELECT * WHERE { ?p foaf:knows ?f . ?f foaf:name ?n }';

    async function classify(rawQuery: string, friendClosed: boolean, asDependency: boolean) {
        const query = generateQuery(toAlgebra(new SPARQLParser().parse(`${PREFIXES} ${rawQuery}`)));
        const quads = new N3.Parser().parse(shapesTtl(friendClosed));
        const person = await shaclShapeFromQuads(quads, 'http://example.org/PersonShape');
        const friend = await shaclShapeFromQuads(quads, 'http://example.org/FriendShape');
        const report = asDependency
            ? solveShapeQueryContainment({ query, shapes: [person], dependentShapes: [friend] })
            : solveShapeQueryContainment({ query, shapes: [person, friend] });
        return {
            root: report.starPatternsContainment.get('p')!.result,
            nested: report.starPatternsContainment.get('f')!.result,
            aggregate: report.result,
        };
    }

    describe('a dependency that is undecided rather than refuted', () => {
        it('should leave the root partially matched on the closed referring shape', async () => {
            // foaf:knows is declared by the closed ex:PersonShape, so the root pattern did match it.
            // Only the nested pattern is unresolved, and open ex:FriendShape does not forbid it.
            for (const asDependency of [true, false]) {
                const { root } = await classify(NOT_DECLARED, false, asDependency);
                expect(root).toBe(ContainmentResult.UNALINGED);
            }
        });

        it('should not make the resource omittable', async () => {
            for (const asDependency of [true, false]) {
                const { aggregate } = await classify(NOT_DECLARED, false, asDependency);
                expect(aggregate).toBe(ContainmentResult.WEAKLY_REJECTED);
                expect(aggregate).not.toBe(ContainmentResult.REJECTED);
            }
        });
    });

    describe('a dependency that is genuinely refuted', () => {
        it('should stay rejected, so a closed shape graph can still prune', async () => {
            for (const asDependency of [true, false]) {
                const { root, aggregate } = await classify(NOT_DECLARED, true, asDependency);
                expect(root).toBe(ContainmentResult.REJECTED);
                expect(aggregate).toBe(ContainmentResult.REJECTED);
            }
        });
    });

    describe('a nested pattern governed by a dependency-only shape', () => {
        it('should be classified against the shape that governs it, not only the candidates', async () => {
            // Without this the nested pattern is judged against ex:PersonShape alone, which never
            // describes it, and a fully satisfiable query comes out REJECTED.
            for (const friendClosed of [false, true]) {
                const { nested, aggregate } = await classify(DECLARED, friendClosed, true);
                expect(nested).toBe(ContainmentResult.CONTAINED);
                expect(aggregate).toBe(ContainmentResult.CONTAINED);
            }
        });

        it('should classify identically however the referenced shape is passed', async () => {
            for (const query of [NOT_DECLARED, DECLARED]) {
                for (const friendClosed of [false, true]) {
                    expect(await classify(query, friendClosed, true))
                        .toStrictEqual(await classify(query, friendClosed, false));
                }
            }
        });
    });
});
