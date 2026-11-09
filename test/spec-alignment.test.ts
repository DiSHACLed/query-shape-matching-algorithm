import { Parser as SPARQLParser } from '@traqula/parser-sparql-1-1';
import { toAlgebra } from '@traqula/algebra-sparql-1-1';
import { describe, expect, it } from 'vitest';
import * as N3 from 'n3';
import { ContainmentResult, EmptyQueryError, solveShapeQueryContainment, solveShapeShapeContainment } from '../lib/containment';
import type { IResult } from '../lib/containment';
import { generateQuery, type IQuery } from '../lib/query';
import { shapeToQuery } from '../lib/shapeToQuery';
import { shaclShapeFromQuads } from '../lib/shacl';
import type { IShape } from '../lib/Shape';

// Each test states what the discovery specification (§5 and §6) prescribes for one input.

const PREFIXES = 'PREFIX ex: <http://example.org/> PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>';
const SHAPE_PREFIXES = `@prefix sh: <http://www.w3.org/ns/shacl#> . @prefix ex: <http://example.org/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`;

async function shapesOf(ttl: string, ...names: string[]): Promise<IShape[]> {
    const quads = new N3.Parser().parse(`${SHAPE_PREFIXES} ${ttl}`);
    return Promise.all(names.map(async name => {
        const shape = await shaclShapeFromQuads(quads, `http://example.org/${name}`);
        if (shape instanceof Error) {
            throw shape;
        }
        return shape;
    }));
}

function query(text: string): IQuery {
    return generateQuery(toAlgebra(new SPARQLParser().parse(`${PREFIXES} ${text}`)));
}

function solve(text: string, shapes: IShape[], dependentShapes: IShape[] = [], decidingShapes?: Set<string>): IResult {
    return solveShapeQueryContainment({ query: query(text), shapes, dependentShapes, decidingShapes });
}

function result(text: string, shapes: IShape[], dependentShapes: IShape[] = [], decidingShapes?: Set<string>): ContainmentResult {
    return solve(text, shapes, dependentShapes, decidingShapes).result;
}

const CLOSED_PQ = 'ex:S a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:p ], [ sh:path ex:q ] .';
const CLOSED_P = 'ex:OnlyP a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:p ] .';

