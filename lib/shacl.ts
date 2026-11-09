import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'rdf-data-factory';
import type { OneOf, IShape, IPredicate, IConstraint, IConstraintDeclaration, IConstraintFacets } from './Shape';
import { ConstraintType, PoorlyFormatedShapeError, buildConstraint, tryCreateShape, declaresTargets } from './Shape';
import type { ShapeError, IShapeTargets } from './Shape';
import type { UnsupportedConstruct } from './query';
import { SHACL, RDF as RDF_VOCAB, RDFS, XSD } from './constant';
import { addDiagnostic, forEachQuad, type IRdfListContext, type IShapeParserOptions, readRdfList } from './parser-policy';
import { nodeTargetKey } from './target';

const DF = new DataFactory();
const RDF_TRUE = DF.literal('true', DF.namedNode(XSD.boolean));

// ── Internal parsing state ─────────────────────────────────────────────────

/**
 * Raw quad data collected for a single SHACL property shape (blank node).
 */
interface IPropertyShapeData extends IConstraintDeclaration {
    path?: string;
    /** false when sh:path is a blank node, that is, a complex path */
    pathIsIri?: boolean;
    minCount?: number;
    maxCount?: number;
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
    /** shape IRI / blank-node → list head blank-nodes, one per sh:or value */
    orLists: Map<string, Set<string>>;
    /** shape IRI / blank-node → list head blank-nodes, one per sh:xone value */
    xoneLists: Map<string, Set<string>>;
    /** shape IRI / blank-node → negated shapes, one per sh:not value */
    notLinks: Map<string, Set<string>>;
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
    /** node → the SHACL predicates it is the subject of, to check the form of a sh:not value */
    shaclPredicates: Map<string, Set<string>>;
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
        shaclPredicates: new Map(),
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
export async function shaclShapeFromQuads(
    quads: RDF.Stream | RDF.Quad[],
    shapeIri: string,
    options?: IShapeParserOptions,
): Promise<IShape | ShapeError> {
    const map = defaultMap();
    const error = await forEachQuad(quads, quad => parseQuad(quad, map));
    return error ?? buildShape(map, shapeIri, options);
}

// ── Quad parsing ───────────────────────────────────────────────────────────

type QuadHandler = (map: IMapTripleShacl, subject: string, object: RDF.Term) => void;

/** Set a field of the property shape data of the subject from the object. */
function setPropertyData<K extends keyof IPropertyShapeData>(
    key: K,
    read: (object: RDF.Term) => IPropertyShapeData[K],
): QuadHandler {
    return (map, subject, object): void => {
        getOrCreatePropData(map, subject)[key] = read(object);
    };
}

const asNumber = (object: RDF.Term): number => Number(object.value);
const asValue = (object: RDF.Term): string => object.value;

/** What each predicate of a shapes graph records, by predicate IRI. */
const QUAD_HANDLERS = new Map<string, QuadHandler>([
    // sh:property registers a property shape under the node shape, even an empty one
    [SHACL.property, (map, subject, object): void => {
        addToSetMap(map.shapeProperties, subject, object.value);
        getOrCreatePropData(map, object.value);
    }],
    [SHACL.path, (map, subject, object): void => {
        const data = getOrCreatePropData(map, subject);
        data.path = object.value;
        data.pathIsIri = object.termType === 'NamedNode';
    }],
    [SHACL.minCount, setPropertyData('minCount', asNumber)],
    [SHACL.maxCount, setPropertyData('maxCount', asNumber)],
    [SHACL.minInclusive, setPropertyData('minInclusive', asNumber)],
    [SHACL.maxInclusive, setPropertyData('maxInclusive', asNumber)],
    [SHACL.minExclusive, setPropertyData('minExclusive', asNumber)],
    [SHACL.maxExclusive, setPropertyData('maxExclusive', asNumber)],
    [SHACL.pattern, setPropertyData('pattern', asValue)],
    [SHACL.flags, setPropertyData('flags', asValue)],
    [SHACL.class, setPropertyData('classConstraint', asValue)],
    [SHACL.datatype, setPropertyData('datatypeConstraint', asValue)],
    // sh:node references another shape
    [SHACL.node, setPropertyData('shapeConstraint', asValue)],
    [SHACL.closed, (map, subject, object): void => { map.closedShape.set(subject, object.equals(RDF_TRUE)); }],
    // sh:or and sh:xone are list heads of alternatives (sh:xone is treated as sh:or for query matching)
    [SHACL.or, (map, subject, object): void => { addToSetMap(map.orLists, subject, object.value); }],
    [SHACL.xone, (map, subject, object): void => { addToSetMap(map.xoneLists, subject, object.value); }],
    // sh:not negates a property shape, which can become a negative predicate
    [SHACL.not, (map, subject, object): void => {
        addToSetMap(map.notLinks, subject, object.value);
        getOrCreatePropData(map, object.value).isNegated = true;
    }],
    // Targets: the nodes the shape describes when it is used on its own
    [SHACL.targetNode, (map, subject, object): void => { getOrCreateTargets(map, subject).nodes.add(nodeTargetKey(object)); }],
    [SHACL.targetClass, (map, subject, object): void => { getOrCreateTargets(map, subject).classes.add(object.value); }],
    [SHACL.targetSubjectsOf, (map, subject, object): void => { getOrCreateTargets(map, subject).subjectsOf.add(object.value); }],
    [SHACL.targetObjectsOf, (map, subject, object): void => { getOrCreateTargets(map, subject).objectsOf.add(object.value); }],
    // sh:ignoredProperties lists the properties a closed shape allows without declaring them
    [SHACL.ignoredProperties, (map, subject, object): void => { map.ignoredLists.set(subject, object.value); }],
    // rdf:type and rdfs:subClassOf, to recognize a shape that is also a class (implicit class target)
    [RDF_VOCAB.type, (map, subject, object): void => { addToSetMap(map.types, subject, object.value); }],
    [RDFS.subClassOf, (map, subject, object): void => { addToSetMap(map.superClasses, subject, object.value); }],
    // rdf:first and rdf:rest of the RDF lists
    [RDF_VOCAB.first, (map, subject, object): void => { map.listFirst.set(subject, object.value); }],
    [RDF_VOCAB.rest, (map, subject, object): void => { map.listRest.set(subject, object.value); }],
]);

function parseQuad(quad: RDF.Quad, map: IMapTripleShacl): void {
    const subject = quad.subject.value;
    const predicate = quad.predicate.value;
    if (predicate.startsWith(SHACL.namespace)) {
        addToSetMap(map.shaclPredicates, subject, predicate);
    }
    QUAD_HANDLERS.get(predicate)?.(map, subject, quad.object);
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

    // A shape conforms to every one of its sh:or and sh:xone values, so each becomes a disjunction
    const orHeads = [...map.orLists.get(shapeIri) ?? [], ...map.xoneLists.get(shapeIri) ?? []];
    const hasOrList = orHeads.length > 0;
    const targets = collectTargets(map, shapeIri);
    const hasTarget = declaresTargets(targets);

    // A shape that only declares targets still describes nodes: they exist and are of the target
    // kind, even though the shape constrains none of their properties.
    if ((propIds === undefined || propIds.size === 0) && !hasOrList && negatedPropIds.size === 0 && !hasTarget) {
        return new PoorlyFormatedShapeError(
            `No property shapes, sh:or, sh:not, or target found for shape <${shapeIri}>`,
        );
    }

    const positivePredicates: IPredicate[] = [];
    const negativePredicates = new Set<string>();
    const unsupported = new Set<UnsupportedConstruct>();
    const context = { shapeIri, options, unsupported };

    // Direct property shapes (sh:property)
    for (const propId of propIds ?? []) {
        const data = supportedPropertyData(map, propId, context);
        if (data === undefined) { continue; }
        if (isNegatedData(data)) {
            negativePredicates.add(data.path);
        } else {
            positivePredicates.push(buildPredicate(data.path, data));
        }
    }

    // Negated property shapes from sh:not
    for (const negId of negatedPropIds) {
        const forbidden = forbiddenPredicate(map, negId);
        if (forbidden !== undefined) {
            negativePredicates.add(forbidden);
        } else {
            unsupported.add('NOT');
            addDiagnostic(options, {
                level: 'warning',
                code: 'UNSUPPORTED_NOT',
                message: `sh:not of <${shapeIri}> does not forbid a single property and is ignored`,
                shapeIri,
                nodeId: negId,
            });
        }
    }

    // Resolve sh:or / sh:xone into oneOf branches
    const oneOfs: OneOf[] = [];
    for (const orHead of orHeads) {
        const members = readList(orHead, map, { shapeIri, construct: 'sh:or/sh:xone', options });
        if (members instanceof PoorlyFormatedShapeError) {
            return members;
        }
        const branch = resolveOrList(members, map, context);
        if (branch.length > 0) {
            oneOfs.push(branch);
        }
    }

    const closed = map.closedShape.get(shapeIri) ?? false;
    const ignoredHead = map.ignoredLists.get(shapeIri);
    const ignoredProperties = ignoredHead === undefined
        ? []
        : readList(ignoredHead, map, { shapeIri, construct: 'sh:ignoredProperties', options });
    if (ignoredProperties instanceof PoorlyFormatedShapeError) {
        return ignoredProperties;
    }

    return tryCreateShape({
        name: shapeIri,
        // A path that the shape both declares and forbids has no value in conforming data
        positivePredicates: combinePropertyShapes(positivePredicates).filter(predicate => !negativePredicates.has(predicate.name)),
        negativePredicates: [...negativePredicates],
        closed,
        oneOf: oneOfs,
        targets,
        ignoredProperties,
        unsupported: [...unsupported],
    });
}

/** What reading the property shapes of a shape reports, and to whom. */
interface IReadContext {
    shapeIri: string;
    options?: IShapeParserOptions;
    unsupported: Set<UnsupportedConstruct>;
}

/**
 * The data of a property shape whose path is an IRI. A property shape with another path is outside
 * the supported profile: it is ignored and reported.
 */
function supportedPropertyData(
    map: IMapTripleShacl,
    propId: string,
    context: IReadContext,
): IPropertyShapeData & { path: string } | undefined {
    const data = map.propertyData.get(propId);
    if (data?.path === undefined) {
        return undefined;
    }
    if (data.pathIsIri !== true) {
        context.unsupported.add('PATH');
        addDiagnostic(context.options, {
            level: 'warning',
            code: 'UNSUPPORTED_PATH',
            message: `a property shape of <${context.shapeIri}> has a path that is not an IRI and is ignored`,
            shapeIri: context.shapeIri,
            nodeId: propId,
        });
        return undefined;
    }
    return data as IPropertyShapeData & { path: string };
}

/**
 * Combine the property shapes of each path into one: a node conforms to the shape only when it
 * conforms to each of them, so the largest minimum and the smallest maximum count apply, and so do
 * all their value constraints. One constraint is kept per path, as for a single property shape:
 * datatype constraints on the same datatype combine their facets, and otherwise a class takes
 * precedence over a shape, and a shape over a datatype.
 */
function combinePropertyShapes(predicates: IPredicate[]): IPredicate[] {
    const byPath = new Map<string, IPredicate>();
    for (const predicate of predicates) {
        const previous = byPath.get(predicate.name);
        byPath.set(predicate.name, previous === undefined ? predicate : {
            name: predicate.name,
            constraint: combineConstraints(previous.constraint, predicate.constraint),
            cardinality: {
                min: Math.max(previous.cardinality?.min ?? SHACL_DEFAULT_MIN_COUNT, predicate.cardinality?.min ?? SHACL_DEFAULT_MIN_COUNT),
                max: smallestMaximum(previous.cardinality?.max ?? SHACL_DEFAULT_MAX_COUNT, predicate.cardinality?.max ?? SHACL_DEFAULT_MAX_COUNT),
            },
        });
    }
    return [...byPath.values()];
}

const CONSTRAINT_PRECEDENCE = [ConstraintType.INSTANCE, ConstraintType.SHAPE, ConstraintType.CLASS, ConstraintType.DATATYPE];

function combineConstraints(first?: IConstraint, second?: IConstraint): IConstraint | undefined {
    if (first === undefined || second === undefined) {
        return first ?? second;
    }
    if (first.type === ConstraintType.DATATYPE && second.type === ConstraintType.DATATYPE &&
        first.value.size === second.value.size && [...first.value].every(value => second.value.has(value))) {
        return { value: first.value, type: first.type, ...combineFacets(first, second) };
    }
    return CONSTRAINT_PRECEDENCE.indexOf(first.type) <= CONSTRAINT_PRECEDENCE.indexOf(second.type) ? first : second;
}

/** The facets that both sets of facets impose; one pattern is kept when both have one. */
function combineFacets(first: IConstraintFacets, second: IConstraintFacets): IConstraintFacets {
    const facets: IConstraintFacets = {};
    const bound = (key: 'minInclusive' | 'minExclusive' | 'maxInclusive' | 'maxExclusive', pick: (...values: number[]) => number): void => {
        const values = [first[key], second[key]].filter((value): value is number => value !== undefined);
        if (values.length > 0) {
            facets[key] = pick(...values);
        }
    };
    bound('minInclusive', Math.max);
    bound('minExclusive', Math.max);
    bound('maxInclusive', Math.min);
    bound('maxExclusive', Math.min);
    const withPattern = first.pattern !== undefined ? first : second;
    if (withPattern.pattern !== undefined) {
        facets.pattern = withPattern.pattern;
        if (withPattern.flags !== undefined) {
            facets.flags = withPattern.flags;
        }
    }
    return facets;
}

/** The smaller of two maximum counts, where -1 is unbounded. */
function smallestMaximum(first: number, second: number): number {
    if (first === SHACL_DEFAULT_MAX_COUNT) {
        return second;
    }
    return second === SHACL_DEFAULT_MAX_COUNT ? first : Math.min(first, second);
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

/** Collect the property shapes negated by the sh:not values of a shape. */
function collectNotProps(map: IMapTripleShacl, shapeIri: string): Set<string> {
    return new Set(map.notLinks.get(shapeIri));
}

// The SHACL predicates that a sh:not value may carry besides sh:minCount and still forbid its path. The
// others are not parameters: they do not take part in validation.
const NEGATION_PREDICATES = new Set([
    'path', 'minCount', 'name', 'description', 'order', 'group', 'defaultValue', 'message', 'severity', 'deactivated',
].map(name => SHACL.custom(name)));

/**
 * The predicate that a sh:not value forbids, if any. `sh:not [ sh:path p ; sh:minCount 1 ]`, with an IRI
 * path and no other parameter, is the only form that a node conforms to exactly when it has no value for p.
 * Any other form holds for some nodes that carry p, so it forbids nothing: `sh:not [ sh:path p ; sh:minCount 2 ]`
 * allows one value, and `sh:not [ sh:path p ; sh:datatype xsd:string ]` requires a value that is not a string.
 */
function forbiddenPredicate(map: IMapTripleShacl, nodeId: string): string | undefined {
    const data = map.propertyData.get(nodeId);
    if (data?.path === undefined || data.pathIsIri !== true || data.minCount !== 1) {
        return undefined;
    }
    const predicates = map.shaclPredicates.get(nodeId) ?? new Set<string>();
    return Array.from(predicates).every(predicate => NEGATION_PREDICATES.has(predicate)) ? data.path : undefined;
}

// SHACL bounds a cardinality only when it is declared: an absent sh:minCount is 0 and an absent
// sh:maxCount is unbounded (-1 in ICardinality).
const SHACL_DEFAULT_MIN_COUNT = 0;
const SHACL_DEFAULT_MAX_COUNT = -1;

/**
 * Whether a property shape forbids its path: with sh:maxCount 0, conforming data has no value for it,
 * whatever sh:minCount is.
 */
function isNegatedData(data: IPropertyShapeData): boolean {
    return data.maxCount === 0;
}

/** Build an IPredicate from a property shape data entry with the given path. */
function buildPredicate(path: string, data: IPropertyShapeData): IPredicate {
    return {
        name: path,
        constraint: buildConstraint(data, path),
        cardinality: {
            min: data.minCount ?? SHACL_DEFAULT_MIN_COUNT,
            max: data.maxCount ?? SHACL_DEFAULT_MAX_COUNT,
        },
    };
}

function readList(head: string, map: IMapTripleShacl, context: IRdfListContext): string[] | PoorlyFormatedShapeError {
    return readRdfList(head, { firstByNode: map.listFirst, restByNode: map.listRest }, context);
}

/**
 * Collect the members of an sh:or (or sh:xone) list as a single OneOf: one branch per member.
 *
 * Each list member is itself a shape-like blank node that should have
 * sh:property children. We collect those into one OneOfPath per member.
 */
function resolveOrList(members: string[], map: IMapTripleShacl, context: IReadContext): OneOf {
    const result: OneOf = [];
    for (const memberId of members) {
        const branch = resolveOrMember(memberId, map, context);
        if (branch.length > 0) {
            result.push(branch);
        }
    }
    return result;
}

/**
 * Given a blank node that is a member of an sh:or list (possibly a nested
 * property shape group), collect its predicates as a single OneOfPath. A property shape that forbids
 * its path constrains no value, so it adds nothing to the branch.
 */
function resolveOrMember(memberId: string, map: IMapTripleShacl, context: IReadContext): IPredicate[] {
    const predicates: IPredicate[] = [];
    // A member might itself be a single property shape (sh:path lives directly on the member)
    const propIds = map.shapeProperties.get(memberId) ?? (map.propertyData.get(memberId)?.path !== undefined ? [memberId] : []);
    for (const propId of propIds) {
        const data = supportedPropertyData(map, propId, context);
        if (data !== undefined && !isNegatedData(data)) {
            predicates.push(buildPredicate(data.path, data));
        }
    }
    return combinePropertyShapes(predicates);
}