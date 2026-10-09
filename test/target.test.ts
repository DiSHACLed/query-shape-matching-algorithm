import { Parser as SPARQLParser } from '@traqula/parser-sparql-1-1';
import { toAlgebra } from '@traqula/algebra-sparql-1-1';
import * as N3 from 'n3';
import { describe, expect, it } from 'vitest';
import type { IShape } from '../lib/Shape';
import { shaclShapeFromQuads } from '../lib/shacl';
import { generateQuery, shapeToQuery, type IQuery } from '../lib/query';
import { ContainmentResult, solveShapeQueryContainment, solveShapeShapeContainment } from '../lib/containment';
import { RDF } from '../lib/constant';

const EX = 'http://example.org/';
const PREFIXES = `
    @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    @prefix owl: <http://www.w3.org/2002/07/owl#> .
    @prefix ex: <http://example.org/> .
`;

async function parseShape(ttl: string, name: string): Promise<IShape> {
    const shape = await shaclShapeFromQuads(new N3.Parser().parse(PREFIXES + ttl), `${EX}${name}`);
    if (shape instanceof Error) {
        throw shape;
    }
    return shape;
}

function parseQuery(body: string): IQuery {
    return generateQuery(toAlgebra(new SPARQLParser().parse(`PREFIX ex: <${EX}> SELECT * WHERE { ${body} }`)));
}

function classify(body: string, shapes: IShape[]): ContainmentResult {
    return solveShapeQueryContainment({ query: parseQuery(body), shapes }).result;
}

