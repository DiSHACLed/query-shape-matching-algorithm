import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'rdf-data-factory';
import type { OneOf, IShape, IPredicate } from './Shape';
import { 
    PoorlyFormatedShapeError, 
    walkRdfList, 
    buildShapeFromRaw, 
    predicateToParts, 
    buildPredicate as buildSharedPredicate, 
    isNegativeCardinality 
} from './Shape';
import type { ShapeError } from './Shape';
import { SHACL, RDF as RDF_VOCAB, XSD } from './constant';
import { addDiagnostic, getPolicy, type IShapeParserOptions } from './parser-policy';

const DF = new DataFactory();
const RDF_TRUE = DF.literal('true', DF.namedNode(XSD.boolean));

// ── Internal parsing state ─────────────────────────────────────────────────

/**
 * Raw quad data collected for a single SHACL property shape (blank node).
 */
interface IPropertyShapeData {
    path?: string;
    minCount?: number;
    maxCount?: number;
    minInclusive?: number;
    maxInclusive?: number;
    minExclusive?: number;
    maxExclusive?: number;
    pattern?: string;
    flags?: string;
    classConstraint?: string; // sh:class value
    datatypeConstraint?: string; // sh:datatype value
    nodeConstraint?: string; // sh:node value
    /** true when this property shape appears under sh:not */
    isNegated: boolean;
}

/**
 * All data collected while scanning the quads of a shape.
 */
interface IMapTripleShacl {
    /** shape IRI → set of property-shape blank-node IDs (from sh:property) */
    shapeProperties: Map<string, Set<string>>;
    /** blank-node ID → raw property data */
    propertyData: Map<string, IPropertyShapeData>;
    /** shape IRI → closed flag */
    closedShape: Map<string, boolean>;
    /** shape IRI / blank-node → list head blank-node (from sh:or / sh:xone) */
    orLists: Map<string, string>;
    /** shape IRI / blank-node → list head blank-node (from sh:xone) */
    xoneLists: Map<string, string>;
    /** shape IRI / blank-node → list head blank-node (from sh:not) */
    notLinks: Map<string, string>;
    /** RDF list first: node → value */
    listFirst: Map<string, string>;
    /** RDF list rest: node → next node */
    listRest: Map<string, string>;
}