describe('UNION branches', () => {
    it('should classify a subject that has a star pattern in every branch of a UNION', async () => {
        const [closedPq, closedP] = await shapesOf(`${CLOSED_PQ} ${CLOSED_P}`, 'S', 'OnlyP');
        const union = 'SELECT * WHERE { { ?x ex:p ?y } UNION { ?x ex:q ?w } }';
        expect(result(union, [closedPq])).toBe(ContainmentResult.CONTAINED);
        expect(result(union, [closedP])).toBe(ContainmentResult.UNALINGED);
    });

    it('should reject a subject of every branch that no branch can match', async () => {
        const [shape] = await shapesOf('ex:A a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:a ] .', 'A');
        expect(result('SELECT * WHERE { ?x ex:a ?y . { ?y ex:b ?b } UNION { ?y ex:c ?c } }', [shape]))
            .toBe(ContainmentResult.REJECTED);
    });

    it('should require every unresolved branch to be contained by another shape', async () => {
        const [a, b] = await shapesOf(`
            ex:A a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:p ], [ sh:path ex:b1 ] .
            ex:B a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:p ], [ sh:path ex:b2 ] .`, 'A', 'B');
        expect(result('SELECT * WHERE { ?s ex:p ?o . { ?s ex:b1 ?x } UNION { ?s ex:b2 ?y } UNION { ?s ex:b3 ?z } }', [a, b]))
            .toBe(ContainmentResult.UNALINGED);
    });

    it('should accept a match in a branch when the body only has optional triple patterns', async () => {
        const [shape] = await shapesOf('ex:S a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:a ], [ sh:path ex:b ] .', 'S');
        expect(result('SELECT * WHERE { { ?x ex:a ?a } UNION { ?x ex:b ?b } OPTIONAL { ?x ex:nick ?n } }', [shape]))
            .toBe(ContainmentResult.CONTAINED);
    });

    it('should not reject an input shape whose only constraint is a disjunction that a shape partly matches', async () => {
        const [input, closedP] = await shapesOf(`
            ex:In a sh:NodeShape ; sh:or ( [ sh:path ex:p ; sh:minCount 1 ] [ sh:path ex:q ; sh:minCount 1 ] ) .
            ${CLOSED_P}`, 'In', 'OnlyP');
        expect(solveShapeShapeContainment({ sourceShape: input, targetShapes: [closedP] }).result)
            .toBe(ContainmentResult.UNALINGED);
    });

    it('should classify a nested star pattern with the shapes that branch triple patterns reach through sh:node', async () => {
        const [x, a] = await shapesOf(`
            ex:X a sh:NodeShape ; sh:closed true ;
                sh:property [ sh:path ex:p ], [ sh:path ex:addr ; sh:node ex:A ], [ sh:path ex:loc ; sh:node ex:A ] .
            ex:A a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:city ] .`, 'X', 'A');
        expect(result('SELECT * WHERE { ?x ex:p ?y . { ?x ex:addr ?a } UNION { ?x ex:loc ?a } ?a ex:city ?c }',
            [x, a], [], new Set(['http://example.org/X']))).toBe(ContainmentResult.CONTAINED);
    });

    it('should check the branches of a nested star pattern against the referenced shape', async () => {
        const [x, a] = await shapesOf(`
            ex:X a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:addr ; sh:node ex:A ] .
            ex:A a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:city ] .`, 'X', 'A');
        expect(result('SELECT * WHERE { ?x ex:addr ?a . ?a ex:city ?c . { ?a ex:zip ?z } UNION { ?a ex:postal ?p } }', [x], [a]))
            .toBe(ContainmentResult.UNALINGED);
    });

    it('should evaluate the filters of a UNION branch', async () => {
        const [shape] = await shapesOf(`ex:S a sh:NodeShape ; sh:closed true ;
            sh:property [ sh:path ex:a ], [ sh:path ex:age ; sh:datatype xsd:integer ; sh:minInclusive 0 ] .`, 'S');
        expect(result(`SELECT * WHERE { ?x ex:a ?a .
            { ?x ex:age ?g FILTER(?g < 0) } UNION { ?x ex:age ?g FILTER(?g < -5) } }`, [shape]))
            .toBe(ContainmentResult.UNALINGED);
    });

    it('should mark a shape visitable when only a branch triple pattern binds to it', async () => {
        const [shape] = await shapesOf('ex:S a sh:NodeShape ; sh:property [ sh:path ex:email ] .', 'S');
        const report = solve('SELECT * WHERE { ?x ex:name ?n . { ?x ex:email ?e } UNION { ?x ex:phone ?p } }', [shape]);
        expect(report.result).toBe(ContainmentResult.ALIGNED);
        expect(report.visitShapeBoundedResource.get('http://example.org/S')).toBe(true);
    });
});

