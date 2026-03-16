import { Parser as SPARQLParser } from '@traqula/parser-sparql-1-1';
import { toAlgebra } from '@traqula/algebra-sparql-1-1';
import { ConstraintType, IShape, Shape } from '../lib/Shape';
import { IStarPatternWithDependencies, Triple } from '../lib/Triple';
import { ContainmentResult, IContainmentResult, IResult, StarPatternName, solveShapeQueryContainment } from '../lib/containment';
import { DataFactory } from 'rdf-data-factory';
import { BaseQuad } from '@rdfjs/types';
import { IQuery, generateQuery } from '../lib/query';
import { TYPE_DEFINITION } from '../lib/constant';
import type * as RDF from '@rdfjs/types';
import * as N3 from 'n3';
import { readFileSync } from 'fs';
import { streamifyArray } from 'streamify-array';
import { shexShapeFromQuads } from '../lib/shex';

const DF = new DataFactory<BaseQuad>();
const n3Parser = new N3.Parser();
const sparqlParser = new SPARQLParser();

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
                        type: ConstraintType.TYPE,
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
                    name: TYPE_DEFINITION.value,
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
                    name: TYPE_DEFINITION.value,
                    constraint: {
                        value: new Set(['<https://www.example.ca/Type>']),
                        type: ConstraintType.SHAPE
                    }
                }

            ], closed: true
        });

        it('should return an empty result given an empty query and no shape', () => {
            const query: IQuery = {
                starPatterns: new Map()
            };
            const shapes: IShape[] = [];
            const expectedResult: IResult = {

                starPatternsContainment: new Map(),
                visitShapeBoundedResource: new Map()
            };

            expect(solveShapeQueryContainment({ query, shapes })).toStrictEqual(expectedResult);
        });

        it('should reject every shape given an empty query', () => {
            const query: IQuery = {
                starPatterns: new Map()
            };
            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5];
            const expectedResult: IResult = {

                starPatternsContainment: new Map(),
                visitShapeBoundedResource: new Map(shapes.map((shape) => [shape.name, false]))
            };

            expect(solveShapeQueryContainment({ query, shapes })).toStrictEqual(expectedResult);
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
                    ["x", { result: ContainmentResult.CONTAIN, target: [shape.name], bindings:expect.any(Map) }]
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

        it('should handle a query contained in every shape', () => {
            const query = generateMatchingQuery();
            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5];

            const expectedStarPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                ["x", { result: ContainmentResult.CONTAIN, target: [shape.name], bindings:expect.any(Map) }],
                ["y", { result: ContainmentResult.DEPEND, target: ['foo1'], bindings:expect.any(Map) }],
                ["z", {
                    result: ContainmentResult.DEPEND, target: [
                        "foo2",
                    ],
                    bindings:expect.any(Map)
                }],
                ["w", { result: ContainmentResult.DEPEND, target: ['foo3'], bindings:expect.any(Map) }],
                ["w1", { result: ContainmentResult.DEPEND, target: ['foo4'], bindings:expect.any(Map) }],
                ["w2", {
                    result: ContainmentResult.DEPEND, target: [
                        "foo5",
                    ],
                    bindings:expect.any(Map)
                }],

            ]);
            const expectedResult: IResult = {

                starPatternsContainment: expectedStarPatternsContainment,
                visitShapeBoundedResource: new Map([
                    [shape.name, true],
                    [shapeP1.name, true],
                    [shapeP2.name, true],
                    [shapeP3.name, true],
                    [shapeP4.name, true],
                    [shapeP5.name, true]
                ])
            };

            expect(solveShapeQueryContainment({ query, shapes })).toStrictEqual(expectedResult);

        });

        it('should handle a query with partial containment', () => {
            const query = generateAlignedQuery();

            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5, shapeP6];

            const expectedStarPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                ["x", { result: ContainmentResult.REJECTED, bindings:expect.any(Map) }],
                ["y", { result: ContainmentResult.CONTAIN, target: [shape.name, shapeP1.name, shapeP2.name, shapeP3.name, shapeP4.name, shapeP5.name], bindings:expect.any(Map) }],
                ["z", { result: ContainmentResult.CONTAIN, target: [shape.name, shapeP2.name, shapeP3.name, shapeP4.name, shapeP5.name], bindings:expect.any(Map) }],
                ["w", { result: ContainmentResult.ALIGNED, target: [shapeP3.name, shapeP4.name], bindings:expect.any(Map) }],
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

            expect(solveShapeQueryContainment({ query, shapes })).toStrictEqual(expectedResult);

        });

        it('should handle a query with partial containment and a binding by a class', () => {
            const query = generateAlignedWithRdfTypeQuery();

            const shapes: IShape[] = [shape, shapeP1, shapeP2, shapeP3, shapeP4, shapeP5, shapeP7, shapeP8];

            const expectedStarPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                ["x", { result: ContainmentResult.REJECTED, bindings:expect.any(Map) }],
                ["y", { result: ContainmentResult.CONTAIN, target: [shapeP7.name, shapeP8.name], bindings:expect.any(Map) }],
                ["z", {
                    result: ContainmentResult.ALIGNED,
                    target: [shapeP7.name, shapeP8.name],
                    bindings:expect.any(Map)
                }],
                ["zz", {
                    result: ContainmentResult.ALIGNED,
                    target: [shapeP7.name, shapeP8.name],
                    bindings:expect.any(Map)
                }],
                ["w", { result: ContainmentResult.ALIGNED, target: [shapeP3.name, shapeP4.name], bindings:expect.any(Map) }],
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
                    result: ContainmentResult.ALIGNED,
                    bindings:expect.any(Map),
                    target: [shape.name, shapeP1.name, shapeP2.name, shapeP4.name, shapeP5.name]
                }],
                ["y", { result: ContainmentResult.CONTAIN, bindings:expect.any(Map), target: [shapeP1.name, shapeP2.name, shapeP5.name] }],
                ["z", { result: ContainmentResult.CONTAIN, bindings:expect.any(Map), target: [shape.name] }],
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
        
                ?y <${TYPE_DEFINITION.value}> <https://www.example.ca/Type> .
        
                ?z <${TYPE_DEFINITION.value}> <https://www.example.ca/Type> .
                ?z <https://www.example.ca/p0972> <https://www.example.ca/Type> .
                
                ?w <https://www.example.ca/p3> ?w1 .
                ?w <https://www.example.ca/p10> ?w1 .
        
                ?zz <${TYPE_DEFINITION.value}> <https://www.example.ca/Kipe> .
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
                    ["person", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Profile"], bindings:expect.any(Map), }],
                    ["city", { result: ContainmentResult.DEPEND, target: ["http://example.com#Comment", "http://example.com#Post", "http://example.com#Profile"], bindings:expect.any(Map), }]
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
                    ["person", { result: ContainmentResult.DEPEND, target: ["http://example.com#Profile"], bindings:expect.any(Map), }],
                    ["message", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["originalPost", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["originalPostInner", { result: ContainmentResult.DEPEND, target: ["http://example.com#Post"], bindings:expect.any(Map), }],
                    ["creator", { result: ContainmentResult.DEPEND, target: ["http://example.com#Profile"], bindings:expect.any(Map), }],
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
                    ["message", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
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
                    ["http://localhost:3000/pods/00000000000000000150/comments/Mexico#68719564521", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["creator", { result: ContainmentResult.DEPEND, target: ["http://example.com#Profile"], bindings:expect.any(Map), }]
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


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["message", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Post"], bindings:expect.any(Map), }],
                ]);


                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
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
                    ["message", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
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


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["message", { result: ContainmentResult.PARTIALY_CONTAIN, target: ["http://example.com#Post"], bindings:expect.any(Map), }],
                ]);


                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
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
                    ["message", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["tag", { result: ContainmentResult.DEPEND, target: undefined, bindings:expect.any(Map), }],
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
                    ["message", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment"], bindings:expect.any(Map), }],
                    ["location", { result: ContainmentResult.DEPEND, target: undefined, bindings:expect.any(Map), }],
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
                    ["message", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
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
                    ["message", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["forum",
                        {
                            result: ContainmentResult.ALIGNED,
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


                const visitShapeBoundedResource = new Map([
                    ["http://example.com#Comment", true],
                    ["http://example.com#Post", true],
                    ["http://example.com#Profile", true]
                ]);
                const starPatternsContainment = new Map<StarPatternName, IContainmentResult>([
                    ["message", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["forum", { result: ContainmentResult.REJECTED, bindings:expect.any(Map), }],
                    ["moderator", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Profile"], bindings:expect.any(Map), }],
                ]);

                expect(resp).toStrictEqual({ visitShapeBoundedResource, starPatternsContainment });
            });

            it('interactive-discover-8', async () => {
                const queryString = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
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
                                    } LIMIT 10`;
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
                    ["person", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Profile"], bindings:expect.any(Map), }],
                    ["message", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
                    ["otherMessage", { result: ContainmentResult.CONTAIN, target: ["http://example.com#Comment", "http://example.com#Post"], bindings:expect.any(Map), }],
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