function defaultMap(): IMapTripleShacl {
    return {
        shapeProperties: new Map(),
        propertyData: new Map(),
        closedShape: new Map(),
        orLists: new Map(),
        xoneLists: new Map(),
        notLinks: new Map(),
        listFirst: new Map(),
        listRest: new Map(),
    };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse a SHACL shape from a set of quads.
 * Mirrors {@link module:shex.shapeFromQuads} in API.
 * @param {RDF.Stream | RDF.Quad[]} quads - Quads representing a SHACL shapes graph
 * @param {string} shapeIri - The IRI of the desired node shape
 * @returns {Promise<IShape | ShapeError>} The parsed shape or an error
 */
export function shaclShapeFromQuads(
    quads: RDF.Stream | RDF.Quad[],
    shapeIri: string,
    options?: IShapeParserOptions,
): Promise<IShape | ShapeError> {
    if (Array.isArray(quads)) {
        return new Promise(resolve => {
            resolve(shapeFromQuadArray(quads, shapeIri, options));
        });
    }
    return shapeFromQuadStream(quads, shapeIri, options);
}

function shapeFromQuadStream(
    quadStream: RDF.Stream,
    shapeIri: string,
    options?: IShapeParserOptions,
): Promise<IShape | ShapeError> {
    const map = defaultMap();
    return new Promise(resolve => {
        quadStream.on('data', (quad: RDF.Quad) => { parseQuad(quad, map); });
        quadStream.on('error', (error: any) => { resolve(error); });
        quadStream.on('end', () => { resolve(buildShape(map, shapeIri, options)); });
    });
}

function shapeFromQuadArray(
    quads: RDF.Quad[],
    shapeIri: string,
    options?: IShapeParserOptions,
): IShape | ShapeError {
    const map = defaultMap();
    for (const quad of quads) {
        parseQuad(quad, map);
    }
    return buildShape(map, shapeIri, options);
}

// ── Quad parsing ───────────────────────────────────────────────────────────

function parseQuad(quad: RDF.Quad, map: IMapTripleShacl): void {
    const s = quad.subject.value;
    const o = quad.object.value;

    // sh:property  → register property shape under the node shape
    if (quad.predicate.equals(SHACL.terms.property)) {
        let props = map.shapeProperties.get(s);
        if (props === undefined) {
            props = new Set();
            map.shapeProperties.set(s, props);
        }
        props.add(o);
        // Ensure an entry exists so we can detect even empty property shapes
        if (!map.propertyData.has(o)) {
            map.propertyData.set(o, { isNegated: false });
        }
        return;
    }

    // sh:path  → predicate IRI for this property shape
    if (quad.predicate.equals(SHACL.terms.path)) {
        getOrCreatePropData(map, s).path = o;
        return;
    }

    // sh:minCount
    if (quad.predicate.equals(SHACL.terms.minCount)) {
        getOrCreatePropData(map, s).minCount = Number(o);
        return;
    }

    // sh:maxCount
    if (quad.predicate.equals(SHACL.terms.maxCount)) {
        getOrCreatePropData(map, s).maxCount = Number(o);
        return;
    }

    // sh:minInclusive
    if (quad.predicate.equals(SHACL.terms.minInclusive)) {
        getOrCreatePropData(map, s).minInclusive = Number(o);
        return;
    }

    // sh:maxInclusive
    if (quad.predicate.equals(SHACL.terms.maxInclusive)) {
        getOrCreatePropData(map, s).maxInclusive = Number(o);
        return;
    }

    // sh:minExclusive
    if (quad.predicate.equals(SHACL.terms.minExclusive)) {
        getOrCreatePropData(map, s).minExclusive = Number(o);
        return;
    }

    // sh:maxExclusive
    if (quad.predicate.equals(SHACL.terms.maxExclusive)) {
        getOrCreatePropData(map, s).maxExclusive = Number(o);
        return;
    }

    // sh:pattern
    if (quad.predicate.equals(SHACL.terms.pattern)) {
        getOrCreatePropData(map, s).pattern = o;
        return;
    }

    // sh:flags
    if (quad.predicate.equals(SHACL.terms.flags)) {
        getOrCreatePropData(map, s).flags = o;
        return;
    }

    // sh:closed
    if (quad.predicate.equals(SHACL.terms.closed)) {
        map.closedShape.set(s, quad.object.equals(RDF_TRUE));
        return;
    }

    // sh:class  → SHAPE constraint
    if (quad.predicate.equals(SHACL.terms.class)) {
        getOrCreatePropData(map, s).classConstraint = o;
        return;
    }

    // sh:datatype  → TYPE constraint
    if (quad.predicate.equals(SHACL.terms.datatype)) {
        getOrCreatePropData(map, s).datatypeConstraint = o;
        return;
    }

    // sh:node  → SHAPE constraint (reference to another shape)
    if (quad.predicate.equals(SHACL.terms.node)) {
        getOrCreatePropData(map, s).nodeConstraint = o;
        return;
    }

    // sh:or  → alternatives list head
    if (quad.predicate.equals(SHACL.terms.or)) {
        map.orLists.set(s, o);
        return;
    }

    // sh:xone  → exclusive-one-of list head  (treated same as sh:or for query matching)
    if (quad.predicate.equals(SHACL.terms.xone)) {
        map.xoneLists.set(s, o);
        return;
    }

    // sh:not  → negation (blank node property shape that should become a negative predicate)
    if (quad.predicate.equals(SHACL.terms.not)) {
        map.notLinks.set(s, o);
        // Create entry for the negated shape's blank node
        const negData = getOrCreatePropData(map, o);
        negData.isNegated = true;
        return;
    }

    // rdf:first / rdf:rest for RDF lists (used by sh:or / sh:xone)
    if (quad.predicate.equals(RDF_VOCAB.terms.first)) {
        map.listFirst.set(s, o);
        return;
    }
    if (quad.predicate.equals(RDF_VOCAB.terms.rest)) {
        map.listRest.set(s, o);
        return;
    }
}

function getOrCreatePropData(
    map: IMapTripleShacl,
    id: string,
): IPropertyShapeData {
    let data = map.propertyData.get(id);
    if (data === undefined) {
        data = { isNegated: false };
        map.propertyData.set(id, data);
    }
    return data;
}

// ── Shape assembly ─────────────────────────────────────────────────────────

function buildShape(
    map: IMapTripleShacl,
    shapeIri: string,
    options?: IShapeParserOptions,
): IShape | ShapeError {
    const propIds = map.shapeProperties.get(shapeIri);
    // Collect sh:not negated property shapes from under the target shape
    const negatedPropIds = collectNotProps(map, shapeIri);

    const hasOrList = map.orLists.has(shapeIri) || map.xoneLists.has(shapeIri);

    if ((propIds === undefined || propIds.size === 0) && !hasOrList && negatedPropIds.size === 0) {
        return new PoorlyFormatedShapeError(
            `No property shapes, sh:or, or sh:not found for shape <${shapeIri}>`,
        );
    }

    const positivePredicates: IPredicate[] = [];
    const negativePredicates: string[] = [];

    // Direct property shapes (sh:property)
    for (const propId of propIds ?? []) {
        const data = map.propertyData.get(propId);
        if (data === undefined || data.path === undefined) { continue; }
        const isNeg = isNegatedData(data);
        if (isNeg) {
            negativePredicates.push(data.path);
        } else {
            positivePredicates.push(buildPredicate(data));
        }
    }

    // Negated property shapes from sh:not
    for (const negId of negatedPropIds) {
        const data = map.propertyData.get(negId);
        if (data?.path !== undefined) {
            negativePredicates.push(data.path);
        }
    }

    // Resolve sh:or / sh:xone into oneOf branches
    const oneOfs: OneOf[] = [];
    const orHead = map.orLists.get(shapeIri) ?? map.xoneLists.get(shapeIri);
    if (orHead !== undefined) {
        const branch = resolveOrList(orHead, map, shapeIri, options);
        if (branch.length > 0) {
            oneOfs.push(branch);
        }
    }

    const closed = map.closedShape.get(shapeIri) ?? false;

    return buildShapeFromRaw({
        name: shapeIri,
        positivePredicates: positivePredicates.map(predicate => predicateToParts(predicate)),
        negativePredicates,
        closed,
        oneOf: oneOfs.map(currentOneOf => currentOneOf.map(path => path.map(predicateToParts))),
    });
}

/** Collect all property-shape blank nodes reachable via sh:not from a shape IRI. */
function collectNotProps(map: IMapTripleShacl, shapeIri: string): Set<string> {
    const result = new Set<string>();
    const notTarget = map.notLinks.get(shapeIri);
    if (notTarget !== undefined) {
        result.add(notTarget);
    }
    return result;
}

/** Whether a property shape data entry represents a negative predicate (minCount=0, maxCount=0). */
function isNegatedData(data: IPropertyShapeData): boolean {
    return isNegativeCardinality(data.minCount, data.maxCount);
}

/** Build an IPredicate from a property shape data entry. */
function buildPredicate(data: IPropertyShapeData): IPredicate {
    return buildSharedPredicate({
        name: data.path!,
        minCount: data.minCount,
        maxCount: data.maxCount,
        constraintParts: {
            classConstraint: data.classConstraint,
            shapeConstraint: data.nodeConstraint,
            datatypeConstraint: data.datatypeConstraint,
            minInclusive: data.minInclusive,
            maxInclusive: data.maxInclusive,
            minExclusive: data.minExclusive,
            maxExclusive: data.maxExclusive,
            pattern: data.pattern,
            flags: data.flags,
        },
    });
}

/**
 * Walk an RDF list headed at `head` and collect each member as an
 * IPredicate[], returning them as a single OneOf (array of paths/branches).
 *
 * Each list member is itself a shape-like blank node that should have
 * sh:property children. We collect those into one OneOfPath per member.
 */
function resolveOrList(
    head: string,
    map: IMapTripleShacl,
    shapeIri: string,
    options?: IShapeParserOptions,
): OneOf {
    const result: OneOf = [];

    const policy = getPolicy(options);
    const walked = walkRdfList(head, {
        firstByNode: map.listFirst,
        restByNode: map.listRest,
    });

    if (walked.malformed) {
        addDiagnostic(options, {
            level: policy.strictRdfLists ? 'error' : 'warning',
            code: 'MALFORMED_RDF_LIST',
            message: `Malformed RDF list while resolving sh:or/sh:xone for <${shapeIri}>`,
            shapeIri,
            nodeId: head,
        });
    }

    for (const memberId of walked.values) {
        const branch = resolveOrMember(memberId, map);
        if (branch.length > 0) {
            result.push(branch);
        }
    }

    return result;
}

/**
 * Given a blank node that is a member of an sh:or list (possibly a nested
 * property shape group), collect its predicates as a single OneOfPath.
 */
function resolveOrMember(memberId: string, map: IMapTripleShacl): IPredicate[] {
    const predicates: IPredicate[] = [];
    const propIds = map.shapeProperties.get(memberId);
    if (propIds !== undefined) {
        for (const propId of propIds) {
            const data = map.propertyData.get(propId);
            if (data?.path !== undefined && !isNegatedData(data)) {
                predicates.push(buildPredicate(data));
            }
        }
    }
    // A member might itself be a single property shape (sh:path lives directly on the member)
    const directData = map.propertyData.get(memberId);
    if (directData?.path !== undefined && predicates.length === 0) {
        predicates.push(buildPredicate(directData));
    }
    return predicates;
}