describe('pattern-shape matches', () => {
    it('should match an object that a class constraint cannot be decided for, but not a literal', async () => {
        const [closed, open] = await shapesOf(`
            ex:C a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:knows ; sh:class ex:Person ] .
            ex:O a sh:NodeShape ; sh:property [ sh:path ex:knows ; sh:class ex:Person ] .`, 'C', 'O');
        expect(result('SELECT * WHERE { ?p ex:knows ?f }', [closed])).toBe(ContainmentResult.CONTAINED);
        expect(result('SELECT * WHERE { ?p ex:knows ?f }', [open])).toBe(ContainmentResult.CONTAINED);
        expect(result('SELECT * WHERE { ?p ex:knows ex:bob }', [closed])).toBe(ContainmentResult.CONTAINED);
        expect(result('SELECT * WHERE { ?p ex:knows "bob" }', [closed])).toBe(ContainmentResult.REJECTED);
    });

    it('should not match a constant IRI against a datatype constraint', async () => {
        const [shape] = await shapesOf('ex:S a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:age ; sh:datatype xsd:integer ] .', 'S');
        expect(result('SELECT * WHERE { ?x ex:age ex:Foo }', [shape])).toBe(ContainmentResult.REJECTED);
    });

    it('should not count an optional triple pattern that violates its constraint as a match', async () => {
        const [shape] = await shapesOf('ex:S a sh:NodeShape ; sh:property [ sh:path ex:age ; sh:datatype xsd:integer ] .', 'S');
        const report = solve('SELECT * WHERE { ?x ex:a ?a OPTIONAL { ?x ex:age "unknown" } }', [shape]);
        expect(report.result).toBe(ContainmentResult.WEAKLY_REJECTED);
        expect(report.visitShapeBoundedResource.get('http://example.org/S')).toBe(false);
    });

    it('should match a negated property set against any other allowed property, with its object constraints', async () => {
        const [name, forbids, age] = await shapesOf(`
            ex:N a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:name ] .
            ex:F a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:name ] ; sh:not [ sh:path ex:pw ; sh:minCount 1 ] .
            ex:G a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:age ; sh:datatype xsd:integer ] .`, 'N', 'F', 'G');
        expect(result('SELECT * WHERE { ?x ex:name ?n ; !ex:age ?o }', [name])).toBe(ContainmentResult.CONTAINED);
        expect(result('SELECT * WHERE { ?x !ex:name ?o }', [forbids])).toBe(ContainmentResult.REJECTED);
        expect(result('SELECT * WHERE { ?x !ex:name "abc" }', [age])).toBe(ContainmentResult.REJECTED);
    });

    it('should give a blank-node object the dependency a variable object has', async () => {
        const [x, a] = await shapesOf(`
            ex:X a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:addr ; sh:node ex:A ] .
            ex:A a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:zip ] .`, 'X', 'A');
        const withVariable = solve('SELECT * WHERE { ?x ex:addr ?a . ?a ex:city ?c }', [x], [a]);
        const withBlankNode = solve('SELECT * WHERE { ?x ex:addr [ ex:city ?c ] }', [x], [a]);
        expect(withVariable.starPatternsContainment.get('x')!.result).toBe(ContainmentResult.REJECTED);
        expect(withBlankNode.starPatternsContainment.get('x')!.result).toBe(ContainmentResult.REJECTED);
        expect(withBlankNode.visitShapeBoundedResource.get('http://example.org/X'))
            .toBe(withVariable.visitShapeBoundedResource.get('http://example.org/X'));
    });

    it('should leave a dependency undecided when an open referenced shape does not match it', async () => {
        const [x, a] = await shapesOf(`
            ex:X a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:addr ; sh:node ex:A ] .
            ex:A a sh:NodeShape ; sh:property [ sh:path ex:zip ; sh:datatype xsd:integer ] .`, 'X', 'A');
        expect(result('SELECT * WHERE { ?x ex:addr ?a . ?a ex:zip "abc" }', [x], [a])).toBe(ContainmentResult.WEAKLY_REJECTED);
    });

    it('should evaluate filters on a nested star pattern against the referenced shape', async () => {
        const [x, a] = await shapesOf(`
            ex:X a sh:NodeShape ; sh:property [ sh:path ex:addr ; sh:node ex:A ] .
            ex:A a sh:NodeShape ; sh:property [ sh:path ex:zip ; sh:datatype xsd:integer ; sh:minInclusive 0 ] .`, 'X', 'A');
        expect(result('SELECT * WHERE { ?x ex:addr ?a . ?a ex:zip ?z FILTER(?z < 0) }', [x], [a]))
            .toBe(ContainmentResult.WEAKLY_REJECTED);
    });

    it('should terminate on cyclic dependencies', async () => {
        const [shape] = await shapesOf('ex:S a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:knows ; sh:node ex:S ] .', 'S');
        expect(result('SELECT * WHERE { ?x ex:knows ?y . ?y ex:knows ?x }', [shape])).toBe(ContainmentResult.CONTAINED);
    });

    it('should keep every triple pattern of a star pattern on the same predicate', async () => {
        const [closedPq] = await shapesOf(CLOSED_PQ, 'S');
        expect(result('SELECT * WHERE { ?s ex:p ?a . ?s ex:r ?b . OPTIONAL { ?s ex:r ?c } }', [closedPq]))
            .toBe(ContainmentResult.UNALINGED);
        expect(result('SELECT * WHERE { ?s ex:p ?a . ?s ex:r ?b . OPTIONAL { ?s ex:r ?b } }', [closedPq]))
            .toBe(ContainmentResult.UNALINGED);
    });

    it('should keep an OPTIONAL triple pattern optional when VALUES restricts its object', async () => {
        const [closedPq] = await shapesOf(CLOSED_PQ, 'S');
        expect(result('SELECT * WHERE { ?s ex:p ?x . OPTIONAL { ?s ex:zzz ?o } VALUES ?o { ex:a } }', [closedPq]))
            .toBe(ContainmentResult.CONTAINED);
    });

    it('should match VALUES when at least one of the values satisfies the constraint', async () => {
        const [shape] = await shapesOf('ex:S a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:age ; sh:datatype xsd:integer ] .', 'S');
        expect(result('SELECT * WHERE { VALUES ?a { 5 "x" } ?x ex:age ?a }', [shape])).toBe(ContainmentResult.CONTAINED);
    });

    it('should reject an unrestricted input when the candidate has no resource shape', () => {
        expect(result('SELECT * WHERE { ?s ?p ?o }', [])).toBe(ContainmentResult.REJECTED);
    });
});

