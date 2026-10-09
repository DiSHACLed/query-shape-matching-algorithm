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
import type { ShapeError, IShapeTargets } from './Shape';
import { SHACL, RDF as RDF_VOCAB, RDFS, XSD } from './constant';
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
    /** shape IRI → declared targets (sh:targetNode, sh:targetClass, sh:targetSubjectsOf, sh:targetObjectsOf) */
    targets: Map<string, IShapeTargetSets>;
    /** shape IRI → list head (from sh:ignoredProperties) */
    ignoredLists: Map<string, string>;
    /** node → rdf:type values, to find implicit class targets */
    types: Map<string, Set<string>>;
    /** class → rdfs:subClassOf values, to find the subclasses of rdfs:Class */
    superClasses: Map<string, Set<string>>;
}

type IShapeTargetSets = { [K in keyof IShapeTargets]: Set<string> };

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
        targets: new Map(),
        ignoredLists: new Map(),
        types: new Map(),
        superClasses: new Map(),
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

    // Targets: the nodes the shape describes when it is used on its own
    if (quad.predicate.equals(SHACL.terms.targetNode)) {
        // A literal can be a node target too; keep it distinct from an IRI with the same text
        const node = quad.object.termType === 'Literal' ? JSON.stringify(o) : o;
        getOrCreateTargets(map, s).nodes.add(node);
        return;
    }
    if (quad.predicate.equals(SHACL.terms.targetClass)) {
        getOrCreateTargets(map, s).classes.add(o);
        return;
    }
    if (quad.predicate.equals(SHACL.terms.targetSubjectsOf)) {
        getOrCreateTargets(map, s).subjectsOf.add(o);
        return;
    }
    if (quad.predicate.equals(SHACL.terms.targetObjectsOf)) {
        getOrCreateTargets(map, s).objectsOf.add(o);
        return;
    }

    // sh:ignoredProperties  → list of properties a closed shape allows without declaring them
    if (quad.predicate.equals(SHACL.terms.ignoredProperties)) {
        map.ignoredLists.set(s, o);
        return;
    }

    // rdf:type and rdfs:subClassOf, to recognize a shape that is also a class (implicit class target)
    if (quad.predicate.equals(RDF_VOCAB.terms.type)) {
        addToSetMap(map.types, s, o);
        return;
    }
    if (quad.predicate.equals(RDFS.terms.subClassOf)) {
        addToSetMap(map.superClasses, s, o);
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

function getOrCreateTargets(map: IMapTripleShacl, shapeIri: string): IShapeTargetSets {
    let targets = map.targets.get(shapeIri);
    if (targets === undefined) {
        targets = { nodes: new Set(), classes: new Set(), subjectsOf: new Set(), objectsOf: new Set() };
        map.targets.set(shapeIri, targets);
    }
    return targets;
}

function addToSetMap(setMap: Map<string, Set<string>>, key: string, value: string): void {
    let values = setMap.get(key);
    if (values === undefined) {
        values = new Set();
        setMap.set(key, values);
    }
    values.add(value);
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
    const targets = collectTargets(map, shapeIri);
    const hasTarget = Object.values(targets).some(values => values.length > 0);

    // A shape that only declares targets still describes nodes: they exist and are of the target
    // kind, even though the shape constrains none of their properties.
    if ((propIds === undefined || propIds.size === 0) && !hasOrList && negatedPropIds.size === 0 && !hasTarget) {
        return new PoorlyFormatedShapeError(
            `No property shapes, sh:or, sh:not, or target found for shape <${shapeIri}>`,
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
    const ignoredHead = map.ignoredLists.get(shapeIri);
    const ignoredProperties = ignoredHead === undefined
        ? []
        : walkRdfList(ignoredHead, { firstByNode: map.listFirst, restByNode: map.listRest }).values;

    return buildShapeFromRaw({
        name: shapeIri,
        positivePredicates: positivePredicates.map(predicate => predicateToParts(predicate)),
        negativePredicates,
        closed,
        oneOf: oneOfs.map(currentOneOf => currentOneOf.map(path => path.map(predicateToParts))),
        targets,
        ignoredProperties,
    });
}

/**
 * The targets declared for a shape. A shape that is also an rdfs:Class in the shapes graph targets
 * its own instances (an implicit class target); as for any SHACL instance, the rdf:type may be a
 * class declared, through rdfs:subClassOf, to be a subclass of rdfs:Class.
 */
function collectTargets(map: IMapTripleShacl, shapeIri: string): IShapeTargets {
    const declared = map.targets.get(shapeIri);
    const classes = new Set(declared?.classes ?? []);
    const metaClasses = subClassesOf(map, RDFS.Class);
    if (Array.from(map.types.get(shapeIri) ?? []).some(type => metaClasses.has(type))) {
        classes.add(shapeIri);
    }
    return {
        nodes: Array.from(declared?.nodes ?? []),
        classes: Array.from(classes),
        subjectsOf: Array.from(declared?.subjectsOf ?? []),
        objectsOf: Array.from(declared?.objectsOf ?? []),
    };
}

/** A class and every class declared, directly or transitively, to be a subclass of it. */
function subClassesOf(map: IMapTripleShacl, superClass: string): Set<string> {
    const result = new Set([superClass]);
    let added = true;
    while (added) {
        added = false;
        for (const [subClass, superClasses] of map.superClasses) {
            if (!result.has(subClass) && Array.from(superClasses).some(value => result.has(value))) {
                result.add(subClass);
                added = true;
            }
        }
    }
    return result;
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

// SHACL bounds a cardinality only when it is declared: an absent sh:minCount is 0 and an absent
// sh:maxCount is unbounded (-1 in ICardinality).
const SHACL_DEFAULT_MIN_COUNT = 0;
const SHACL_DEFAULT_MAX_COUNT = -1;

/** Whether a property shape data entry represents a negative predicate (minCount=0, maxCount=0). */
function isNegatedData(data: IPropertyShapeData): boolean {
    return isNegativeCardinality(data.minCount ?? SHACL_DEFAULT_MIN_COUNT, data.maxCount);
}

/** Build an IPredicate from a property shape data entry. */
function buildPredicate(data: IPropertyShapeData): IPredicate {
    return buildSharedPredicate({
        name: data.path!,
        minCount: data.minCount ?? SHACL_DEFAULT_MIN_COUNT,
        maxCount: data.maxCount ?? SHACL_DEFAULT_MAX_COUNT,
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