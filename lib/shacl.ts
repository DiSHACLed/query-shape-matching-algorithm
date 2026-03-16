import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'rdf-data-factory';
import type { IContraint, OneOf, IShape, IPredicate } from './Shape';
import { Shape, ConstraintType, PoorlyFormatedShapeError } from './Shape';
import type { ShapeError } from './Shape';

import {
    SHACL_PROPERTY,
    SHACL_PATH,
    SHACL_MIN_COUNT,
    SHACL_MAX_COUNT,
    SHACL_CLOSED,
    SHACL_CLASS,
    SHACL_DATATYPE,
    SHACL_NODE,
    SHACL_OR,
    SHACL_XONE,
    SHACL_NOT,
    IRI_FIRST_RDF_LIST,
    IRI_REST_RDF_LIST,
    IRI_END_RDF_LIST,
    RDF_TRUE,
} from './constant';

const DF = new DataFactory();

// ── Internal parsing state ─────────────────────────────────────────────────

/**
 * Raw quad data collected for a single SHACL property shape (blank node).
 */
interface IPropertyShapeData {
    path?: string;
    minCount?: number;
    maxCount?: number;
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
): Promise<IShape | ShapeError> {
    if (Array.isArray(quads)) {
        return new Promise(resolve => {
            resolve(shapeFromQuadArray(quads, shapeIri));
        });
    }
    return shapeFromQuadStream(quads, shapeIri);
}

function shapeFromQuadStream(
    quadStream: RDF.Stream,
    shapeIri: string,
): Promise<IShape | ShapeError> {
    const map = defaultMap();
    return new Promise(resolve => {
        quadStream.on('data', (quad: RDF.Quad) => { parseQuad(quad, map); });
        quadStream.on('error', (error: any) => { resolve(error); });
        quadStream.on('end', () => { resolve(buildShape(map, shapeIri)); });
    });
}

function shapeFromQuadArray(
    quads: RDF.Quad[],
    shapeIri: string,
): IShape | ShapeError {
    const map = defaultMap();
    for (const quad of quads) {
        parseQuad(quad, map);
    }
    return buildShape(map, shapeIri);
}

// ── Quad parsing ───────────────────────────────────────────────────────────

function parseQuad(quad: RDF.Quad, map: IMapTripleShacl): void {
    const s = quad.subject.value;
    const o = quad.object.value;

    // sh:property  → register property shape under the node shape
    if (quad.predicate.equals(SHACL_PROPERTY)) {
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
    if (quad.predicate.equals(SHACL_PATH)) {
        getOrCreatePropData(map, s).path = o;
        return;
    }

    // sh:minCount
    if (quad.predicate.equals(SHACL_MIN_COUNT)) {
        getOrCreatePropData(map, s).minCount = Number(o);
        return;
    }

    // sh:maxCount
    if (quad.predicate.equals(SHACL_MAX_COUNT)) {
        getOrCreatePropData(map, s).maxCount = Number(o);
        return;
    }

    // sh:closed
    if (quad.predicate.equals(SHACL_CLOSED)) {
        map.closedShape.set(s, quad.object.equals(RDF_TRUE));
        return;
    }

    // sh:class  → SHAPE constraint
    if (quad.predicate.equals(SHACL_CLASS)) {
        getOrCreatePropData(map, s).classConstraint = o;
        return;
    }

    // sh:datatype  → TYPE constraint
    if (quad.predicate.equals(SHACL_DATATYPE)) {
        getOrCreatePropData(map, s).datatypeConstraint = o;
        return;
    }

    // sh:node  → SHAPE constraint (reference to another shape)
    if (quad.predicate.equals(SHACL_NODE)) {
        getOrCreatePropData(map, s).nodeConstraint = o;
        return;
    }

    // sh:or  → alternatives list head
    if (quad.predicate.equals(SHACL_OR)) {
        map.orLists.set(s, o);
        return;
    }

    // sh:xone  → exclusive-one-of list head  (treated same as sh:or for query matching)
    if (quad.predicate.equals(SHACL_XONE)) {
        map.xoneLists.set(s, o);
        return;
    }

    // sh:not  → negation (blank node property shape that should become a negative predicate)
    if (quad.predicate.equals(SHACL_NOT)) {
        map.notLinks.set(s, o);
        // Create entry for the negated shape's blank node
        const negData = getOrCreatePropData(map, o);
        negData.isNegated = true;
        return;
    }

    // rdf:first / rdf:rest for RDF lists (used by sh:or / sh:xone)
    if (quad.predicate.equals(IRI_FIRST_RDF_LIST)) {
        map.listFirst.set(s, o);
        return;
    }
    if (quad.predicate.equals(IRI_REST_RDF_LIST)) {
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
        const branch = resolveOrList(orHead, map);
        if (branch.length > 0) {
            oneOfs.push(branch);
        }
    }

    const closed = map.closedShape.get(shapeIri) ?? false;

    try {
        return new Shape({
            name: shapeIri,
            positivePredicates,
            negativePredicates,
            closed,
            oneOf: oneOfs,
        });
    } catch (error: unknown) {
        return error as ShapeError;
    }
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
    return data.minCount === 0 && data.maxCount === 0;
}

/** Build an IPredicate from a property shape data entry. */
function buildPredicate(data: IPropertyShapeData): IPredicate {
    const constraint = resolveConstraint(data);
    const min = data.minCount;
    const max = data.maxCount;
    const hasCardinality = min !== undefined || max !== undefined;
    return {
        name: data.path!,
        constraint,
        cardinality: hasCardinality
            ? { min: min ?? 1, max: max ?? 1 }
            : undefined,
    };
}

function resolveConstraint(data: IPropertyShapeData): IContraint | undefined {
    if (data.classConstraint !== undefined) {
        // sh:class constrains the RDF type of the object (analogous to ShEx datatype) → TYPE
        return {
            value: new Set([data.classConstraint]),
            type: ConstraintType.TYPE,
        };
    }
    if (data.nodeConstraint !== undefined) {
        // sh:node references another shape definition → SHAPE
        return {
            value: new Set([data.nodeConstraint]),
            type: ConstraintType.SHAPE,
        };
    }
    if (data.datatypeConstraint !== undefined) {
        return {
            value: new Set([data.datatypeConstraint]),
            type: ConstraintType.TYPE,
        };
    }
    return undefined;
}

/**
 * Walk an RDF list headed at `head` and collect each member as an
 * IPredicate[], returning them as a single OneOf (array of paths/branches).
 *
 * Each list member is itself a shape-like blank node that should have
 * sh:property children. We collect those into one OneOfPath per member.
 */
function resolveOrList(head: string, map: IMapTripleShacl): OneOf {
    const result: OneOf = [];
    let current: string | undefined = head;

    while (current !== undefined && current !== IRI_END_RDF_LIST.value) {
        const memberId = map.listFirst.get(current);
        if (memberId !== undefined) {
            const branch = resolveOrMember(memberId, map);
            if (branch.length > 0) {
                result.push(branch);
            }
        }
        const next = map.listRest.get(current);
        current = next === IRI_END_RDF_LIST.value ? undefined : next;
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