describe('normalized shapes', () => {
    it.each([
        ['minCount first', '[ sh:path ex:p ; sh:minCount 1 ], [ sh:path ex:p ; sh:datatype xsd:integer ]'],
        ['datatype first', '[ sh:path ex:p ; sh:datatype xsd:integer ], [ sh:path ex:p ; sh:minCount 1 ]'],
    ])('should combine the property shapes of one path (%s)', async (_, properties) => {
        const [closed, open] = await shapesOf(`
            ex:C a sh:NodeShape ; sh:closed true ; sh:property ${properties} .
            ex:O a sh:NodeShape ; sh:property ${properties} .`, 'C', 'O');
        expect(result('SELECT * WHERE { ?x ex:p "abc" }', [closed])).toBe(ContainmentResult.REJECTED);
        expect(result('SELECT * WHERE { ?x ex:z ?z . FILTER NOT EXISTS { ?x ex:p ?o } }', [open])).toBe(ContainmentResult.REJECTED);
    });

    it('should ignore and report a property shape whose path is not an IRI', async () => {
        const [input, closedName, withComplexPath] = await shapesOf(`
            ex:In a sh:NodeShape ; sh:property [ sh:path [ sh:inversePath ex:p ] ; sh:minCount 1 ], [ sh:path ex:name ; sh:minCount 1 ] .
            ex:R a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:name ] .
            ex:K a sh:NodeShape ; sh:closed true ; sh:property [ sh:path [ sh:inversePath ex:p ] ], [ sh:path ex:name ] .`,
            'In', 'R', 'K');
        const report = solveShapeShapeContainment({ sourceShape: input, targetShapes: [closedName] });
        expect(report.result).toBe(ContainmentResult.CONTAINED);
        expect(report.unsupported).toContain('PATH');
        expect(result('SELECT * WHERE { ?x !ex:name ?o }', [withComplexPath])).toBe(ContainmentResult.REJECTED);
    });

    it('should read a path that is both declared and forbidden as forbidden', async () => {
        const [shape] = await shapesOf('ex:S a sh:NodeShape ; sh:property [ sh:path ex:p ; sh:minCount 1 ] ; sh:not [ sh:path ex:p ; sh:minCount 1 ] .', 'S');
        expect(result('SELECT * WHERE { ?x ex:p ?o }', [shape])).toBe(ContainmentResult.REJECTED);
    });

    it('should read sh:maxCount 0 as forbidding the path whatever sh:minCount is', async () => {
        const [shape] = await shapesOf('ex:S a sh:NodeShape ; sh:property [ sh:path ex:p ; sh:minCount 1 ; sh:maxCount 0 ] .', 'S');
        expect(result('SELECT * WHERE { ?x ex:p ?o }', [shape])).toBe(ContainmentResult.REJECTED);
    });

    it('should not read a forbidding sh:or member as a positive branch', async () => {
        const [shape] = await shapesOf(`ex:S a sh:NodeShape ; sh:closed true ;
            sh:or ( [ sh:path ex:p ; sh:maxCount 0 ] [ sh:path ex:q ; sh:minCount 1 ] ) .`, 'S');
        expect(result('SELECT * WHERE { ?x ex:p ?o }', [shape])).toBe(ContainmentResult.REJECTED);
    });
});

