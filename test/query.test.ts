import type { BaseQuad, Term, Variable } from '@rdfjs/types';
import { DataFactory } from 'rdf-data-factory';
import { Parser as SPARQLParser } from '@traqula/parser-sparql-1-1';
import { toAlgebra } from '@traqula/algebra-sparql-1-1';
import { TYPE_DEFINITION } from '../lib/constant';
import { generateQuery, generateStarPatternUnion, IQuery } from '../lib/query';
import { type IStarPatternWithDependencies, Triple } from '../lib/Triple';

const DF = new DataFactory<BaseQuad>();
const sparqlParser = new SPARQLParser();

const RDF_STRING = DF.namedNode('http://www.w3.org/2001/XMLSchema#string');
const SNVOC_PREFIX = 'http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/';
const FOAF_PREFIX = 'http://xmlns.com/foaf/0.1/';
const RDF_TYPE = TYPE_DEFINITION.value;

describe('query', () => {
  describe('generateQuery', () => {

    describe("simple queries", () => {
      it('should return the triple given a query with one triple', () => {
        const query = 'SELECT * WHERE { ?x <http://exemple.ca> ?z }';
        const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));
        expect(resp.starPatterns.size).toBe(1);
        const x = resp.starPatterns.get('x')!.starPattern;
        expect(x).toBeDefined();
        const element = x.get('http://exemple.ca')!;
        element.triple
        expect(element.triple.predicate).toBe('http://exemple.ca');
        expect((element.triple.object as any).termType).toBe('Variable');
        expect((element.triple.object as any).value).toBe('z');
      });

      it('should return the triple given a query with two triples where one triple have a dependence', () => {
        const query = `SELECT * WHERE { 
          ?x <http://exemple.ca> ?z .
          ?y <http://exemple.be> ?x .
        }`;

        const xStarPattern: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,
          }
        ];
        const yStarPattern: [string, IStarPatternWithDependencies] = ['y',
          {
            starPattern: new Map(
              [
                ['http://exemple.be',
                  {
                    triple: new Triple({
                      subject: 'y',
                      predicate: 'http://exemple.be',
                      object: DF.variable('x')
                    }),
                    dependencies: xStarPattern[1]
                  }
                ]
              ]
            ),
            name: "y",
            isVariable: true,
          }
        ];
        const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
          xStarPattern,
          yStarPattern,
        ]);

        const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

        expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
        expect(resp.filterExpression).toBe('');
        for (const [subject, starPatterns] of resp.starPatterns) {
          expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
        }

      });

      it('should return the triple given a query with nested dependence', () => {
        const query = `SELECT * WHERE { 
          ?x <http://exemple.be> ?y .
          ?x <http://exemple.ca> ?w .
          ?y <http://exemple.be> ?z .
          ?z <http://exemple.be> ?w .
        }`;

        const zStarPattern: [string, IStarPatternWithDependencies] = ['z',
          {
            starPattern: new Map([
              [
                'http://exemple.be',
                {
                  triple: new Triple({
                    subject: 'z',
                    predicate: 'http://exemple.be',
                    object: DF.variable('w')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "z",
            isVariable: true,

          }
        ];

        const yStarPattern: [string, IStarPatternWithDependencies] = ['y',
          {
            starPattern: new Map([
              [
                'http://exemple.be',
                {
                  triple: new Triple({
                    subject: 'y',
                    predicate: 'http://exemple.be',
                    object: DF.variable('z')
                  }),
                  dependencies: zStarPattern[1]
                }
              ]
            ]),
            name: "y",
            isVariable: true,

          }
        ];

        const xStarPattern: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.be',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.be',
                    object: DF.variable('y')
                  }),
                  dependencies: yStarPattern[1]
                }
              ],
              [
                'http://exemple.ca',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca',
                    object: DF.variable('w')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
          xStarPattern,
          yStarPattern,
          zStarPattern,
        ]);

        const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

        expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
        expect(resp.filterExpression).toBe('');
        for (const [subject, starPatterns] of resp.starPatterns) {
          expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
        }

      });

      it('should return the triple given a query with optional', () => {
        const query = `SELECT * WHERE { 
          ?x <http://exemple.be> ?y .
          ?x <http://exemple.ca> ?w .
          ?y <http://exemple.be> ?z .
          ?z <http://exemple.be> ?w .
          OPTIONAL {
          ?xo <http://exemple.be> "1" .
          ?yo <http://exemple.be> "2" .
          } .
        }`;

        const zStarPattern: [string, IStarPatternWithDependencies] = ['z',
          {
            starPattern: new Map([
              [
                'http://exemple.be',
                {
                  triple: new Triple({
                    subject: 'z',
                    predicate: 'http://exemple.be',
                    object: DF.variable('w')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "z",
            isVariable: true,
          }
        ];

        const yStarPattern: [string, IStarPatternWithDependencies] = ['y',
          {
            starPattern: new Map([
              [
                'http://exemple.be',
                {
                  triple: new Triple({
                    subject: 'y',
                    predicate: 'http://exemple.be',
                    object: DF.variable('z')
                  }),
                  dependencies: zStarPattern[1]
                }
              ]
            ]),
            name: "y",
            isVariable: true,

          }
        ];

        const xStarPattern: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.be',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.be',
                    object: DF.variable('y')
                  }),
                  dependencies: yStarPattern[1]
                }
              ],
              [
                'http://exemple.ca',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca',
                    object: DF.variable('w')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const xStarPatternO: [string, IStarPatternWithDependencies] = ['xo',
          {
            starPattern: new Map([
              [
                'http://exemple.be',
                {
                  triple: new Triple({
                    subject: 'xo',
                    predicate: 'http://exemple.be',
                    object: DF.literal('1', RDF_STRING),
                    isOptional: true
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "xo",
            isVariable: true,

          }
        ];

        const yStarPatternO: [string, IStarPatternWithDependencies] = ['yo',
          {
            starPattern: new Map([
              [
                'http://exemple.be',
                {
                  triple: new Triple({
                    subject: 'yo',
                    predicate: 'http://exemple.be',
                    object: DF.literal('2', RDF_STRING),
                    isOptional: true
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "yo",
            isVariable: true,

          }
        ];
        const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
          xStarPattern,
          yStarPattern,
          zStarPattern,
          xStarPatternO,
          yStarPatternO
        ]);

        const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

        expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
        expect(resp.filterExpression).toBe('');
        for (const [subject, starPatterns] of resp.starPatterns) {
          expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
        }

      });

      it('should return no triple given a query with a bgp with only variable', () => {
        const query = 'SELECT * WHERE { ?x ?o ?z }';
        const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));
        expect(resp.starPatterns.size).toBe(0);
      });

      it('should returns the triples given a query with multiple triples', () => {
        const query = `SELECT * WHERE { 
                  ?x ?o ?z .
                  ?x <http://exemple.ca> ?z .
                  ?z <http://exemple.be> "abc" .
                  ?z <http://exemple.qc.ca> "abc" .
                  ?w <http://exemple.be> <http://objet.fr> .
                  <http://sujet.cm> <http://predicat.cm> "def" .
                  <http://sujet.cm> ?m "def" .
              }`;



        const zStarPattern: [string, IStarPatternWithDependencies] = [
          'z',
          {
            starPattern: new Map([
              [
                'http://exemple.be',
                {
                  triple: new Triple({ subject: 'z', predicate: 'http://exemple.be', object: DF.literal('abc', RDF_STRING) }),
                  dependencies: undefined
                }
              ],
              [
                'http://exemple.qc.ca',
                {
                  triple: new Triple({ subject: 'z', predicate: 'http://exemple.qc.ca', object: DF.literal('abc', RDF_STRING) }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "z",
            isVariable: true,

          }
        ];

        const xStarPattern: [string, IStarPatternWithDependencies] = [
          'x',
          {
            starPattern: new Map([
              ['http://exemple.ca',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca',
                    object: DF.variable('z')
                  }),
                  dependencies: zStarPattern[1]
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const wStarPattern: [string, IStarPatternWithDependencies] = [
          'w',
          {
            starPattern: new Map([
              [
                'http://exemple.be',
                {
                  triple: new Triple({ subject: 'w', predicate: 'http://exemple.be', object: DF.namedNode('http://objet.fr') }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "w",
            isVariable: true,

          }
        ];
        const sujetStarPattern: [string, IStarPatternWithDependencies] = [
          'http://sujet.cm',
          {
            starPattern: new Map([
              ['http://predicat.cm',
                {
                  triple: new Triple({
                    subject: 'http://sujet.cm',
                    predicate: 'http://predicat.cm',
                    object: DF.literal('def', RDF_STRING),
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "http://sujet.cm",
            isVariable: false,

          }
        ];
        const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
          xStarPattern,
          zStarPattern,
          wStarPattern,
          sujetStarPattern
        ]);

        const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

        expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
        expect(resp.filterExpression).toBe('');
        for (const [subject, starPatterns] of resp.starPatterns) {
          expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
        }
      });

      it('should return the subject group with a VALUES clause', () => {
        const query = `
        SELECT * WHERE
        {
            VALUES (?type ?person) {(UNDEF <http://exemple.be/Person>) (<http://exemple.be/Post> <http://exemple.be/Persoon>)}
  
            ?x a ?person .
            ?y <http://exemple.be> ?type .
        }
        `;

        const xStarPattern: [string, IStarPatternWithDependencies] = [
          'x',
          {
            starPattern: new Map([
              [
                RDF_TYPE,
                {
                  triple: new Triple({
                    subject: 'x', predicate: RDF_TYPE, object: [
                      DF.namedNode('http://exemple.be/Person'),
                      DF.namedNode('http://exemple.be/Persoon')
                    ]
                  }),
                  dependencies: undefined
                }
              ],
            ]),
            name: "x",
            isVariable: true,

          }
        ];
        const yStarPattern: [string, IStarPatternWithDependencies] = [
          'y',
          {
            starPattern: new Map([
              [
                'http://exemple.be',
                {
                  triple: new Triple({
                    subject: 'y',
                    predicate: 'http://exemple.be',
                    object: [DF.namedNode('http://exemple.be/Post')]
                  }),
                  dependencies: undefined
                }
              ],
            ]),
            name: "y",
            isVariable: true,

          }
        ];

        const expectedStarPattern = new Map<string, any>([
          xStarPattern,
          yStarPattern
        ]);

        const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

        expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
        expect(resp.filterExpression).toBe('');
        for (const [subject, starPatterns] of resp.starPatterns) {
          expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
        }
      });
    });

    describe('query with property path', () => {
      describe('AlternativePaths', () => {
        it("should handle a simple AlternativePath", () => {
          const query = `
              PREFIX snvoc: <http://exemple.be#>
              SELECT
                  *
              WHERE {
                  ?message snvoc:content|snvoc:imageFile ?messageContent .
                  ?message snvoc:creationDate ?messageCreationDate .
              } LIMIT 10`;


          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#creationDate',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#creationDate',
                      object: DF.variable('messageCreationDate')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const contentUnionStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#content',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#content',
                      object: DF.variable('messageContent')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const imageFileUnionStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#imageFile',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#imageFile',
                      object: DF.variable('messageContent')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const expectedUnions = [
            new Map<string, any>([
              contentUnionStarPattern,
            ]),
            new Map<string, any>([
              imageFileUnionStarPattern,
            ]),
          ];

          const expectedStarPattern = new Map<string, any>([
            messageStarPattern,
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
          }

          expect(resp.union).toBeDefined();
          expect(resp.union?.length).toBe(1);

          const union = resp.union![0];
          expect(union.length).toBe(2);
          for (let i = 0; i < union.length; i++) {
            const unionQuery = union[i];
            const expectedUnion = expectedUnions[i];

            for (const [subject, starPatterns] of unionQuery.starPatterns) {
              expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedUnion.get(subject));
            }
          }

        });

        it("should handle an AlternativePath with a negative predicate", () => {
          const query = `
              PREFIX snvoc: <http://exemple.be#>
              SELECT
                  *
              WHERE {
                  ?message snvoc:content|!snvoc:imageFile ?messageContent .
                  ?message snvoc:creationDate ?messageCreationDate .
              } LIMIT 10`;


          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#creationDate',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#creationDate',
                      object: DF.variable('messageCreationDate')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const contentUnionStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#content',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#content',
                      object: DF.variable('messageContent')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const imageFileUnionStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  Triple.NEGATIVE_PREDICATE_SET,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: Triple.NEGATIVE_PREDICATE_SET,
                      negatedSet: new Set(['http://exemple.be#imageFile']),
                      object: DF.variable('messageContent')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const expectedUnions = [
            new Map<string, any>([
              contentUnionStarPattern,
            ]),
            new Map<string, any>([
              imageFileUnionStarPattern,
            ]),
          ];

          const expectedStarPattern = new Map<string, any>([
            messageStarPattern,
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
          }

          expect(resp.union).toBeDefined();
          expect(resp.union?.length).toBe(1);

          const union = resp.union![0];
          expect(union.length).toBe(2);
          for (let i = 0; i < union.length; i++) {
            const unionQuery = union[i];
            const expectedUnion = expectedUnions[i];

            for (const [subject, starPatterns] of unionQuery.starPatterns) {
              expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedUnion.get(subject));
            }
          }

        });

        it("should handle a star pattern with only a AlternativePath", () => {
          const query = `
              PREFIX snvoc: <http://exemple.be#>
              SELECT
                  *
              WHERE {
                  ?message snvoc:content|snvoc:imageFile ?messageContent .
                  ?messageContent snvoc:content  snvoc:content.
              } LIMIT 10`;

          const messageContentStarPattern: [string, IStarPatternWithDependencies] = [
            'messageContent',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#content',
                  {
                    triple: new Triple({
                      subject: 'messageContent',
                      predicate: 'http://exemple.be#content',
                      object: DF.namedNode('http://exemple.be#content')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "messageContent",
              isVariable: true,

            }
          ];

          const unionMessageContentStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#content',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#content',
                      object: DF.variable('messageContent')
                    }),
                    dependencies: messageContentStarPattern[1]
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const unionMessageImageFileStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#imageFile',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#imageFile',
                      object: DF.variable('messageContent')
                    }),
                    dependencies: messageContentStarPattern[1]
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const expectedStarPattern = new Map<string, any>([
            messageContentStarPattern
          ]);

          const expectedUnions = [
            new Map<string, any>([
              unionMessageContentStarPattern,
            ]),
            new Map<string, any>([
              unionMessageImageFileStarPattern,
            ]),
          ];

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
          }

          expect(resp.union).toBeDefined();
          expect(resp.union?.length).toBe(1);
          const union = resp.union![0];
          expect(union.length).toBe(2);
          for (let i = 0; i < union.length; i++) {
            const unionQuery = union[i];
            const expectedUnion = expectedUnions[i];

            for (const [subject, starPatterns] of unionQuery.starPatterns) {
              expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedUnion.get(subject));
            }
          }
        });

        it("should handle an AlternativePath", () => {
          const query = `
              PREFIX snvoc: <http://exemple.be#>
              SELECT
                  *
              WHERE {
                  ?message snvoc:content|snvoc:imageFile|snvoc:bar ?messageContent .
                  ?message snvoc:creationDate ?messageCreationDate .
              } LIMIT 10`;

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#creationDate',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#creationDate',
                      object: DF.variable('messageCreationDate')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const unionMessageContentStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#content',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#content',
                      object: DF.variable('messageContent')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const unionMessageImageFileStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#imageFile',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#imageFile',
                      object: DF.variable('messageContent')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const unionMessageBarStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#bar',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#bar',
                      object: DF.variable('messageContent')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const expectedStarPattern = new Map<string, any>([
            messageStarPattern,
          ]);

          const expectedUnions = [
            new Map<string, any>([
              unionMessageContentStarPattern,
            ]),
            new Map<string, any>([
              unionMessageImageFileStarPattern,
            ]),
            new Map<string, any>([
              unionMessageBarStarPattern,
            ]),
          ];

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
          }

          expect(resp.union).toBeDefined();
          expect(resp.union?.length).toBe(1);
          const union = resp.union![0];
          expect(union.length).toBe(3);
          for (let i = 0; i < union.length; i++) {
            const unionQuery = union[i];
            const expectedUnion = expectedUnions[i];

            for (const [subject, starPatterns] of unionQuery.starPatterns) {
              expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedUnion.get(subject));
            }
          }
        });

        it("should handle a multiple AlternativePaths", () => {
          const query = `
              PREFIX snvoc: <http://exemple.be#>
              SELECT
                  *
              WHERE {
                  ?message snvoc:content+|snvoc:imageFile|snvoc:bar ?messageContent .
                  ?message snvoc:creationDate ?messageCreationDate .
                  ?message snvoc:content|snvoc:imageFile ?somethingElse .
              } LIMIT 10`;

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#creationDate',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#creationDate',
                      object: DF.variable('messageCreationDate')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const unionMessageContentStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#content',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#content',
                      object: DF.variable('messageContent'),
                      cardinality: { min: 1, max: -1 }
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const unionMessageImageFileStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#imageFile',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#imageFile',
                      object: DF.variable('messageContent')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const unionMessageBarStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#bar',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#bar',
                      object: DF.variable('messageContent')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const union2MessageContentStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#content',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#content',
                      object: DF.variable('somethingElse')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const union2MessageImageFileStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#imageFile',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#imageFile',
                      object: DF.variable('somethingElse')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const expectedStarPattern = new Map<string, any>([
            messageStarPattern,
          ]);

          const expectedUnions = [
            new Map<string, any>([
              unionMessageContentStarPattern,
            ]),
            new Map<string, any>([
              unionMessageImageFileStarPattern,
            ]),
            new Map<string, any>([
              unionMessageBarStarPattern,
            ]),
          ];

          const expectedUnions2 = [
            new Map<string, any>([
              union2MessageContentStarPattern,
            ]),
            new Map<string, any>([
              union2MessageImageFileStarPattern,
            ])
          ];

          const expectedMultipleUnions = [
            expectedUnions,
            expectedUnions2
          ];

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
          }

          expect(resp.union).toBeDefined();
          expect(resp.union?.length).toBe(2);
          for (let i = 0; i < resp.union!.length; i++) {
            const union = resp.union![i];
            const expectedUnions = expectedMultipleUnions[i]
            expect(union.length).toBe(expectedUnions.length);

            for (let j = 0; j < union.length; j++) {
              const unionQuery = union[j];
              const expectedUnion = expectedUnions[j];

              for (const [subject, starPatterns] of unionQuery.starPatterns) {
                expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedUnion.get(subject));
              }
            }
          }

        });
      });

      describe("cardinality property path", () => {
        it("should handle a simple ZeroOrMorePath cardinality", () => {
          const query = `
              PREFIX snvoc: <http://exemple.be#>

              SELECT
                  *
              WHERE {
                  ?message snvoc:id ?id .
                  OPTIONAL {
                      ?message snvoc:replyOf* ?originalPostInner .
                      ?originalPostInner a snvoc:Post .
                  } .
              }
              LIMIT 10`;

          const originalPostInnerPattern: [string, IStarPatternWithDependencies] = [
            'originalPostInner',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'originalPostInner',
                      predicate: RDF_TYPE,
                      object: DF.namedNode('http://exemple.be#Post'),
                      isOptional: true
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "originalPostInner",
              isVariable: true,

            }
          ];


          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#id',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#id',
                      object: DF.variable('id'),
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  'http://exemple.be#replyOf',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#replyOf',
                      object: DF.variable('originalPostInner'),
                      cardinality: { min: 0, max: -1 },
                      isOptional: true
                    }),
                    dependencies: originalPostInnerPattern[1]
                  }
                ],
              ]),
              name: "message",
              isVariable: true,

            }
          ];


          const expectedStarPattern = new Map<string, any>([
            messageStarPattern,
            originalPostInnerPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
          }
        });

        it("should handle a simple OneOrMorePath cardinality", () => {
          const query = `
              PREFIX snvoc: <http://exemple.be#>

              SELECT
                  *
              WHERE {
                  ?message snvoc:id ?id .
                  OPTIONAL {
                      ?message snvoc:replyOf+ ?originalPostInner .
                      ?originalPostInner a snvoc:Post .
                  } .
              }
              LIMIT 10`;

          const originalPostInnerPattern: [string, IStarPatternWithDependencies] = [
            'originalPostInner',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'originalPostInner',
                      predicate: RDF_TYPE,
                      object: DF.namedNode('http://exemple.be#Post'),
                      isOptional: true
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "originalPostInner",
              isVariable: true,

            }
          ];


          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#id',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#id',
                      object: DF.variable('id')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  'http://exemple.be#replyOf',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#replyOf',
                      object: DF.variable('originalPostInner'),
                      cardinality: { min: 1, max: -1 },
                      isOptional: true
                    }),
                    dependencies: originalPostInnerPattern[1]
                  }
                ],
              ]),
              name: "message",
              isVariable: true,

            }
          ];


          const expectedStarPattern = new Map<string, any>([
            messageStarPattern,
            originalPostInnerPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
          }
        });

        it("should handle a simple ZeroOrOnePath cardinality", () => {
          const query = `
              PREFIX snvoc: <http://exemple.be#>

              SELECT
                  *
              WHERE {
                  ?message snvoc:id ?id .
                  OPTIONAL {
                      ?message snvoc:replyOf? ?originalPostInner .
                      ?originalPostInner a snvoc:Post .
                  } .
              }
              LIMIT 10`;

          const originalPostInnerPattern: [string, IStarPatternWithDependencies] = [
            'originalPostInner',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'originalPostInner',
                      predicate: RDF_TYPE,
                      object: DF.namedNode('http://exemple.be#Post'),
                      isOptional: true
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "originalPostInner",
              isVariable: true,

            }
          ];


          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  'http://exemple.be#id',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#id',
                      object: DF.variable('id')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  'http://exemple.be#replyOf',
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: 'http://exemple.be#replyOf',
                      object: DF.variable('originalPostInner'),
                      cardinality: { min: 0, max: 1 },
                      isOptional: true
                    }),
                    dependencies: originalPostInnerPattern[1]
                  }
                ],
              ]),
              name: "message",
              isVariable: true,

            }
          ];


          const expectedStarPattern = new Map<string, any>([
            messageStarPattern,
            originalPostInnerPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
          }
        });
      });

      describe("negated property path", () => {
        it("should handle a single negation", () => {
          const query = `
              PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
              PREFIX snvoc: <http://exemple.be#>


              SELECT
                  *
              WHERE
              {
                  ?message !snvoc:replyOf ?person;
              }`;

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  Triple.NEGATIVE_PREDICATE_SET,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: Triple.NEGATIVE_PREDICATE_SET,
                      object: DF.variable('person'),
                      negatedSet: new Set(["http://exemple.be#replyOf"])
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,

            }
          ];


          const expectedStarPattern = new Map<string, any>([
            messageStarPattern,
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
          }
        });

        it("should handle a group negation", () => {
          const query = `
              PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
              PREFIX snvoc: <http://exemple.be#>


              SELECT
                  *
              WHERE
              {
                  ?message !(snvoc:foo|snvoc:bar|snvoc:boo) ?originalPostInner.
                  ?originalPostInner a snvoc:Post .
              }`;

          const originalPostInnerPattern: [string, IStarPatternWithDependencies] = [
            'originalPostInner',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'originalPostInner',
                      predicate: RDF_TYPE,
                      object: DF.namedNode('http://exemple.be#Post')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "originalPostInner",
              isVariable: true,

            }
          ];
          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  Triple.NEGATIVE_PREDICATE_SET,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: Triple.NEGATIVE_PREDICATE_SET,
                      object: DF.variable('originalPostInner'),
                      negatedSet: new Set([
                        "http://exemple.be#foo",
                        "http://exemple.be#bar",
                        "http://exemple.be#boo"
                      ])
                    }),
                    dependencies: originalPostInnerPattern[1]
                  }
                ],
              ]),
              name: "message",
              isVariable: true,

            }
          ];


          const expectedStarPattern = new Map<string, any>([
            messageStarPattern,
            originalPostInnerPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
          }
        });
      });

      describe('multiple property path', () => {

        describe("sequence", () => {
          test('alternative with sequence', () => {
            const query = `PREFIX snvoc: <http://exemple.be#>

                SELECT
                    *
                WHERE {
                    ?message (snvoc:test1/snvoc:test2)|snvoc:test3 ?foo .
              }`;

            const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

            const test1seq1 = DF.blankNode("http://exemple.be#test1_message");
            const test1Seq1StarPattern: [string, IStarPatternWithDependencies] = [
              'message',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test1',
                    {
                      triple: new Triple({
                        subject: 'message',
                        predicate: 'http://exemple.be#test1',
                        object: test1seq1,
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "message",
                isVariable: true,
              }
            ];

            const test1Seq2StarPattern: [string, IStarPatternWithDependencies] = [
              test1seq1.value,
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test2',
                    {
                      triple: new Triple({
                        subject: test1seq1.value,
                        predicate: 'http://exemple.be#test2',
                        object: DF.variable('foo')
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: test1seq1.value,
                isVariable: false,
              }
            ];


            const starPatternUnionOption1 = new Map([test1Seq1StarPattern, test1Seq2StarPattern]);

            const test3StarPattern: [string, IStarPatternWithDependencies] = [
              'message',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test3',
                    {
                      triple: new Triple({
                        subject: 'message',
                        predicate: 'http://exemple.be#test3',
                        object: DF.variable("foo")
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "message",
                isVariable: true,
              }
            ];

            const starPatternUnionOption2 = new Map([test3StarPattern]);

            const expectedQueries = [
              starPatternUnionOption1,
              starPatternUnionOption2
            ];

            expect(resp.starPatterns.size).toBe(0);
            expect(resp.union).toBeDefined();
            const union = resp.union!
            expect(union.length).toBe(1);
            const unionQueries = union[0];
            expect(unionQueries.length).toBe(2);

            for (let i = 0; i < unionQueries.length; i++) {
              const unionQuery = unionQueries[i];
              const expectedStarPattern = expectedQueries[i];
              expect(unionQuery.starPatterns.size).toBe(expectedStarPattern.size);
              for (const [subject, starPatterns] of unionQuery.starPatterns) {
                expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
              }
            }

          });

          test('alternative with sequence containing negated predicates', () => {
            const query = `PREFIX snvoc: <http://exemple.be#>

                SELECT
                    *
                WHERE {
                    ?message (snvoc:test1/!snvoc:test2)|snvoc:test3? ?foo .
              }`;

            const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

            const test1seq1 = DF.blankNode("http://exemple.be#test1_message");
            const test1Seq1StarPattern: [string, IStarPatternWithDependencies] = [
              'message',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test1',
                    {
                      triple: new Triple({
                        subject: 'message',
                        predicate: 'http://exemple.be#test1',
                        object: test1seq1,
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "message",
                isVariable: true,
              }
            ];

            const test1Seq2StarPattern: [string, IStarPatternWithDependencies] = [
              test1seq1.value,
              {
                starPattern: new Map([
                  [
                    Triple.NEGATIVE_PREDICATE_SET,
                    {
                      triple: new Triple({
                        subject: test1seq1.value,
                        predicate: Triple.NEGATIVE_PREDICATE_SET,
                        negatedSet: new Set(['http://exemple.be#test2']),
                        object: DF.variable('foo')
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: test1seq1.value,
                isVariable: false,
              }
            ];


            const starPatternUnionOption1 = new Map([test1Seq1StarPattern, test1Seq2StarPattern]);

            const test3StarPattern: [string, IStarPatternWithDependencies] = [
              'message',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test3',
                    {
                      triple: new Triple({
                        subject: 'message',
                        predicate: 'http://exemple.be#test3',
                        object: DF.variable("foo"),
                        cardinality: { min: 0, max: 1 }
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "message",
                isVariable: true,
              }
            ];

            const starPatternUnionOption2 = new Map([test3StarPattern]);

            const expectedQueries = [
              starPatternUnionOption1,
              starPatternUnionOption2
            ];

            expect(resp.starPatterns.size).toBe(0);
            expect(resp.union).toBeDefined();
            const union = resp.union!
            expect(union.length).toBe(1);
            const unionQueries = union[0];
            expect(unionQueries.length).toBe(2);

            for (let i = 0; i < unionQueries.length; i++) {
              const unionQuery = unionQueries[i];
              const expectedStarPattern = expectedQueries[i];
              expect(unionQuery.starPatterns.size).toBe(expectedStarPattern.size);
              for (const [subject, starPatterns] of unionQuery.starPatterns) {
                expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
              }
            }

          });

          test('alternative with sequence containing alternative', () => {
            const query = `PREFIX snvoc: <http://exemple.be#>

                SELECT
                    *
                WHERE {
                    ?message (snvoc:test1/(snvoc:test2|snvoc:test4*))|snvoc:test3 ?foo .
              }`;

            const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

            const test1seq1 = DF.blankNode("http://exemple.be#test1_message");
            const test1Seq1StarPattern: [string, IStarPatternWithDependencies] = [
              'message',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test1',
                    {
                      triple: new Triple({
                        subject: 'message',
                        predicate: 'http://exemple.be#test1',
                        object: test1seq1,
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "message",
                isVariable: true,
              }
            ];

            const test2StarPattern: [string, IStarPatternWithDependencies] = [
              test1seq1.value,
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test2',
                    {
                      triple: new Triple({
                        subject: test1seq1.value,
                        predicate: 'http://exemple.be#test2',
                        object: DF.variable('foo')
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: test1seq1.value,
                isVariable: false,
              }
            ];

            const test4StarPattern: [string, IStarPatternWithDependencies] = [
              test1seq1.value,
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test4',
                    {
                      triple: new Triple({
                        subject: test1seq1.value,
                        predicate: 'http://exemple.be#test4',
                        cardinality: { min: 0, max: -1 },
                        object: DF.variable('foo')
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: test1seq1.value,
                isVariable: false,
              }
            ];

            const starPatternUnionOption1 = new Map([test1Seq1StarPattern]);

            const test3StarPattern: [string, IStarPatternWithDependencies] = [
              'message',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test3',
                    {
                      triple: new Triple({
                        subject: 'message',
                        predicate: 'http://exemple.be#test3',
                        object: DF.variable("foo")
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "message",
                isVariable: true,
              }
            ];

            const starPatternUnionOption2 = new Map([test3StarPattern]);


            expect(resp.starPatterns.size).toBe(0);
            expect(resp.union).toBeDefined();
            const union = resp.union!
            expect(union.length).toBe(1);
            const unionQueries = union[0];
            expect(unionQueries.length).toBe(2);

            const firstBranch = unionQueries[0];
            const secondBranch = unionQueries[1];

            expect(firstBranch.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(starPatternUnionOption1);

            expect(secondBranch.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(starPatternUnionOption2);

            expect(firstBranch.union).toBeDefined();
            const nestedFirstBranchUnion = firstBranch.union!;
            expect(nestedFirstBranchUnion.length).toBe(1);
            const nestedFirstQueriesUnion = nestedFirstBranchUnion[0];
            expect(nestedFirstQueriesUnion.length).toBe(2);
            nestedFirstQueriesUnion[0].starPatterns = new Map([test2StarPattern]);
            expect(nestedFirstQueriesUnion[0].union).toBeUndefined();
            nestedFirstQueriesUnion[1].starPatterns = new Map([test4StarPattern]);
            expect(nestedFirstQueriesUnion[1].union).toBeUndefined();
          });
        });

        describe("inverse", () => {
          test("alternate with a single inverse path", () => {
            const query = `
              PREFIX snvoc: <http://exemple.be#>

              SELECT
                  *
              WHERE {
                  ?message snvoc:test1|^snvoc:test2+ ?fr .
            }`;

            const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

            const test1StarPattern: [string, IStarPatternWithDependencies] = [
              'message',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test1',
                    {
                      triple: new Triple({
                        subject: 'message',
                        predicate: 'http://exemple.be#test1',
                        object: DF.variable("fr"),
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "message",
                isVariable: true,
              }
            ];

            const test2StarPattern: [string, IStarPatternWithDependencies] = [
              'fr',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test2',
                    {
                      triple: new Triple({
                        subject: 'fr',
                        predicate: 'http://exemple.be#test2',
                        cardinality: { min: 1, max: -1 },
                        object: DF.variable("message"),
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "fr",
                isVariable: true,
              }
            ];

            expect(resp.starPatterns.size).toBe(0);
            expect(resp.union).toBeDefined();
            const union = resp.union!
            expect(union.length).toBe(1);
            const unionQueries = union[0];
            expect(unionQueries.length).toBe(2);

            const firstBranch = unionQueries[0];
            const secondBranch = unionQueries[1];

            expect(firstBranch.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([test1StarPattern]));
            expect(secondBranch.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([test2StarPattern]));

            expect(firstBranch.union).toBeUndefined();
            expect(secondBranch.union).toBeUndefined();
          });

          test("alternate with multiple inverse paths", () => {
            const query = `
              PREFIX snvoc: <http://exemple.be#>

              SELECT
                  *
              WHERE {
                  ?message (snvoc:test1|^(snvoc:test2|snvoc:test3+|snvoc:test4*)) ?fr .
            }`;

            const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

            const test1StarPattern: [string, IStarPatternWithDependencies] = [
              'message',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test1',
                    {
                      triple: new Triple({
                        subject: 'message',
                        predicate: 'http://exemple.be#test1',
                        object: DF.variable("fr"),
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "message",
                isVariable: true,
              }
            ];

            const test2StarPattern: [string, IStarPatternWithDependencies] = [
              'fr',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test2',
                    {
                      triple: new Triple({
                        subject: 'fr',
                        predicate: 'http://exemple.be#test2',
                        object: DF.variable("message"),
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "fr",
                isVariable: true,
              }
            ];

            const test3StarPattern: [string, IStarPatternWithDependencies] = [
              'fr',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test3',
                    {
                      triple: new Triple({
                        subject: 'fr',
                        predicate: 'http://exemple.be#test3',
                        cardinality: { min: 1, max: -1 },
                        object: DF.variable("message"),
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "fr",
                isVariable: true,
              }
            ];

            const test4StarPattern: [string, IStarPatternWithDependencies] = [
              'fr',
              {
                starPattern: new Map([
                  [
                    'http://exemple.be#test4',
                    {
                      triple: new Triple({
                        subject: 'fr',
                        predicate: 'http://exemple.be#test4',
                        cardinality: { min: 0, max: -1 },
                        object: DF.variable("message"),
                      }),
                      dependencies: undefined
                    }
                  ],
                ]),
                name: "fr",
                isVariable: true,
              }
            ];

            expect(resp.starPatterns.size).toBe(0);
            expect(resp.union).toBeDefined();
            const union = resp.union!
            expect(union.length).toBe(1);
            const unionQueries = union[0];
            expect(unionQueries.length).toBe(4);

            const firstBranch = unionQueries[0];
            const secondBranch = unionQueries[1];
            const thirdBranch = unionQueries[2];
            const forthBranch = unionQueries[3];

            expect(firstBranch.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([test1StarPattern]));
            expect(secondBranch.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([test2StarPattern]));
            expect(thirdBranch.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([test3StarPattern]));
            expect(forthBranch.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([test4StarPattern]));

            expect(firstBranch.union).toBeUndefined();
            expect(secondBranch.union).toBeUndefined();
            expect(thirdBranch.union).toBeUndefined();
            expect(forthBranch.union).toBeUndefined();
          });
        });

      });
    });

    describe('union', () => {
      it("should handle a simple union", () => {
        const query = `SELECT * WHERE { 
            ?x <http://exemple.ca> ?z .
            {
              ?x <http://exemple.ca#1> ?z .
              ?x <http://exemple.ca#2> ?z .
            }UNION{
              ?x <http://exemple.ca#1> ?z .
              ?y <http://exemple.be> ?z .
            }
          }`;

        const xStarPattern: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
          xStarPattern,
        ]);

        const xStarPatternUnion: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca#1',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#1',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ],
              [
                'http://exemple.ca#2',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#2',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const xStarPatternUnion2: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca#1',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#1',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ],
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const yStarPattern: [string, IStarPatternWithDependencies] = ['y',
          {
            starPattern: new Map(
              [
                ['http://exemple.be',
                  {
                    triple: new Triple({
                      subject: 'y',
                      predicate: 'http://exemple.be',
                      object: DF.variable('z')
                    }),
                    dependencies: undefined
                  }
                ]
              ]
            ),
            name: "y",
            isVariable: true,

          }
        ];


        const everyExpectedStarPatternUnion = [
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternUnion,

          ]),
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternUnion2,
            yStarPattern
          ])
        ];

        const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

        expect(resp.union?.length).toBe(1);

        expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
        expect(resp.filterExpression).toBe('');
        for (const [subject, starPatterns] of resp.starPatterns) {
          expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
        }
        const n = (resp.union ?? []).length;
        const respUnion = resp.union![0];
        for (let i = 0; i < n; i++) {
          const union = respUnion[i];
          const expectedUnionStarPattern = everyExpectedStarPatternUnion[i];

          expect(union.starPatterns.size).toBe(expectedUnionStarPattern.size);
          expect(union.filterExpression).toBe('');
          for (const [subject, starPatterns] of union.starPatterns) {
            const expectedStarPattern = expectedUnionStarPattern.get(subject);
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern!);
          }
        }
      });

      it("should handle a union with dependencies", () => {
        const query = `SELECT * WHERE { 
            ?x <http://exemple.ca> ?z .
            {
              ?x <http://exemple.ca#1> ?z .
              ?x <http://exemple.ca#2> ?z .
            }UNION{
              ?x <http://exemple.ca#1> ?z .
              ?y <http://exemple.be> ?x .
            }
          }`;

        const xStarPattern: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
          xStarPattern,
        ]);

        const xStarPatternUnion: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca#1',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#1',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ],
              [
                'http://exemple.ca#2',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#2',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const xStarPatternUnion2: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca#1',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#1',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ],
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const yStarPattern: [string, IStarPatternWithDependencies] = ['y',
          {
            starPattern: new Map(
              [
                ['http://exemple.be',
                  {
                    triple: new Triple({
                      subject: 'y',
                      predicate: 'http://exemple.be',
                      object: DF.variable('x')
                    }),
                    dependencies: xStarPatternUnion2[1]
                  }
                ]
              ]
            ),
            name: "y",
            isVariable: true,

          }
        ];


        const everyExpectedStarPatternUnion = [
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternUnion,

          ]),
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternUnion2,
            yStarPattern
          ])
        ];

        const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

        expect(resp.union?.length).toBe(1);

        expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
        expect(resp.filterExpression).toBe('');
        for (const [subject, starPatterns] of resp.starPatterns) {
          expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
        }
        const n = (resp.union ?? []).length
        const respUnion = resp.union![0];
        for (let i = 0; i < n; i++) {
          const union = respUnion[i];
          const expectedUnionStarPattern = everyExpectedStarPatternUnion[i];

          expect(union.starPatterns.size).toBe(expectedUnionStarPattern.size);
          expect(union.filterExpression).toBe('');
          for (const [subject, starPatterns] of union.starPatterns) {
            const expectedStarPattern = expectedUnionStarPattern.get(subject);
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern!);
          }
        }
      });

      it("should handle a multiple unions", () => {
        const query = `SELECT * WHERE { 
            ?x <http://exemple.ca> ?z .
            {
              ?x <http://exemple.ca#1> ?z .
              ?x <http://exemple.ca#2> ?z .
            }UNION{
              ?x <http://exemple.ca#1> ?z .
              ?y <http://exemple.be> ?z .
            }

            {
              ?x <http://exemple.ca#1> ?z .
            }UNION{
              ?x <http://exemple.ca#1> ?z .
              ?y <http://exemple.be> ?x .
            }
          }`;

        const xStarPattern: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
          xStarPattern,
        ]);

        const xStarPatternUnion11: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca#1',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#1',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ],
              [
                'http://exemple.ca#2',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#2',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const xStarPatternUnion12: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca#1',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#1',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ],
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const yStarPattern: [string, IStarPatternWithDependencies] = ['y',
          {
            starPattern: new Map(
              [
                ['http://exemple.be',
                  {
                    triple: new Triple({
                      subject: 'y',
                      predicate: 'http://exemple.be',
                      object: DF.variable('z')
                    }),
                    dependencies: undefined
                  }
                ]
              ]
            ),
            name: "y",
            isVariable: true,

          }
        ];


        const everyExpectedStarPatternUnion1 = [
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternUnion11,

          ]),
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternUnion12,
            yStarPattern
          ])
        ];


        const xStarPatternUnion21: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca#1',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#1',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];


        const yStarPatternUnion22: [string, IStarPatternWithDependencies] = ['y',
          {
            starPattern: new Map(
              [
                ['http://exemple.be',
                  {
                    triple: new Triple({
                      subject: 'y',
                      predicate: 'http://exemple.be',
                      object: DF.variable('x')
                    }),
                    dependencies: xStarPatternUnion12[1]
                  }
                ]
              ]
            ),
            name: "y",
            isVariable: true,

          }
        ];


        const everyExpectedStarPatternUnion2 = [
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternUnion21,

          ]),
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternUnion12,
            yStarPatternUnion22
          ])
        ];

        const everyExpectedStarPatternUnionPack = [
          everyExpectedStarPatternUnion1,
          everyExpectedStarPatternUnion2
        ]

        const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

        expect(resp.union?.length).toBe(2);

        expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
        expect(resp.filterExpression).toBe('');
        for (const [subject, starPatterns] of resp.starPatterns) {
          expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
        }
        const n = (resp.union ?? []).length;

        for (let i = 0; i < n; i++) {
          const respUnion = resp.union![i];
          const everyExpectedStarPatternUnion = everyExpectedStarPatternUnionPack[i];
          for (let j = 0; j < respUnion.length; j++) {
            const union = respUnion[j];
            const expectedUnionStarPattern = everyExpectedStarPatternUnion[j];

            expect(union.starPatterns.size).toBe(expectedUnionStarPattern.size);
            expect(union.filterExpression).toBe('');
            for (const [subject, starPatterns] of union.starPatterns) {
              const expectedStarPattern = expectedUnionStarPattern.get(subject);
              expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern!);
            }
          }
        }

      });

      it("should handle nested union", () => {
        const query = `SELECT * WHERE { 
            ?x <http://exemple.ca> ?z .
            {
              ?x <http://exemple.ca#1> ?z .
              ?x <http://exemple.ca#2> ?z .
            }UNION{
              ?x <http://exemple.ca#1> ?z .
              ?y <http://exemple.be> ?z .
              {
              ?x <http://exemple.ca> ?y .
              }UNION{
                ?x <http://exemple.ca> ?w .
              }
            }
          }`;

        const xStarPattern: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
          xStarPattern,
        ]);

        const xStarPatternUnion: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca#1',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#1',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ],
              [
                'http://exemple.ca#2',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#2',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const xStarPatternUnion2: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca#1',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca#1',
                    object: DF.variable('z')
                  }),
                  dependencies: undefined
                }
              ],
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const yStarPattern: [string, IStarPatternWithDependencies] = ['y',
          {
            starPattern: new Map(
              [
                ['http://exemple.be',
                  {
                    triple: new Triple({
                      subject: 'y',
                      predicate: 'http://exemple.be',
                      object: DF.variable('z')
                    }),
                    dependencies: undefined
                  }
                ]
              ]
            ),
            name: "y",
            isVariable: true,

          }
        ];

        const everyExpectedStarPatternUnion = [
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternUnion,

          ]),
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternUnion2,
            yStarPattern
          ])
        ];

        const xStarPatternNestedUnion1: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca',
                    object: DF.variable('y')
                  }),
                  dependencies: yStarPattern[1]
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const xStarPatternNestedUnion2: [string, IStarPatternWithDependencies] = ['x',
          {
            starPattern: new Map([
              [
                'http://exemple.ca',
                {
                  triple: new Triple({
                    subject: 'x',
                    predicate: 'http://exemple.ca',
                    object: DF.variable('w')
                  }),
                  dependencies: undefined
                }
              ]
            ]),
            name: "x",
            isVariable: true,

          }
        ];

        const everyExpectedStarPatternNestedUnion = [
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternNestedUnion1,

          ]),
          new Map<string, IStarPatternWithDependencies>([
            xStarPatternNestedUnion2
          ])
        ];

        const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

        expect(resp.union?.length).toBe(1);

        expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
        expect(resp.filterExpression).toBe('');
        for (const [subject, starPatterns] of resp.starPatterns) {
          expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
        }
        const n = (resp.union ?? []).length;
        const respUnion = resp.union![0];
        for (let i = 0; i < n; i++) {
          const union = respUnion[i];
          const expectedUnionStarPattern = everyExpectedStarPatternUnion[i];

          expect(union.starPatterns.size).toBe(expectedUnionStarPattern.size);
          expect(union.filterExpression).toBe('');
          for (const [subject, starPatterns] of union.starPatterns) {
            const expectedStarPattern = expectedUnionStarPattern.get(subject);
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern!);
          }
        }

        const nestedUnion = resp.union![0][1].union![0];
        expect(nestedUnion).toBeDefined();
        const nNested = (nestedUnion ?? []).length;

        for (let i = 0; i < nNested; i++) {
          const union = nestedUnion[i];
          const expectedUnionStarPattern = everyExpectedStarPatternNestedUnion[i];

          expect(union.starPatterns.size).toBe(expectedUnionStarPattern.size);
          expect(union.filterExpression).toBe('');
          for (const [subject, starPatterns] of union.starPatterns) {
            const expectedStarPattern = expectedUnionStarPattern.get(subject);
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern!);
          }
        }

      });
    });

    describe("solidbench query", () => {

      describe("short", () => {

        test('interactive-short-1', () => {
          const query = `
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
            }
            `;

          const cityStarPattern: [string, IStarPatternWithDependencies] = [
            'city',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'city',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`cityId`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "city",
              isVariable: true,
            },
          ];

          const personStarPattern: [string, IStarPatternWithDependencies] = [
            'person',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Person`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable('personId')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}firstName`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}firstName`,
                      object: DF.variable('firstName')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}lastName`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}lastName`,
                      object: DF.variable('lastName')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}gender`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}gender`,
                      object: DF.variable('gender')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}birthday`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}birthday`,
                      object: DF.variable('birthday')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}creationDate`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}creationDate`,
                      object: DF.variable('creationDate')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}locationIP`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}locationIP`,
                      object: DF.variable('locationIP')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}isLocatedIn`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}isLocatedIn`,
                      object: DF.variable('city')
                    }),
                    dependencies: cityStarPattern[1]
                  }
                ],
                [
                  `${SNVOC_PREFIX}browserUsed`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}browserUsed`,
                      object: DF.variable('browserUsed')
                    }),
                  }
                ],
              ]),
              name: "person",
              isVariable: true,
            }
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            personStarPattern,
            cityStarPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }
        });

        test('interactive-short-2', () => {
          const query = `
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

          const personStarPattern: [string, IStarPatternWithDependencies] = [
            'person',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Person`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable('personId')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "person",
              isVariable: true,
            }
          ];

          const originalPostInnerStarPattern: [string, IStarPatternWithDependencies] = [
            'originalPostInner',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'originalPostInner',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Post`),
                      isOptional: true
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "originalPostInner",
              isVariable: true,
            }
          ];

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable('person'),
                    }),
                    dependencies: personStarPattern[1]
                  }
                ],
                [
                  `${SNVOC_PREFIX}creationDate`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}creationDate`,
                      object: DF.variable('messageCreationDate')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable('messageId')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}replyOf`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}replyOf`,
                      cardinality: { min: 0, max: -1 },
                      object: DF.variable('originalPostInner'),
                      isOptional: true
                    }),
                    dependencies: originalPostInnerStarPattern[1]
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const creatorStarPattern: [string, IStarPatternWithDependencies] = [
            'creator',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}firstName`,
                  {
                    triple: new Triple({
                      subject: 'creator',
                      predicate: `${SNVOC_PREFIX}firstName`,
                      object: DF.variable('originalPostAuthorFirstName')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}lastName`,
                  {
                    triple: new Triple({
                      subject: 'creator',
                      predicate: `${SNVOC_PREFIX}lastName`,
                      object: DF.variable('originalPostAuthorLastName')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'creator',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable('originalPostAuthorId')
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: 'creator',
              isVariable: true
            }
          ];

          const originalPostStarPattern: [string, IStarPatternWithDependencies] = [
            'originalPost',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'originalPost',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable('originalPostId')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'originalPost',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable('creator')
                    }),
                    dependencies: creatorStarPattern[1]
                  }
                ],
              ]),
              name: "originalPost",
              isVariable: true,
            }
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            personStarPattern,
            originalPostInnerStarPattern,
            messageStarPattern,
            creatorStarPattern,
            originalPostStarPattern,
          ]);

          const unionMessageContentBranchStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}content`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}content`,
                      object: DF.variable('messageContent')
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const unionMessageImageFileBranchStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}imageFile`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}imageFile`,
                      object: DF.variable('messageContent')
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeDefined();
          const union = resp.union![0];
          const unionBranchContent = union[0];
          const unionBranchImageFile = union[1];

          expect(unionBranchContent.union).toBeUndefined();
          expect(unionBranchImageFile.union).toBeUndefined();

          expect(unionBranchContent.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([unionMessageContentBranchStarPattern]));
          expect(unionBranchImageFile.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([unionMessageImageFileBranchStarPattern]));
        });

        test('interactive-short-3', () => {
          const query = `
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
                ?personId
                ?firstName
                ?lastName
                ?friendshipCreationDate
            WHERE
            {
                ?rootPerson a snvoc:Person .
                ?rootPerson snvoc:id ?rootId .
                {
                    ?rootPerson snvoc:knows ?knows .
                    ?knows snvoc:hasPerson ?person .
                } UNION {
                    ?person snvoc:knows ?knows .
                    ?knows snvoc:hasPerson ?rootPerson .
                }
                ?knows snvoc:creationDate ?friendshipCreationDate .
                ?person snvoc:firstName ?firstName .
                ?person snvoc:lastName ?lastName .
                ?person snvoc:id ?personId .
            }
            `;

          const personStarPattern: [string, IStarPatternWithDependencies] = [
            'person',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}firstName`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}firstName`,
                      object: DF.variable('firstName')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}lastName`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}lastName`,
                      object: DF.variable('lastName')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable('personId')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "person",
              isVariable: true,
            }
          ];

          const rootPersonStarPattern: [string, IStarPatternWithDependencies] = [
            'rootPerson',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'rootPerson',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Person`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'rootPerson',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable('rootId')
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "rootPerson",
              isVariable: true,
            }
          ];

          const knowStarPattern: [string, IStarPatternWithDependencies] = [
            'knows',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}creationDate`,
                  {
                    triple: new Triple({
                      subject: 'knows',
                      predicate: `${SNVOC_PREFIX}creationDate`,
                      object: DF.variable('friendshipCreationDate')
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "knows",
              isVariable: true,
            }
          ];

          const knowUnion1BranchStarPattern: [string, IStarPatternWithDependencies] = [
            'knows',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasPerson`,
                  {
                    triple: new Triple({
                      subject: 'knows',
                      predicate: `${SNVOC_PREFIX}hasPerson`,
                      object: DF.variable('person')
                    }),
                    dependencies: personStarPattern[1]
                  }
                ],
              ]),
              name: "knows",
              isVariable: true,
            }
          ];

          const rootPersonUnion1BranchStarPattern: [string, IStarPatternWithDependencies] = [
            'rootPerson',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}knows`,
                  {
                    triple: new Triple({
                      subject: 'rootPerson',
                      predicate: `${SNVOC_PREFIX}knows`,
                      object: DF.variable('knows')
                    }),
                    dependencies: knowUnion1BranchStarPattern[1]
                  }
                ]
              ]),
              name: "rootPerson",
              isVariable: true,
            }
          ];

          const knowUnion2BranchStarPattern: [string, IStarPatternWithDependencies] = [
            'knows',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasPerson`,
                  {
                    triple: new Triple({
                      subject: 'knows',
                      predicate: `${SNVOC_PREFIX}hasPerson`,
                      object: DF.variable('rootPerson')
                    }),
                    dependencies: rootPersonStarPattern[1]
                  }
                ],
              ]),
              name: "knows",
              isVariable: true,
            }
          ];

          const personUnion2BranchStarPattern: [string, IStarPatternWithDependencies] = [
            'person',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}knows`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}knows`,
                      object: DF.variable('knows')
                    }),
                    dependencies: knowUnion2BranchStarPattern[1]
                  }
                ]
              ]),
              name: "person",
              isVariable: true,
            }
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            personStarPattern,
            rootPersonStarPattern,
            knowStarPattern
          ]);

          const expectedBranch1StarPattern = new Map<string, IStarPatternWithDependencies>([
            rootPersonUnion1BranchStarPattern,
            knowUnion1BranchStarPattern
          ]);

          const expectedBranch2StarPattern = new Map<string, IStarPatternWithDependencies>([
            personUnion2BranchStarPattern,
            knowUnion2BranchStarPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeDefined();
          const unions = resp.union!;
          expect(unions.length).toBe(1);
          const union = unions[0];
          expect(union.length).toBe(2);
          expect(union[0].starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(expectedBranch1StarPattern);
          expect(union[0].union).toBeUndefined();
          expect(union[1].starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(expectedBranch2StarPattern);
          expect(union[1].union).toBeUndefined();

        });

        test('interactive-short-4', () => {
          const query = `
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
            }
            `;

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`messageId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}creationDate`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}creationDate`,
                      object: DF.variable(`messageCreationDate`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const messageContentStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}content`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}content`,
                      object: DF.variable(`messageContent`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const messageImageFileStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}imageFile`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}imageFile`,
                      object: DF.variable(`messageContent`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            }
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageStarPattern,
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeDefined();
          const unions = resp.union!;
          expect(unions.length).toBe(1);
          const union = unions[0];
          expect(union.length).toBe(2);
          expect(union[0].starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([messageContentStarPattern]));
          expect(union[0].union).toBeUndefined();
          expect(union[1].starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([messageImageFileStarPattern]));
          expect(union[1].union).toBeUndefined();
        });

        test('interactive-short-5', () => {
          const query = `
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
                ?personId
                ?firstName
                ?lastName
            WHERE
            {
                ?message snvoc:id ?messageId .
                ?message snvoc:hasCreator ?creator .
                ?creator snvoc:id ?personId .
                ?creator snvoc:firstName ?firstName .
                ?creator snvoc:lastName ?lastName .
            }
            `;

          const creatorStarPattern: [string, IStarPatternWithDependencies] = [
            'creator',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'creator',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`personId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}firstName`,
                  {
                    triple: new Triple({
                      subject: 'creator',
                      predicate: `${SNVOC_PREFIX}firstName`,
                      object: DF.variable(`firstName`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}lastName`,
                  {
                    triple: new Triple({
                      subject: 'creator',
                      predicate: `${SNVOC_PREFIX}lastName`,
                      object: DF.variable(`lastName`)
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "creator",
              isVariable: true,
            },
          ];

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`messageId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`creator`)
                    }),
                    dependencies: creatorStarPattern[1]
                  }
                ],

              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageStarPattern,
            creatorStarPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeUndefined();

        });

        test('interactive-short-6', () => {
          const query = `
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
                ?forumId
                ?forumTitle
                ?moderatorId
                ?moderatorFirstName
                ?moderatorLastName
            WHERE {
                ?message snvoc:id ?messageId .
                OPTIONAL {
                    ?message snvoc:replyOf* ?originalPostInner .
                    ?originalPostInner a snvoc:Post .
                } .
                BIND( COALESCE(?originalPostInner, ?message) AS ?originalPost ) .
                ?forum snvoc:containerOf ?originalPost .
                ?forum snvoc:id ?forumId .
                ?forum snvoc:title ?forumTitle .
                ?forum snvoc:hasModerator ?moderator .
                ?moderator snvoc:id ?moderatorId .
                ?moderator snvoc:firstName ?moderatorFirstName .
                ?moderator snvoc:lastName ?moderatorLastName .
            }
            `;

          const originalPostInnerStarPattern: [string, IStarPatternWithDependencies] = [
            'originalPostInner',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'originalPostInner',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Post`),
                      isOptional: true
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: 'originalPostInner',
              isVariable: true
            }
          ];

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`messageId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}replyOf`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}replyOf`,
                      object: DF.variable(`originalPostInner`),
                      cardinality: { min: 0, max: -1 },
                      isOptional: true
                    }),
                    dependencies: originalPostInnerStarPattern[1]
                  }
                ],

              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const moderatorStarPattern: [string, IStarPatternWithDependencies] = [
            'moderator',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'moderator',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`moderatorId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}firstName`,
                  {
                    triple: new Triple({
                      subject: 'moderator',
                      predicate: `${SNVOC_PREFIX}firstName`,
                      object: DF.variable(`moderatorFirstName`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}lastName`,
                  {
                    triple: new Triple({
                      subject: 'moderator',
                      predicate: `${SNVOC_PREFIX}lastName`,
                      object: DF.variable(`moderatorLastName`)
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: 'moderator',
              isVariable: true
            }
          ];

          const forumStarPattern: [string, IStarPatternWithDependencies] = [
            'forum',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}containerOf`,
                  {
                    triple: new Triple({
                      subject: 'forum',
                      predicate: `${SNVOC_PREFIX}containerOf`,
                      object: DF.variable(`originalPost`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'forum',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`forumId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}title`,
                  {
                    triple: new Triple({
                      subject: 'forum',
                      predicate: `${SNVOC_PREFIX}title`,
                      object: DF.variable(`forumTitle`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasModerator`,
                  {
                    triple: new Triple({
                      subject: 'forum',
                      predicate: `${SNVOC_PREFIX}hasModerator`,
                      object: DF.variable(`moderator`)
                    }),
                    dependencies: moderatorStarPattern[1]
                  }
                ],
              ]),
              name: 'forum',
              isVariable: true
            }
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            originalPostInnerStarPattern,
            messageStarPattern,
            moderatorStarPattern,
            forumStarPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeUndefined();

        });

        test('interactive-short-7', () => {
          const query = `
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
                ?commentId
                ?commentContent
                ?commentCreationDate
                ?replyAuthorId
                ?replyAuthorFirstName
                ?replyAuthorLastName
                ?replyAuthorKnowsOriginalMessageAuthor
            WHERE
            {
                ?message snvoc:id ?messageId .
                ?message snvoc:hasCreator ?messageCreator .
                ?messageCreator snvoc:id ?messageCreatorId .
                ?comment snvoc:replyOf ?message .
                ?comment a snvoc:Comment .
                ?comment snvoc:id ?commentId .
                ?comment snvoc:content ?commentContent .
                ?comment snvoc:creationDate ?commentCreationDate .
                ?comment snvoc:hasCreator ?replyAuthor .
                ?replyAuthor snvoc:id ?replyAuthorId .
                ?replyAuthor snvoc:firstName ?replyAuthorFirstName .
                ?replyAuthor snvoc:lastName ?replyAuthorLastName .
                OPTIONAL {
                    ?messageCreator ((snvoc:knows/snvoc:hasPerson)|^(snvoc:knows/snvoc:hasPerson)) ?replyAuthor .
                    BIND( "true"^^xsd:boolean AS ?replyAuthorKnowsOriginalMessageAuthorInner ) .
                }
                BIND( COALESCE(?replyAuthorKnowsOriginalMessageAuthorInner, "false"^^xsd:boolean) AS ?replyAuthorKnowsOriginalMessageAuthor ) .
            }
            `;

          const messageCreatorStarPattern: [string, IStarPatternWithDependencies] = [
            'messageCreator',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'messageCreator',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`messageCreatorId`)
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "messageCreator",
              isVariable: true,
            }
          ];

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`messageId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`messageCreator`),
                      isOptional: false
                    }),
                    dependencies: messageCreatorStarPattern[1]
                  }
                ],

              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const replyAuthorStarPattern: [string, IStarPatternWithDependencies] = [
            'replyAuthor',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'replyAuthor',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`replyAuthorId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}firstName`,
                  {
                    triple: new Triple({
                      subject: 'replyAuthor',
                      predicate: `${SNVOC_PREFIX}firstName`,
                      object: DF.variable(`replyAuthorFirstName`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}lastName`,
                  {
                    triple: new Triple({
                      subject: 'replyAuthor',
                      predicate: `${SNVOC_PREFIX}lastName`,
                      object: DF.variable(`replyAuthorLastName`)
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: 'replyAuthor',
              isVariable: true
            }
          ];
          const commentStarPattern: [string, IStarPatternWithDependencies] = [
            'comment',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}replyOf`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}replyOf`,
                      object: DF.variable(`message`)
                    }),
                    dependencies: messageStarPattern[1]
                  }
                ],
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Comment`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`commentId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}content`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}content`,
                      object: DF.variable(`commentContent`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}creationDate`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}creationDate`,
                      object: DF.variable(`commentCreationDate`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`replyAuthor`)
                    }),
                    dependencies: replyAuthorStarPattern[1]
                  }
                ],
              ]),
              name: "comment",
              isVariable: true,
            }
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageCreatorStarPattern,
            messageStarPattern,
            replyAuthorStarPattern,
            commentStarPattern,
          ]);

          const knowFirstBranchInter = DF.blankNode(`${SNVOC_PREFIX}knows_messageCreator`);
          const messageCreatorDirectKnowPath1: [string, IStarPatternWithDependencies] = [
            'messageCreator',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}knows`,
                  {
                    triple: new Triple({
                      subject: 'messageCreator',
                      predicate: `${SNVOC_PREFIX}knows`,
                      object: knowFirstBranchInter,
                      isOptional: true
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "messageCreator",
              isVariable: true
            }
          ];

          const messageCreatorDirectKnowPath2: [string, IStarPatternWithDependencies] = [
            knowFirstBranchInter.value,
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasPerson`,
                  {
                    triple: new Triple({
                      subject: knowFirstBranchInter.value,
                      predicate: `${SNVOC_PREFIX}hasPerson`,
                      object: DF.variable("replyAuthor"),
                      isOptional: true
                    }),
                    dependencies: replyAuthorStarPattern[1]
                  }
                ]
              ]),
              name: knowFirstBranchInter.value,
              isVariable: false
            }
          ];

          const knowSecondBranchInter = DF.blankNode(`${SNVOC_PREFIX}knows_replyAuthor`);
          const messageCreatorUnDirectKnowPath1: [string, IStarPatternWithDependencies] = [
            'replyAuthor',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}knows`,
                  {
                    triple: new Triple({
                      subject: 'replyAuthor',
                      predicate: `${SNVOC_PREFIX}knows`,
                      object: knowSecondBranchInter,
                      isOptional: true
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "replyAuthor",
              isVariable: true
            }
          ];

          const messageCreatorUnDirectKnowPath2: [string, IStarPatternWithDependencies] = [
            knowSecondBranchInter.value,
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasPerson`,
                  {
                    triple: new Triple({
                      subject: knowSecondBranchInter.value,
                      predicate: `${SNVOC_PREFIX}hasPerson`,
                      object: DF.variable("messageCreator"),
                      isOptional: true
                    }),
                    dependencies: messageCreatorStarPattern[1]
                  }
                ]
              ]),
              name: knowSecondBranchInter.value,
              isVariable: false
            }
          ];

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeDefined();
          expect(resp.union?.length).toBe(1);

          const union = resp.union![0];
          expect(union.length).toBe(2);

          const firstBranch = union[0];
          const secondBranch = union[1];

          expect(firstBranch.union).toBeUndefined();
          expect(firstBranch.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([messageCreatorDirectKnowPath1, messageCreatorDirectKnowPath2]));

          expect(secondBranch.union).toBeUndefined();
          expect(secondBranch.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([messageCreatorUnDirectKnowPath1, messageCreatorUnDirectKnowPath2]));

        });
      });

      describe("discovery", () => {
        test('interactive-discovery-1', () => {
          const query = `
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
                    rdf:type snvoc:Post;
                    snvoc:content ?messageContent;
                    snvoc:creationDate ?messageCreationDate;
                    snvoc:id ?messageId.
            }
            `;

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`messageId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}creationDate`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}creationDate`,
                      object: DF.variable(`messageCreationDate`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}content`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}content`,
                      object: DF.variable(`messageContent`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Post`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`person`)
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageStarPattern,
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeUndefined();
        });

        test('interactive-discovery-2', () => {
          const query = `
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

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`messageId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}creationDate`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}creationDate`,
                      object: DF.variable(`messageCreationDate`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}content`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}content`,
                      object: DF.variable(`messageContent`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`person`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageStarPattern,
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          const messageContentTypePostStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Post`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const messageContentTypeCommentStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Comment`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            },
          ];
          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeDefined();
          const unions = resp.union!;
          expect(unions.length).toBe(1);
          const union = unions[0];
          expect(union.length).toBe(2);
          expect(union[0].starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([messageContentTypePostStarPattern]));
          expect(union[0].union).toBeUndefined();
          expect(union[1].starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([messageContentTypeCommentStarPattern]));
          expect(union[1].union).toBeUndefined();
        });

        test('interactive-discovery-3', () => {
          const query = `
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
                ?tagName
                (COUNT(?message) as ?messages)
            WHERE
            {
                ?message snvoc:hasCreator ?person;
                    snvoc:hasTag ?tag.
                ?tag foaf:name ?tagName.
            }
            GROUP BY ?tagName
            ORDER BY DESC(?messages)
            `;

          const tagStarPattern: [string, IStarPatternWithDependencies] = [
            'tag',
            {
              starPattern: new Map([
                [
                  `http://xmlns.com/foaf/0.1/name`,
                  {
                    triple: new Triple({
                      subject: 'tag',
                      predicate: `http://xmlns.com/foaf/0.1/name`,
                      object: DF.variable(`tagName`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "tag",
              isVariable: true,
            }
          ];

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`person`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasTag`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasTag`,
                      object: DF.variable(`tag`)
                    }),
                    dependencies: tagStarPattern[1]
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageStarPattern,
            tagStarPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeUndefined();
        });

        test('interactive-discovery-4', () => {
          const query = `
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
                ?locationName
                (COUNT(?message) as ?messages)
            WHERE
            {
                ?message snvoc:hasCreator ?person;
                    rdf:type snvoc:Comment;
                    snvoc:isLocatedIn ?location.
                ?location foaf:name ?locationName.
            }
            GROUP BY ?locationName
            ORDER BY DESC(?messages)
            `;

          const locationStarPattern: [string, IStarPatternWithDependencies] = [
            'location',
            {
              starPattern: new Map([
                [
                  `http://xmlns.com/foaf/0.1/name`,
                  {
                    triple: new Triple({
                      subject: 'location',
                      predicate: `http://xmlns.com/foaf/0.1/name`,
                      object: DF.variable(`locationName`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "location",
              isVariable: true,
            }
          ];

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`person`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Comment`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}isLocatedIn`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}isLocatedIn`,
                      object: DF.variable(`location`)
                    }),
                    dependencies: locationStarPattern[1]
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageStarPattern,
            locationStarPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeUndefined();
        });

        test('interactive-discovery-5', () => {
          const query = `
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
                ?locationIp
            WHERE
            {
                ?message snvoc:hasCreator ?person;
                    snvoc:locationIP ?locationIp.
            }
            `;


          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`person`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}locationIP`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}locationIP`,
                      object: DF.variable(`locationIp`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageStarPattern,
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeUndefined();
        });

        test('interactive-discovery-6', () => {
          const query = `
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
                ?forumId
                ?forumTitle
            WHERE
            {
                ?message snvoc:hasCreator ?person.
                ?forum snvoc:containerOf ?message;
                        snvoc:id ?forumId;
                        snvoc:title ?forumTitle.
            }
            `;

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`person`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const forumStarPattern: [string, IStarPatternWithDependencies] = [
            'forum',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}containerOf`,
                  {
                    triple: new Triple({
                      subject: 'forum',
                      predicate: `${SNVOC_PREFIX}containerOf`,
                      object: DF.variable(`message`)
                    }),
                    dependencies: messageStarPattern[1]
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'forum',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`forumId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}title`,
                  {
                    triple: new Triple({
                      subject: 'forum',
                      predicate: `${SNVOC_PREFIX}title`,
                      object: DF.variable(`forumTitle`)
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "forum",
              isVariable: true,
            },
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageStarPattern,
            forumStarPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeUndefined();
        });

        test('interactive-discovery-7', () => {
          const query = `
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
                    ?firstName
                    ?lastName
                WHERE
                {
                    ?message snvoc:hasCreator ?person.
                    ?forum snvoc:containerOf ?message;
                        snvoc:hasModerator ?moderator.
                    ?moderator snvoc:firstName ?firstName .
                    ?moderator snvoc:lastName ?lastName .
                }
            `;

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`person`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const moderatorStarPattern: [string, IStarPatternWithDependencies] = [
            'moderator',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}firstName`,
                  {
                    triple: new Triple({
                      subject: 'moderator',
                      predicate: `${SNVOC_PREFIX}firstName`,
                      object: DF.variable(`firstName`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}lastName`,
                  {
                    triple: new Triple({
                      subject: 'moderator',
                      predicate: `${SNVOC_PREFIX}lastName`,
                      object: DF.variable(`lastName`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "moderator",
              isVariable: true,
            },
          ];


          const forumStarPattern: [string, IStarPatternWithDependencies] = [
            'forum',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}containerOf`,
                  {
                    triple: new Triple({
                      subject: 'forum',
                      predicate: `${SNVOC_PREFIX}containerOf`,
                      object: DF.variable(`message`)
                    }),
                    dependencies: messageStarPattern[1]
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasModerator`,
                  {
                    triple: new Triple({
                      subject: 'forum',
                      predicate: `${SNVOC_PREFIX}hasModerator`,
                      object: DF.variable(`moderator`)
                    }),
                    dependencies: moderatorStarPattern[1]
                  }
                ],

              ]),
              name: "forum",
              isVariable: true,
            },
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageStarPattern,
            forumStarPattern,
            moderatorStarPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeUndefined();
        });

        test('interactive-discovery-8', () => {
          const query = `
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

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`creator`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const otherMessageStarPattern: [string, IStarPatternWithDependencies] = [
            'otherMessage',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'otherMessage',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`creator`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}content`,
                  {
                    triple: new Triple({
                      subject: 'otherMessage',
                      predicate: `${SNVOC_PREFIX}content`,
                      object: DF.variable(`messageContent`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "otherMessage",
              isVariable: true,
            },
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageStarPattern,
            otherMessageStarPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size + 1);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            if (subject === 'person') {
              continue;
            }
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          const personSujet = resp.starPatterns.get('person');
          expect(personSujet?.filterExpression).toBeUndefined();
          expect(personSujet?.isVariable).toBe(true);
          expect(personSujet?.name).toBe('person');
          expect(personSujet?.starPattern.size).toBe(1);
          for (const pattern of personSujet?.starPattern.values() ?? []) {
            expect(pattern.dependencies).toBeUndefined();
            expect(pattern.triple.subject).toBe('person');
            expect(pattern.triple.predicate).toBe(`${SNVOC_PREFIX}likes`);
            expect((pattern.triple.object as Term).termType).toBe('BlankNode');
          }

          expect(resp.union).toBeDefined();
          const unions = resp.union!;
          expect(unions.length).toBe(1);
          const union = unions[0];
          expect(union.length).toBe(2);
          expect(union[0].starPatterns.size).toBe(1);
          for (const starPattern of union[0].starPatterns.values() ?? []) {
            expect(starPattern.name).toBeDefined();
            expect(starPattern.isVariable).toBe(false);

            for (const pattern of starPattern.starPattern.values() ?? []) {
              expect(pattern.dependencies).toBeDefined();
              expect(pattern.dependencies).toEqual<IStarPatternWithDependencies>(messageStarPattern[1]);
              expect(pattern.triple.subject).toBeDefined();
              expect(pattern.triple.predicate).toBe(`${SNVOC_PREFIX}hasPost`);
              expect(pattern.triple.object).toEqual<Variable>(DF.variable('message'));
            }
          }

          expect(union[1].starPatterns.size).toBe(1);
          for (const starPattern of union[1].starPatterns.values() ?? []) {
            expect(starPattern.name).toBeDefined();
            expect(starPattern.isVariable).toBe(false);

            for (const pattern of starPattern.starPattern.values() ?? []) {
              expect(pattern.dependencies).toBeDefined();
              expect(pattern.dependencies).toEqual<IStarPatternWithDependencies>(messageStarPattern[1]);
              expect(pattern.triple.subject).toBeDefined();
              expect(pattern.triple.predicate).toBe(`${SNVOC_PREFIX}hasComment`);
              expect(pattern.triple.object).toEqual<Variable>(DF.variable('message'));
            }
          }
        });
      });

      describe("complex", () => {
        /** 
        test('interactive-complex-1', ()=>{
          const query = `
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
              (?frId AS ?friendId)
              (?last AS ?friendLastName)
              (MIN(?dist) AS ?distanceFromPerson)
              (?bday AS ?friendBirthday)
              (?since AS ?friendCreationDate)
              (?gen AS ?friendGender)
              (?browser AS ?friendBrowserUsed)
              (?locationIP AS ?friendLocationIp)
              (?emails AS ?friendEmails)
              (?languages AS ?friendLanguages)
              (?based AS ?friendCityName)
              (?studies AS ?friendUniversities)
              (?jobs AS ?friendCompanies)
          {
              {
                  SELECT
                      ?fr
                      ?emails
                      ?dist
                      (GROUP_CONCAT(?language;separator=", ") AS ?languages)
                  WHERE
                  {
                      {
                          SELECT
                              ?fr
                              ?dist
                              (GROUP_CONCAT(?email;separator=", ") AS ?emails)
                          WHERE
                          {
                              {
                                  SELECT
                                      ?fr
                                      (MIN(?distInner) AS ?dist)
                                  WHERE
                                  {
                                      ?rootPerson a snvoc:Person .
                                      ?rootPerson snvoc:id ?rootId .
                                      ?rootPerson snvoc:id ?rootId .
                                      ?fr a snvoc:Person .
                                      {
                                          ?rootPerson (snvoc:knows/snvoc:hasPerson)|^(snvoc:knows/snvoc:hasPerson) ?fr .
                                          BIND( 1 AS ?distOneInner )
                                      } UNION {
                                          ?rootPerson ((snvoc:knows/snvoc:hasPerson)|^(snvoc:knows/snvoc:hasPerson))/((snvoc:knows/snvoc:hasPerson)|^(snvoc:knows/snvoc:hasPerson)) ?fr .
                                          BIND( 2 AS ?distTwoInner )
                                      } UNION {
                                          ?rootPerson ((snvoc:knows/snvoc:hasPerson)|^(snvoc:knows/snvoc:hasPerson))/((snvoc:knows/snvoc:hasPerson)|^(snvoc:knows/snvoc:hasPerson))/((snvoc:knows/snvoc:hasPerson)|^(snvoc:knows/snvoc:hasPerson)) ?fr .
                                      }
                                      ?fr snvoc:id ?frId .
                                      FILTER(?frId != ?rootId) .
                                      ?fr snvoc:firstName $firstName .
                                      BIND( IF(COALESCE(?distOneInner, 4) < 4, 1, IF(COALESCE(?distTwoInner, 4) < 4, 2, 3)) AS ?distInner)
                                  }
                                  GROUP BY ?fr
                              }
                              ?fr snvoc:email ?email .
                          }
                          GROUP BY ?fr ?dist
                      }
                      ?fr snvoc:speaks ?language
                  }
                  GROUP BY ?fr ?emails ?dist
              }
              ?fr snvoc:id ?frId .
              ?fr snvoc:lastName ?last .
              ?fr snvoc:birthday ?bday .
              ?fr snvoc:isLocatedIn ?basedURI .
              ?basedURI foaf:name ?based .
              ?fr snvoc:creationDate ?since .
              ?fr snvoc:gender ?gen .
              ?fr snvoc:locationIP ?locationIP .
              ?fr snvoc:browserUsed ?browser .
              OPTIONAL {
                  {
                      SELECT
                          (?frInner AS ?frInnerUni)
                          (GROUP_CONCAT(CONCAT(?uniName, " ", xsd:string(?classYear), " ", ?uniCountry);separator=", ") AS ?studies)
                      {
                          SELECT DISTINCT
                              ?frInner
                              ?uniName
                              ?classYear
                              ?uniCountry
                          {
                              ?frInner a snvoc:Person .
                              ?frInner snvoc:studyAt ?study .
                              ?study snvoc:hasOrganisation ?uni .
                              ?uni foaf:name ?uniName .
                              ?study snvoc:classYear ?classYear .
                              ?uni snvoc:isLocatedIn/foaf:name ?uniCountry .
                          }
                      }
                      GROUP BY ?frInner
                  } .
                  ?frInnerUni snvoc:id ?frInnerUniId .
                  FILTER( ?frId = ?frInnerUniId)
              } .
              OPTIONAL {
                  {
                      SELECT
                          (?frInner AS ?frInnerComp)
                          (GROUP_CONCAT(CONCAT(?companyName, " ", xsd:string(?workFrom), " ", ?companyCountry);separator=", ") AS ?jobs)
                      {
                          SELECT DISTINCT
                              ?frInner
                              ?companyName
                              ?workFrom
                              ?companyCountry
                          {
                              ?frInner a snvoc:Person .
                              ?frInner snvoc:workAt ?work .
                              ?work snvoc:hasOrganisation ?company .
                              ?work snvoc:workFrom ?workFrom .
                              ?company snvoc:isLocatedIn/foaf:name ?companyCountry .
                              ?company foaf:name ?companyName
                          }
                      }
                      GROUP BY ?frInner
                  } .
                  ?frInnerComp snvoc:id ?frInnerCompId .
                  FILTER( ?frId = ?frInnerCompId)
              }
          }
          GROUP BY ?frId ?last ?bday ?since ?gen ?browser ?locationIP ?based ?studies ?jobs ?emails ?languages
          ORDER BY ?distanceFromPerson ?last ?frId
          LIMIT 20
          `;

          const messageCreatorStarPattern: [string, IStarPatternWithDependencies] = [
            'messageCreator',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'messageCreator',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`messageCreatorId`)
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "messageCreator",
              isVariable: true,
            }
          ];

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`messageId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`messageCreator`),
                      isOptional: false
                    }),
                    dependencies: messageCreatorStarPattern[1]
                  }
                ],

              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const replyAuthorStarPattern: [string, IStarPatternWithDependencies] = [
            'replyAuthor',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'replyAuthor',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`replyAuthorId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}firstName`,
                  {
                    triple: new Triple({
                      subject: 'replyAuthor',
                      predicate: `${SNVOC_PREFIX}firstName`,
                      object: DF.variable(`replyAuthorFirstName`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}lastName`,
                  {
                    triple: new Triple({
                      subject: 'replyAuthor',
                      predicate: `${SNVOC_PREFIX}lastName`,
                      object: DF.variable(`replyAuthorLastName`)
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name:'replyAuthor',
              isVariable:true
            }
          ];
          const commentStarPattern: [string, IStarPatternWithDependencies] = [
            'comment',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}replyOf`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}replyOf`,
                      object: DF.variable(`message`)
                    }),
                    dependencies: messageStarPattern[1]
                  }
                ],
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Comment`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`commentId`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}content`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}content`,
                      object: DF.variable(`commentContent`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}creationDate`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}creationDate`,
                      object: DF.variable(`commentCreationDate`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`replyAuthor`)
                    }),
                    dependencies: replyAuthorStarPattern[1]
                  }
                ],
              ]),
              name: "comment",
              isVariable: true,
            }
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            messageCreatorStarPattern,
            messageStarPattern,
            replyAuthorStarPattern,
            commentStarPattern,
          ]);

          const knowFirstBranchInter = DF.blankNode(`${SNVOC_PREFIX}knows_messageCreator`);
          const messageCreatorDirectKnowPath1: [string, IStarPatternWithDependencies] =[
            'messageCreator',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}knows`,
                  {
                    triple: new Triple({
                      subject: 'messageCreator',
                      predicate: `${SNVOC_PREFIX}knows`,
                      object: knowFirstBranchInter,
                      isOptional:true
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "messageCreator",
              isVariable:true
            }
          ];

          const messageCreatorDirectKnowPath2: [string, IStarPatternWithDependencies] =[
            knowFirstBranchInter.value,
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasPerson`,
                  {
                    triple: new Triple({
                      subject: knowFirstBranchInter.value,
                      predicate: `${SNVOC_PREFIX}hasPerson`,
                      object: DF.variable("replyAuthor"),
                      isOptional:true
                    }),
                    dependencies: replyAuthorStarPattern[1]
                  }
                ]
              ]),
              name: knowFirstBranchInter.value,
              isVariable:false
            }
          ];

          const knowSecondBranchInter = DF.blankNode(`${SNVOC_PREFIX}knows_replyAuthor`);
          const messageCreatorUnDirectKnowPath1: [string, IStarPatternWithDependencies] =[
            'replyAuthor',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}knows`,
                  {
                    triple: new Triple({
                      subject: 'replyAuthor',
                      predicate: `${SNVOC_PREFIX}knows`,
                      object: knowSecondBranchInter,
                      isOptional:true
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "replyAuthor",
              isVariable:true
            }
          ];

          const messageCreatorUnDirectKnowPath2: [string, IStarPatternWithDependencies] =[
            knowSecondBranchInter.value,
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasPerson`,
                  {
                    triple: new Triple({
                      subject: knowSecondBranchInter.value,
                      predicate: `${SNVOC_PREFIX}hasPerson`,
                      object: DF.variable("messageCreator"),
                      isOptional:true
                    }),
                    dependencies: messageCreatorStarPattern[1]
                  }
                ]
              ]),
              name: knowSecondBranchInter.value,
              isVariable:false
            }
          ];

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject));
          }
        });
        */

        test('interactive-complex-2', () => {
          const query = `
            # Recent messages by your friends
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
                (?frId AS ?personId)
                (?first AS ?personFirstName)
                (?last AS ?personLastName)
                ?messageId
                (?content AS ?messageContent)
                (?creationDate AS ?messageCreationDate)
            WHERE
            {
                VALUES (?type) {(snvoc:Comment) (snvoc:Post)}
                {
                    SELECT DISTINCT
                        ?fr
                    WHERE {
                        ?rootPerson a snvoc:Person .
                        ?fr a snvoc:Person .
                        ?rootPerson ((snvoc:knows/snvoc:hasPerson)|^(snvoc:knows/snvoc:hasPerson)) ?fr
                    }
                }
                ?message snvoc:hasCreator ?fr .
                ?message a ?type
                {
                    {
                        ?message snvoc:content ?content
                    } UNION {
                        ?message snvoc:imageFile ?content
                    }
                } .
                ?message snvoc:creationDate ?creationDate .
                ?message snvoc:id ?messageId .
                FILTER (?creationDate <= ?maxDate) .
                ?fr snvoc:firstName ?first .
                ?fr snvoc:lastName ?last .
                ?fr snvoc:id ?frId .
            }
            ORDER BY DESC(?creationDate) ?message
            LIMIT 20
            `;
          const rootPersonStarPattern: [string, IStarPatternWithDependencies] = [
            'rootPerson',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'rootPerson',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Person`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "rootPerson",
              isVariable: true,
            },
          ];

          const frStarPattern: [string, IStarPatternWithDependencies] = [
            'fr',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'fr',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Person`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}firstName`,
                  {
                    triple: new Triple({
                      subject: 'fr',
                      predicate: `${SNVOC_PREFIX}firstName`,
                      object: DF.variable("first")
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}lastName`,
                  {
                    triple: new Triple({
                      subject: 'fr',
                      predicate: `${SNVOC_PREFIX}lastName`,
                      object: DF.variable("last")
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'fr',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable("frId")
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "fr",
              isVariable: true,
            },
          ];

          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable(`fr`)
                    }),
                    dependencies: frStarPattern[1]
                  }
                ],
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: RDF_TYPE,
                      object: [
                        DF.namedNode(`${SNVOC_PREFIX}Comment`),
                        DF.namedNode(`${SNVOC_PREFIX}Post`),
                      ]
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}creationDate`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}creationDate`,
                      object: DF.variable(`creationDate`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable(`messageId`)
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,
            },
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            rootPersonStarPattern,
            frStarPattern,
            messageStarPattern,
          ]);

          const rootPersonFirstBranch: [string, IStarPatternWithDependencies] = [
            'rootPerson',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}knows`,
                  {
                    triple: new Triple({
                      subject: 'rootPerson',
                      predicate: `${SNVOC_PREFIX}knows`,
                      object: DF.blankNode(`${SNVOC_PREFIX}knows_rootPerson`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "rootPerson",
              isVariable: true,
            },
          ];

          const rootPersonFirstBranchSeq: [string, IStarPatternWithDependencies] = [
            `${SNVOC_PREFIX}knows_rootPerson`,
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasPerson`,
                  {
                    triple: new Triple({
                      subject: `${SNVOC_PREFIX}knows_rootPerson`,
                      predicate: `${SNVOC_PREFIX}hasPerson`,
                      object: DF.variable(`fr`)
                    }),
                    dependencies: frStarPattern[1]
                  }
                ]
              ]),
              name: `${SNVOC_PREFIX}knows_rootPerson`,
              isVariable: false,
            },
          ];

          const rootPersonSecondBranch: [string, IStarPatternWithDependencies] = [
            'fr',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}knows`,
                  {
                    triple: new Triple({
                      subject: 'fr',
                      predicate: `${SNVOC_PREFIX}knows`,
                      object: DF.blankNode(`${SNVOC_PREFIX}knows_fr`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "fr",
              isVariable: true,
            },
          ];

          const rootPersonSecondBranchSeq: [string, IStarPatternWithDependencies] = [
            `${SNVOC_PREFIX}knows_fr`,
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasPerson`,
                  {
                    triple: new Triple({
                      subject: `${SNVOC_PREFIX}knows_fr`,
                      predicate: `${SNVOC_PREFIX}hasPerson`,
                      object: DF.variable(`rootPerson`)
                    }),
                    dependencies: rootPersonStarPattern[1]
                  }
                ]
              ]),
              name: `${SNVOC_PREFIX}knows_fr`,
              isVariable: false,
            },
          ];

          const unionMessageContent: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}content`,
                  {
                    triple: new Triple({
                      subject: `message`,
                      predicate: `${SNVOC_PREFIX}content`,
                      object: DF.variable(`content`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: 'message',
              isVariable: true
            }
          ];

          const unionMessageImageFile: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}imageFile`,
                  {
                    triple: new Triple({
                      subject: `message`,
                      predicate: `${SNVOC_PREFIX}imageFile`,
                      object: DF.variable(`content`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: 'message',
              isVariable: true
            }
          ];

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeDefined();
          expect(resp.union?.length).toBe(2);

          const firstUnion = resp.union![0];
          expect(firstUnion.length).toBe(2);

          const firstBranchFirstUnion = firstUnion[0];
          const secondBranchFirstUnion = firstUnion[1];

          expect(firstBranchFirstUnion.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([rootPersonFirstBranch, rootPersonFirstBranchSeq]));
          expect(firstBranchFirstUnion.union).toBeUndefined();

          expect(secondBranchFirstUnion.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([rootPersonSecondBranch, rootPersonSecondBranchSeq]));
          expect(secondBranchFirstUnion.union).toBeUndefined();

          const secondUnion = resp.union![1];
          expect(secondUnion.length).toBe(2);

          const firstBranchSecondUnion = secondUnion[0];
          const secondBranchSecondUnion = secondUnion[1];

          expect(firstBranchSecondUnion.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([unionMessageContent]));
          expect(firstBranchSecondUnion.union).toBeUndefined();

          expect(secondBranchSecondUnion.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([unionMessageImageFile]));
          expect(secondBranchSecondUnion.union).toBeUndefined();
        });

        test('interactive-complex-4', () => {
          const query = `
            # Recent messages by your friends
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
                ?tagName
                (COUNT(*) AS ?postCount)
            WHERE {
                BIND( ?startDate + STRDT(CONCAT("P", ?durationDays, "D"), xsd:duration) AS ?endDate ) .
                ?rootPerson a snvoc:Person .
                ?rootPerson ((snvoc:knows/snvoc:hasPerson)|^(snvoc:knows/snvoc:hasPerson)) ?fr .
                ?post a snvoc:Post .
                ?post snvoc:hasCreator ?fr .
                ?post snvoc:hasTag ?tag .
                ?tag foaf:name ?tagName .
                ?post snvoc:creationDate ?creationDate .
                FILTER (?creationDate >= ?startDate && ?creationDate <= ?endDate ) .
                FILTER NOT EXISTS {
                    ?rootPerson ((snvoc:knows/snvoc:hasPerson)|^(snvoc:knows/snvoc:hasPerson)) ?fr2 .
                    ?post2 snvoc:hasCreator ?fr2 .
                    ?post2 a snvoc:Post .
                    ?post2 snvoc:hasTag ?tag .
                    ?post2 snvoc:creationDate ?creationDate2 .
                    FILTER (?creationDate2 < ?startDate)
                }
            }
            GROUP BY ?tagName
            ORDER BY DESC(?postCount) ?tagName
            LIMIT 10
            `;
          const rootPersonStarPattern: [string, IStarPatternWithDependencies] = [
            'rootPerson',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'rootPerson',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Person`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "rootPerson",
              isVariable: true,
            },
          ];

          const tagStarPattern: [string, IStarPatternWithDependencies] = [
            'tag',
            {
              starPattern: new Map([
                [
                  `${FOAF_PREFIX}name`,
                  {
                    triple: new Triple({
                      subject: 'tag',
                      predicate: `${FOAF_PREFIX}name`,
                      object: DF.variable('tagName')
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: 'tag',
              isVariable: true
            }
          ];

          const postStarPattern: [string, IStarPatternWithDependencies] = [
            'post',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'post',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Post`)
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'post',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable('fr')
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasTag`,
                  {
                    triple: new Triple({
                      subject: 'post',
                      predicate: `${SNVOC_PREFIX}hasTag`,
                      object: DF.variable('tag')
                    }),
                    dependencies: tagStarPattern[1]
                  }
                ],
                [
                  `${SNVOC_PREFIX}creationDate`,
                  {
                    triple: new Triple({
                      subject: 'post',
                      predicate: `${SNVOC_PREFIX}creationDate`,
                      object: DF.variable('creationDate')
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: 'post',
              isVariable: true
            }
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            rootPersonStarPattern,
            tagStarPattern,
            postStarPattern,
          ]);

          const rootPersonFirstBranch: [string, IStarPatternWithDependencies] = [
            'rootPerson',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}knows`,
                  {
                    triple: new Triple({
                      subject: 'rootPerson',
                      predicate: `${SNVOC_PREFIX}knows`,
                      object: DF.blankNode(`${SNVOC_PREFIX}knows_rootPerson`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "rootPerson",
              isVariable: true,
            },
          ];

          const rootPersonFirstBranchSeq: [string, IStarPatternWithDependencies] = [
            `${SNVOC_PREFIX}knows_rootPerson`,
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasPerson`,
                  {
                    triple: new Triple({
                      subject: `${SNVOC_PREFIX}knows_rootPerson`,
                      predicate: `${SNVOC_PREFIX}hasPerson`,
                      object: DF.variable(`fr`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: `${SNVOC_PREFIX}knows_rootPerson`,
              isVariable: false,
            },
          ];

          const rootPersonSecondBranch: [string, IStarPatternWithDependencies] = [
            'fr',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}knows`,
                  {
                    triple: new Triple({
                      subject: 'fr',
                      predicate: `${SNVOC_PREFIX}knows`,
                      object: DF.blankNode(`${SNVOC_PREFIX}knows_fr`)
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "fr",
              isVariable: true,
            },
          ];

          const rootPersonSecondBranchSeq: [string, IStarPatternWithDependencies] = [
            `${SNVOC_PREFIX}knows_fr`,
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasPerson`,
                  {
                    triple: new Triple({
                      subject: `${SNVOC_PREFIX}knows_fr`,
                      predicate: `${SNVOC_PREFIX}hasPerson`,
                      object: DF.variable(`rootPerson`)
                    }),
                    dependencies: rootPersonStarPattern[1]
                  }
                ]
              ]),
              name: `${SNVOC_PREFIX}knows_fr`,
              isVariable: false,
            },
          ];

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }

          expect(resp.union).toBeDefined();
          expect(resp.union?.length).toBe(1);

          const firstUnion = resp.union![0];
          expect(firstUnion.length).toBe(2);

          const firstBranchFirstUnion = firstUnion[0];
          const secondBranchFirstUnion = firstUnion[1];

          expect(firstBranchFirstUnion.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([rootPersonFirstBranch, rootPersonFirstBranchSeq]));
          expect(firstBranchFirstUnion.union).toBeUndefined();

          expect(secondBranchFirstUnion.starPatterns).toEqual<Map<string, IStarPatternWithDependencies>>(new Map([rootPersonSecondBranch, rootPersonSecondBranchSeq]));
          expect(secondBranchFirstUnion.union).toBeUndefined();
        });

        test('interactive-complex-8', () => {
          const query = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            PREFIX snvoc: <http://localhost:3000/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/>
            SELECT ?personId ?personFirstName ?personLastName ?commentCreationDate ?commentId ?commentContent WHERE {
              VALUES ?type {
                snvoc:Comment
                snvoc:Post
              }
              <http://localhost:3000/pods/00000002199023256816/profile/card#me> rdf:type snvoc:Person.
              ?message snvoc:hasCreator <http://localhost:3000/pods/00000002199023256816/profile/card#me>;
                rdf:type ?type.
              ?comment rdf:type snvoc:Comment;
                snvoc:replyOf ?message;
                snvoc:creationDate ?commentCreationDate;
                snvoc:id ?commentId;
                snvoc:content ?commentContent;
                snvoc:hasCreator ?person.
              ?person snvoc:id ?personId;
                snvoc:firstName ?personFirstName;
                snvoc:lastName ?personLastName.
            }
            ORDER BY DESC (?commentCreationDate) (?commentId)
            LIMIT 20`;

          const meStarPattern: [string, IStarPatternWithDependencies] = [
            'http://localhost:3000/pods/00000002199023256816/profile/card#me',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'http://localhost:3000/pods/00000002199023256816/profile/card#me',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Person`)
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: 'http://localhost:3000/pods/00000002199023256816/profile/card#me',
              isVariable: false,

            }
          ];
          const messageStarPattern: [string, IStarPatternWithDependencies] = [
            'message',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.namedNode("http://localhost:3000/pods/00000002199023256816/profile/card#me"),
                    }),
                    dependencies: meStarPattern[1]
                  }
                ],
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'message',
                      predicate: RDF_TYPE,
                      object: [DF.namedNode(`${SNVOC_PREFIX}Comment`), DF.namedNode(`${SNVOC_PREFIX}Post`)]
                    }),
                    dependencies: undefined
                  }
                ],
              ]),
              name: "message",
              isVariable: true,

            }
          ];
          const personStarPattern: [string, IStarPatternWithDependencies] = [
            'person',
            {
              starPattern: new Map([
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable("personId"),
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}firstName`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}firstName`,
                      object: DF.variable("personFirstName"),
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}lastName`,
                  {
                    triple: new Triple({
                      subject: 'person',
                      predicate: `${SNVOC_PREFIX}lastName`,
                      object: DF.variable("personLastName"),
                    }),
                    dependencies: undefined
                  }
                ]
              ]),
              name: "person",
              isVariable: true,

            }
          ];
          const commentStarPattern: [string, IStarPatternWithDependencies] = [
            'comment',
            {
              starPattern: new Map([
                [
                  RDF_TYPE,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: RDF_TYPE,
                      object: DF.namedNode(`${SNVOC_PREFIX}Comment`),
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}replyOf`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}replyOf`,
                      object: DF.variable("message"),
                    }),
                    dependencies: messageStarPattern[1]
                  }
                ],
                [
                  `${SNVOC_PREFIX}creationDate`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}creationDate`,
                      object: DF.variable("commentCreationDate"),
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}id`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}id`,
                      object: DF.variable("commentId"),
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}content`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}content`,
                      object: DF.variable("commentContent"),
                    }),
                    dependencies: undefined
                  }
                ],
                [
                  `${SNVOC_PREFIX}hasCreator`,
                  {
                    triple: new Triple({
                      subject: 'comment',
                      predicate: `${SNVOC_PREFIX}hasCreator`,
                      object: DF.variable("person"),
                    }),
                    dependencies: personStarPattern[1]
                  }
                ]
              ]),
              name: "comment",
              isVariable: true,

            }
          ];

          const expectedStarPattern = new Map<string, IStarPatternWithDependencies>([
            meStarPattern,
            messageStarPattern,
            commentStarPattern,
            personStarPattern
          ]);

          const resp = generateQuery(toAlgebra(sparqlParser.parse(query)));

          expect(resp.starPatterns.size).toBe(expectedStarPattern.size);
          expect(resp.filterExpression).toBe('');
          for (const [subject, starPatterns] of resp.starPatterns) {
            expect(starPatterns).toEqual<IStarPatternWithDependencies>(expectedStarPattern.get(subject)!);
          }
        });

      });

    });
  });

  describe("generateStarPatternUnion", () => {
    it("should generate no star pattern union given an empty union", () => {
      const union: IQuery[][] = [];
      const starPatternName = "foo";

      const expectedStarPattern: IStarPatternWithDependencies[][] = [];

      const resp = generateStarPatternUnion(union, starPatternName);

      expect(resp).toStrictEqual(expectedStarPattern);

    });

    it("should generate no star pattern given the star pattern name is not present in the union", () => {
      const union: any[][] = [
        [
          {
            starPatterns: new Map([["foo1", true], ["foo2", true], ["foo3", true]])
          },
          {
            starPatterns: new Map([["foo4", true], ["foo5", true], ["foo6", true]])
          }
        ],
        [
          {
            starPatterns: new Map([["foo7", true], ["foo8", true]])
          },
          {
            starPatterns: new Map([["foo9", true]])
          }
        ]
      ];
      const starPatternName = "foo";

      const expectedStarPattern: IStarPatternWithDependencies[][] = [];

      const resp = generateStarPatternUnion(union, starPatternName);

      expect(resp).toStrictEqual(expectedStarPattern);
    });

    it("should generate a star pattern given the star pattern name is not present in the union", () => {
      const union: any[][] = [
        [
          {
            starPatterns: new Map([["foo", "foo"], ["foo2", "foo2"], ["foo3", "foo3"]])
          },
          {
            starPatterns: new Map([["foo", "foo_1"], ["foo5", "foo5"], ["foo6", "foo6"]])
          }
        ],
        [
          {
            starPatterns: new Map([["foo7", "foo7"], ["foo8", "foo8"]])
          },
          {
            starPatterns: new Map([["foo9", "foo9"]])
          }
        ],
        [
          {
            starPatterns: new Map([["foo", "foo_2"]])
          },
          {
            starPatterns: new Map([["foo10", "foo10"], ["foo11", "foo11"]])
          }
        ],
      ];
      const starPatternName = "foo";

      const expectedStarPattern: any[][] = [
        ["foo", "foo_1"],
        ["foo_2"]
      ];

      const resp = generateStarPatternUnion(union, starPatternName);

      expect(resp).toStrictEqual(expectedStarPattern);
    });
  })
});