describe('SHACL targets', () => {
    describe('parsing', () => {
        it('should parse every kind of target, keeping a literal node target apart from an IRI', async () => {
            const shape = await parseShape(`
                ex:S a sh:NodeShape ;
                    sh:targetNode ex:Alice, "Alice" ;
                    sh:targetClass ex:Person ;
                    sh:targetSubjectsOf ex:knows ;
                    sh:targetObjectsOf ex:follows ;
                    sh:property [ sh:path ex:name ] .`, 'S');
            expect(shape.toObject().targets).toStrictEqual({
                nodes: [`${EX}Alice`, '"Alice"'],
                classes: [`${EX}Person`],
                subjectsOf: [`${EX}knows`],
                objectsOf: [`${EX}follows`],
            });
        });

        it('should give a shape that is also a class an implicit class target', async () => {
            const direct = await parseShape(`ex:Place a rdfs:Class, sh:NodeShape ; sh:property [ sh:path ex:name ] .`, 'Place');
            expect(direct.toObject().targets?.classes).toStrictEqual([`${EX}Place`]);

            // owl:Class is a SHACL instance of rdfs:Class only when the shapes graph says so
            const owl = `ex:Place a owl:Class, sh:NodeShape ; sh:property [ sh:path ex:name ] .`;
            expect((await parseShape(owl, 'Place')).toObject().targets).toBeUndefined();
            const owlSubClass = await parseShape(`owl:Class rdfs:subClassOf rdfs:Class . ${owl}`, 'Place');
            expect(owlSubClass.toObject().targets?.classes).toStrictEqual([`${EX}Place`]);
        });

        it('should accept a shape that only declares targets', async () => {
            const shape = await parseShape(`ex:S a sh:NodeShape ; sh:targetClass ex:Place .`, 'S');
            expect(shape.positivePredicates).toStrictEqual([]);
            expect(shape.toObject().targets?.classes).toStrictEqual([`${EX}Place`]);
        });

        it('should parse sh:ignoredProperties and leave the object of a shape without targets unchanged', async () => {
            const shape = await parseShape(`
                ex:S a sh:NodeShape ; sh:closed true ; sh:ignoredProperties ( rdf:type ex:label ) ;
                    sh:property [ sh:path ex:name ] .`, 'S');
            expect(shape.toObject().ignoredProperties).toStrictEqual([RDF.type, `${EX}label`]);
            expect(Object.keys(shape.toObject())).not.toContain('targets');
        });
    });

    describe('translation of an input shape', () => {
        it('should require rdf:type for a class target and the predicate for a subjects-of target', async () => {
            const classQuery = shapeToQuery(await parseShape(`
                ex:In a sh:NodeShape ; sh:targetClass ex:Place ; sh:property [ sh:path ex:name ; sh:minCount 1 ] .`, 'In'));
            const typeTriple = classQuery.starPatterns.get(`${EX}In`)!.starPattern.get(RDF.type)!.triple;
            expect(typeTriple.isOptional).toBe(false);
            expect(typeTriple.object).toEqual(expect.objectContaining({ termType: 'NamedNode', value: `${EX}Place` }));

            // an optional constraint on the predicate becomes required
            const subjectsQuery = shapeToQuery(await parseShape(`
                ex:In a sh:NodeShape ; sh:targetSubjectsOf ex:knows ; sh:property [ sh:path ex:knows ] .`, 'In'));
            expect(subjectsQuery.starPatterns.get(`${EX}In`)!.starPattern.get(`${EX}knows`)!.triple.isOptional).toBe(false);
        });

        it('should restrict the subject for node targets and add an incoming pattern for an objects-of target', async () => {
            const nodeQuery = shapeToQuery(await parseShape(`
                ex:In a sh:NodeShape ; sh:targetNode ex:Alice, ex:Bob ; sh:property [ sh:path ex:name ; sh:minCount 1 ] .`, 'In'));
            expect(nodeQuery.starPatterns.get(`${EX}In`)!.subjectValues).toStrictEqual(new Set([`${EX}Alice`, `${EX}Bob`]));

            const objectsQuery = shapeToQuery(await parseShape(`
                ex:In a sh:NodeShape ; sh:targetObjectsOf ex:knows ; sh:property [ sh:path ex:name ; sh:minCount 1 ] .`, 'In'));
            const incoming = objectsQuery.starPatterns.get(`${EX}In#targetObjectsOf`)!;
            expect(incoming.starPattern.get(`${EX}knows`)!.dependencies?.name).toBe(`${EX}In`);
        });

        it('should turn several targets into UNION branches, and ignore combinations it cannot represent', async () => {
            const union = shapeToQuery(await parseShape(`
                ex:In a sh:NodeShape ; sh:targetClass ex:Place, ex:City ; sh:targetSubjectsOf ex:knows ;
                    sh:property [ sh:path ex:name ; sh:minCount 1 ] .`, 'In'));
            expect(union.union).toHaveLength(1);
            expect(union.union![0]).toHaveLength(3);
            expect(union.unsupported).toBeUndefined();

            const mixed = shapeToQuery(await parseShape(`
                ex:In a sh:NodeShape ; sh:targetNode ex:Alice ; sh:targetClass ex:Place ;
                    sh:property [ sh:path ex:name ; sh:minCount 1 ] .`, 'In'));
            expect(mixed.unsupported).toStrictEqual(['TARGETS']);
            expect(mixed.starPatterns.get(`${EX}In`)!.starPattern.has(RDF.type)).toBe(false);
            expect(mixed.starPatterns.get(`${EX}In`)!.subjectValues).toBeUndefined();
        });

        it('should not translate the targets of a shape reached through sh:node', async () => {
            const ttl = `
                ex:In a sh:NodeShape ; sh:property [ sh:path ex:address ; sh:node ex:Address ; sh:minCount 1 ] .
                ex:Address a sh:NodeShape ; sh:targetClass ex:Address ; sh:property [ sh:path ex:city ; sh:minCount 1 ] .`;
            const query = shapeToQuery(await parseShape(ttl, 'In'), { linkedShapes: [await parseShape(ttl, 'Address')] });
            expect(query.starPatterns.get(`${EX}Address`)!.starPattern.has(RDF.type)).toBe(false);
        });

        it('should ask for any triple about the target nodes of a shape without constraints', async () => {
            const query = shapeToQuery(await parseShape(`ex:In a sh:NodeShape ; sh:targetNode ex:Alice .`, 'In'));
            expect(query.starPatterns.size).toBe(0);
            expect(query.matchesAnyTriple).toBe(true);
        });
    });

    describe('class targets of resource shapes', () => {
        const typedQuery = '?x a ex:Place ; ex:name ?name .';

        it('should match rdf:type against a class target, on open and closed shapes', async () => {
            const open = await parseShape(`ex:R a sh:NodeShape ; sh:targetClass ex:Place ; sh:property [ sh:path ex:name ] .`, 'R');
            const closed = await parseShape(`ex:R a sh:NodeShape ; sh:targetClass ex:Place ; sh:closed true ;
                sh:property [ sh:path ex:name ] .`, 'R');
            const ignoring = await parseShape(`ex:R a sh:NodeShape ; sh:targetClass ex:Place ; sh:closed true ;
                sh:ignoredProperties ( rdf:type ) ; sh:property [ sh:path ex:name ] .`, 'R');
            for (const shape of [open, closed, ignoring]) {
                expect(classify(typedQuery, [shape])).toBe(ContainmentResult.CONTAINED);
            }
        });

        it('should not contain a request for another class', async () => {
            const person = await parseShape(`ex:R a sh:NodeShape ; sh:targetClass ex:Person ; sh:property [ sh:path ex:name ] .`, 'R');
            expect(classify(typedQuery, [person])).toBe(ContainmentResult.ALIGNED);
        });

        it('should only reject the star patterns whose nodes are in the target of a closed shape', async () => {
            const closedPerson = await parseShape(`ex:R a sh:NodeShape ; sh:targetClass ex:Person ; sh:closed true ;
                sh:property [ sh:path ex:name ] .`, 'R');
            // places need not be persons, so the shape says nothing about them
            expect(classify('?x a ex:Place ; ex:latitude ?l .', [closedPerson])).toBe(ContainmentResult.WEAKLY_REJECTED);
            // a closed shape without targets still describes every node
            const closedUntargeted = await parseShape(`ex:R a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:name ] .`, 'R');
            expect(classify('?x a ex:Place ; ex:latitude ?l .', [closedUntargeted])).toBe(ContainmentResult.REJECTED);
        });

        it('should classify an input shape by its class target', async () => {
            const input = await parseShape(`ex:In a sh:NodeShape ; sh:targetClass ex:Place ;
                sh:property [ sh:path ex:name ; sh:minCount 1 ] .`, 'In');
            const place = await parseShape(`ex:R a sh:NodeShape ; sh:targetClass ex:Place ; sh:property [ sh:path ex:name ] .`, 'R');
            const person = await parseShape(`ex:R a sh:NodeShape ; sh:targetClass ex:Person ; sh:property [ sh:path ex:name ] .`, 'R');
            expect(solveShapeShapeContainment({ sourceShape: input, targetShapes: [place] }).result).toBe(ContainmentResult.CONTAINED);
            expect(solveShapeShapeContainment({ sourceShape: input, targetShapes: [person] }).result).toBe(ContainmentResult.ALIGNED);
        });

        it('should require every target alternative of an input shape to be covered, as for sh:or', async () => {
            const input = await parseShape(`ex:In a sh:NodeShape ; sh:targetClass ex:Place, ex:City ;
                sh:property [ sh:path ex:name ; sh:minCount 1 ] .`, 'In');
            const city = await parseShape(`ex:C a sh:NodeShape ; sh:targetClass ex:City ; sh:property [ sh:path ex:name ] .`, 'C');
            const place = await parseShape(`ex:P a sh:NodeShape ; sh:targetClass ex:Place ; sh:property [ sh:path ex:name ] .`, 'P');
            expect(solveShapeShapeContainment({ sourceShape: input, targetShapes: [city] }).result).toBe(ContainmentResult.ALIGNED);
            expect(solveShapeShapeContainment({ sourceShape: input, targetShapes: [city, place] }).result).toBe(ContainmentResult.CONTAINED);
        });

        it('should ignore the targets of a shape reached through sh:node', async () => {
            const ttl = `
                ex:S1 a sh:NodeShape ; sh:property [ sh:path ex:address ; sh:node ex:S2 ] .
                ex:S2 a sh:NodeShape ; sh:targetClass ex:Address ; sh:property [ sh:path ex:city ] .`;
            const s1 = await parseShape(ttl, 'S1');
            const s2 = await parseShape(ttl, 'S2');
            const report = solveShapeQueryContainment({ query: parseQuery('?p ex:address ?a . ?a a ex:Address ; ex:city ?c .'), shapes: [s1, s2] });
            // ex:S2 used on its own describes addresses; through sh:node it does not type the value
            expect(report.starPatternsContainment.get('a')!.result).toBe(ContainmentResult.CONTAINED);
            expect(report.starPatternsContainment.get('p')!.result).toBe(ContainmentResult.ALIGNED);
        });
    });

    describe('node, subjects-of and objects-of targets of resource shapes', () => {
        it('should only contain a constant subject listed by a shape whose targets are node targets', async () => {
            const bob = await parseShape(`ex:R a sh:NodeShape ; sh:targetNode ex:Bob ; sh:property [ sh:path ex:name ] .`, 'R');
            const alice = await parseShape(`ex:R a sh:NodeShape ; sh:targetNode ex:Alice ; sh:property [ sh:path ex:name ] .`, 'R');
            const person = await parseShape(`ex:R a sh:NodeShape ; sh:targetClass ex:Person ; sh:property [ sh:path ex:name ] .`, 'R');
            expect(classify('ex:Alice ex:name ?n .', [bob])).toBe(ContainmentResult.ALIGNED);
            expect(classify('ex:Alice ex:name ?n .', [alice])).toBe(ContainmentResult.CONTAINED);
            // whether ex:Alice is a person cannot be decided, so it is not excluded
            expect(classify('ex:Alice ex:name ?n .', [person])).toBe(ContainmentResult.CONTAINED);
            // a blank node is a variable, not a constant
            expect(classify('_:b ex:name ?n .', [bob])).toBe(ContainmentResult.CONTAINED);
        });

        it('should let a closed shape reject what it forbids for its node targets', async () => {
            const alice = await parseShape(`ex:R a sh:NodeShape ; sh:targetNode ex:Alice ; sh:closed true ;
                sh:property [ sh:path ex:name ] .`, 'R');
            expect(classify('ex:Alice ex:latitude ?l .', [alice])).toBe(ContainmentResult.REJECTED);
            expect(classify('ex:Bob ex:latitude ?l .', [alice])).toBe(ContainmentResult.WEAKLY_REJECTED);
        });

        it('should imply the predicate of a subjects-of target', async () => {
            const knower = await parseShape(`ex:R a sh:NodeShape ; sh:targetSubjectsOf ex:knows ; sh:property [ sh:path ex:name ] .`, 'R');
            expect(classify('?x ex:knows ?y ; ex:name ?n .', [knower])).toBe(ContainmentResult.CONTAINED);
            const input = await parseShape(`ex:In a sh:NodeShape ; sh:targetSubjectsOf ex:knows ;
                sh:property [ sh:path ex:name ; sh:minCount 1 ] .`, 'In');
            expect(solveShapeShapeContainment({ sourceShape: input, targetShapes: [knower] }).result).toBe(ContainmentResult.CONTAINED);
        });

        it('should only require an implied predicate that every focus node carries', async () => {
            const query = '?x ex:name ?n . FILTER NOT EXISTS { ?x ex:knows ?k }';
            // every focus node knows someone, so none can satisfy the negation
            const knowers = await parseShape(`ex:R a sh:NodeShape ; sh:targetSubjectsOf ex:knows ; sh:property [ sh:path ex:name ] .`, 'R');
            expect(classify(query, [knowers])).toBe(ContainmentResult.ALIGNED);
            // a person need not know anyone
            const knowersOrPersons = await parseShape(`ex:R a sh:NodeShape ; sh:targetSubjectsOf ex:knows ; sh:targetClass ex:Person ;
                sh:property [ sh:path ex:name ] .`, 'R');
            expect(classify(query, [knowersOrPersons])).toBe(ContainmentResult.CONTAINED);
        });

        it('should describe the star patterns reached through the predicate of an objects-of target', async () => {
            const knower = await parseShape(`ex:K a sh:NodeShape ; sh:targetSubjectsOf ex:knows ; sh:property [ sh:path ex:knows ] .`, 'K');
            const known = await parseShape(`ex:N a sh:NodeShape ; sh:targetObjectsOf ex:knows ; sh:closed true ;
                sh:property [ sh:path ex:name ] .`, 'N');
            const report = solveShapeQueryContainment({ query: parseQuery('?x ex:knows ?y . ?y ex:latitude ?l .'), shapes: [knower, known] });
            // ex:K says nothing about ?y, while the closed ex:N forbids ex:latitude for it
            expect(report.starPatternsContainment.get('y')!.result).toBe(ContainmentResult.REJECTED);

            const input = await parseShape(`ex:In a sh:NodeShape ; sh:targetObjectsOf ex:knows ;
                sh:property [ sh:path ex:name ; sh:minCount 1 ] .`, 'In');
            expect(solveShapeShapeContainment({ sourceShape: input, targetShapes: [knower, known] }).result).toBe(ContainmentResult.CONTAINED);
        });

        it('should allow the ignored properties of a closed shape', async () => {
            const shape = await parseShape(`ex:R a sh:NodeShape ; sh:closed true ; sh:ignoredProperties ( ex:label ) ;
                sh:property [ sh:path ex:name ] .`, 'R');
            expect(classify('?x ex:label ?l ; ex:name ?n .', [shape])).toBe(ContainmentResult.CONTAINED);
        });
    });
});