describe('input shapes', () => {
    it('should not translate a class constraint on rdf:type into a constant', async () => {
        const [input] = await shapesOf('ex:In a sh:NodeShape ; sh:property [ sh:path rdf:type ; sh:class ex:C ; sh:minCount 1 ] .', 'In');
        const objects = [...shapeToQuery(input).starPatterns.values()]
            .flatMap(starPattern => [...starPattern.starPattern.values()].map(({ triple }) => triple.object));
        expect(objects.map(object => Array.isArray(object) ? 'list' : object.termType)).toStrictEqual(['Variable']);
    });

    it('should give no result for an input shape that only forbids properties', async () => {
        const [input, other] = await shapesOf(`
            ex:In a sh:NodeShape ; sh:not [ sh:path ex:pw ; sh:minCount 1 ] .
            ex:R a sh:NodeShape ; sh:property [ sh:path ex:name ] .`, 'In', 'R');
        expect(() => solveShapeShapeContainment({ sourceShape: input, targetShapes: [other] })).toThrow(EmptyQueryError);
    });

    it('should ask for any triple about the target nodes of an input shape that only forbids properties', async () => {
        const [input, other] = await shapesOf(`
            ex:In a sh:NodeShape ; sh:targetNode ex:a ; sh:not [ sh:path ex:pw ; sh:minCount 1 ] .
            ex:R a sh:NodeShape ; sh:property [ sh:path ex:name ] .`, 'In', 'R');
        const report = solveShapeShapeContainment({ sourceShape: input, targetShapes: [other] });
        expect(report.result).toBe(ContainmentResult.CONTAINED);
        expect(report.visitShapeBoundedResource.get('http://example.org/R')).toBe(true);
    });

    it('should report a sh:not of the input shape that it cannot translate', async () => {
        const [input] = await shapesOf('ex:In a sh:NodeShape ; sh:property [ sh:path ex:name ; sh:minCount 1 ] ; sh:not [ sh:path ex:age ; sh:minCount 2 ] .', 'In');
        expect(shapeToQuery(input).unsupported).toContain('NOT');
    });
});

describe('constructs outside the profile', () => {
    it('should discard and report a sub-SELECT', async () => {
        const [shape] = await shapesOf('ex:S a sh:NodeShape ; sh:closed true ; sh:property [ sh:path ex:a ] .', 'S');
        const report = solve('SELECT * WHERE { ?x ex:a ?a . { SELECT ?x WHERE { ?x ex:b ?b } } }', [shape]);
        expect(report.result).toBe(ContainmentResult.CONTAINED);
        expect(report.unsupported).toContain('SUBQUERY');
    });

    it('should report BIND and aggregates, and keep the patterns they apply to', () => {
        const bind = query('SELECT * WHERE { ?x ex:a ?a BIND(?a AS ?b) ?y ex:c ?b }');
        expect(bind.unsupported).toContain('BIND');
        expect([...bind.starPatterns.keys()].sort()).toStrictEqual(['x', 'y']);
        // An expression of the SELECT clause, or bound after the whole pattern, constrains no triple pattern
        expect(query('SELECT (?a AS ?b) WHERE { ?x ex:a ?a }').unsupported).toBeUndefined();
        const aggregate = query('SELECT (COUNT(?x) AS ?n) WHERE { ?x ex:a ?a }');
        expect(aggregate.unsupported).toContain('AGGREGATE');
        expect([...aggregate.starPatterns.keys()]).toStrictEqual(['x']);
    });

    it.each([
        '(ex:a/ex:b)+',
        '(ex:a|ex:b)*',
        '(^ex:a)?',
        'ex:d|(ex:a/ex:b)+',
    ])('should discard and report the property path %s', (path) => {
        const normalized = query(`SELECT * WHERE { ?x ${path} ?y . ?x ex:c ?z }`);
        expect(normalized.unsupported).toContain('PATH');
        expect([...normalized.starPatterns.get('x')!.starPattern.values()].map(({ triple }) => triple.predicate))
            .toStrictEqual(['http://example.org/c']);
        expect(normalized.union).toBeUndefined();
    });

    it('should keep the links of a sequence path inside an alternative apart', () => {
        const normalized = query('SELECT * WHERE { ?x (ex:a/ex:b/ex:c)|ex:d ?y }');
        const [sequence] = normalized.union![0];
        const links = [...sequence.starPatterns.values()].flatMap(starPattern => [...starPattern.starPattern.values()])
            .map(({ triple }) => [triple.subject, triple.predicate.slice(-1), Array.isArray(triple.object) ? '' : triple.object.value]);
        expect(links).toHaveLength(3);
        const [a, b, c] = ['a', 'b', 'c'].map(name => links.find(link => link[1] === name)!);
        expect(a[0]).toBe('x');
        expect(b[0]).toBe(a[2]);
        expect(c[0]).toBe(b[2]);
        expect(c[2]).toBe('y');
        expect(new Set([a[2], b[2]]).size).toBe(2);
    });

    it('should rewrite top-level sequence and inverse paths into triple patterns', () => {
        const normalized = query('SELECT * WHERE { ?x ex:a/^ex:b ?y }');
        expect(normalized.unsupported).toBeUndefined();
        expect([...normalized.starPatterns.values()].flatMap(starPattern => [...starPattern.starPattern.values()])
            .map(({ triple }) => triple.predicate).sort()).toStrictEqual(['http://example.org/a', 'http://example.org/b']);
    });
});
