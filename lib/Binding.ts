import { ConstraintType, IConstraint, IPredicate, IShape, OneOfPathIndexed, withoutTargets } from "./Shape";
import { IStarPatternWithDependencies, type ITriple, Triple } from "./Triple";
import { RDF } from "./constant";
import { impliedPredicateNames, impliedPredicates, isSubjectOutsideNodeTargets } from "./target";
import { evaluateFiltersForShape, FilterTruth } from "./filter-compatibility";

/**
 * What the matching of a star pattern needs to know about the rest of the input, to treat a nested
 * star pattern, or a UNION branch, as the root star pattern is treated.
 */
export interface IBindingContext {
    // the FILTER expressions of the input
    filters?: unknown[];
    // the UNION branches of the star pattern with the given subject
    unionsOf?: (starPatternName: string) => IStarPatternWithDependencies[][];
    // the FILTER expressions of the UNION branch that a branch star pattern comes from
    branchFilters?: Map<IStarPatternWithDependencies, unknown[]>;
}

/**
 * Whether the filters that apply to a star pattern do not provably contradict a shape.
 */
export function filtersCompatible(filters: unknown[] | undefined, starPattern: IStarPatternWithDependencies, shape: IShape): boolean {
    return evaluateFiltersForShape(filters, starPattern, shape) !== FilterTruth.FALSE;
}

/** The key of a star pattern being matched against a shape, to stop at cyclic dependencies. */
function traversalKey(starPatternName: string, shapeName: string): string {
    return `${starPatternName}\u0000${shapeName}`;
}

/**
 * A binding from a query to a shape
 */
export interface IBindings {
    starPattern: IStarPatternWithDependencies;
    getNestedContainedStarPatternNameShapesContained: () => Map<string, string[]>;
    /**
     * Indicate if a star pattern is contained in a shape
     * @returns {boolean} indicate if the query is contained in a shape
     */
    isFullyBounded: () => boolean;
    /**
     * The type of containment of a binding
     * @returns {IContainmentType}
     */
    containmentType: () => IContainmentType;
    /**
     * Indicate that the documents linked to the shapes should be visited if there are
     * complete or partial binding
     * @returns {boolean} indicate if the documents link to the shapes should be visited
     */
    shouldVisitShape: () => boolean;
    /**
     * Indicate that the shape explicitly forbids a predicate required by the star pattern
     * (SHACL sh:not / ShEx negative triple constraint), or requires (minimum cardinality of at
     * least one) a predicate the star pattern excludes (a negated triple pattern). This is
     * definitive evidence of incompatibility, independently of whether the shape is closed.
     * @returns {boolean} whether the shape contradicts the star pattern
     */
    hasNegativeContradiction: () => boolean;
    /**
     * Indicate that an sh:node dependency of a matched predicate was neither established nor
     * refuted, because the referenced shape is open and simply does not describe the nested
     * pattern. The predicate itself matched this shape, so the star pattern is partially matched.
     * @returns {boolean} whether a dependency was left undecided rather than refuted
     */
    hasNonRefutedDependency: () => boolean;
    /**
     * Indicate that the root star pattern matched the shape: a triple pattern is bound, or its
     * predicate matched while its sh:node dependency was left undecided (see hasNonRefutedDependency).
     * @returns {boolean} whether the star pattern matched the shape at its root
     */
    hasRootMatch: () => boolean;
    /**
     * Shapes that nested star patterns were resolved against while checking sh:node constraints.
     * A referenced shape governs its nested star pattern even when it is not a candidate shape
     * itself, so its open or closed status is evidence for that pattern's classification.
     * @returns {IDependencyEvidence[]} one entry per nested star pattern and referenced shape
     */
    getDependencyEvidence: () => IDependencyEvidence[];
    /**
     *
     * Return the unbounded triples
     * @returns {ITriple[]} The binded triples 
     */
    getUnboundedTriple: () => ITriple[];
    /**
     * Return the bindings, the value is undefined if the triple cannot be bind to the shape
     * @returns {Map<string, ITriple | undefined>} the internal bindings
     */
    getBindings: () => Map<string, ITriple | undefined>;
    /**
     * Return the bind triple
     * @returns {ITriple[]} the bind triple
     */
    getBoundTriple: () => ITriple[];
    /**
     * Return the name of the decendent star pattern if the current star pattern is contained
     * @returns {[string, string | undefined][]} the star pattern name of the decendent if the current star pattern is contained
     */
    getNestedContainedStarPatternName: () => IDependentStarPattern[];
}

export interface IDependentStarPattern {
    starPattern: string;
    shape?: string[];
    origin: string
}

export enum ContainmentType {
    FULL,
    PARTIAL,
    NONE
}
export enum ConstraintResult {
    INAPPLICABLE,
    RESPECT,
    NOT_RESPECT
}

/**
 * A shape a nested star pattern was resolved against while checking an sh:node constraint, and
 * what the nested pattern did against it. The referenced shape governs that pattern, so this is
 * the evidence its classification has to be based on.
 */
export interface IDependencyEvidence {
    starPatternName: string;
    shapeName: string;
    closed: boolean;
    /** The nested pattern bound at least one triple against the referenced shape. */
    hasMatch: boolean;
    /** The nested pattern is fully bound by the referenced shape. */
    contained: boolean;
    /** No FILTER of the input contradicts the referenced shape for the nested pattern. */
    filterCompatible: boolean;
    bindings: IBindings;
}

export interface IContainmentType {
    result: ContainmentType;
    unContaineStarPattern?: IStarPatternWithDependencies[];
}

/**
 * Calculate the bindings from a shape and a query
 */
export class Bindings implements IBindings {
    // indexed by predicate
    private bindings = new Map<string, ITriple | undefined>();
    // every triple pattern that binds, as several triple patterns can share a predicate
    private readonly boundTriples = new Set<ITriple>();
    private unboundTriple: ITriple[] = [];
    private fullyBounded = false;
    private readonly closedShape: boolean;
    private nestedContainedStarPatternName: IDependentStarPattern[] = [];
    private nestedContainedStarPatternNameShapesContained = new Map<string, string[]>();
    private readonly oneOfs: OneOfBinding[];
    private unionBindings: UnionBinding[] = [];
    private shapePredicateBind = new Map<string, boolean>();
    private strict: boolean;
    private negativeContradiction = false;
    // Predicates whose sh:node dependency was not established, but not refuted either.
    private nonRefutedDependency = new Set<string>();
    // Per nested star pattern, the shapes it was resolved against while checking sh:node.
    private dependencyEvidence = new Map<string, IDependencyEvidence[]>();
    private typeOfContainment: IContainmentType = { result: ContainmentType.NONE, unContaineStarPattern: [] };
    // The star patterns being matched against a shape, from the root to this one. A dependency back to
    // one of them is taken as established, the greatest fixpoint, so that cycles terminate.
    private alreadyTraversed: Map<string, boolean>;
    private readonly context?: IBindingContext;
    public readonly starPattern: IStarPatternWithDependencies;

    public constructor(shape: IShape, starPattern: IStarPatternWithDependencies, linkedShape: Map<string, IShape>, unionStarPattern?: IStarPatternWithDependencies[][], strict?: boolean, alreadyTraversed?: Map<string, boolean>, context?: IBindingContext) {
        this.starPattern = starPattern;
        this.strict = strict ?? false;
        this.closedShape = shape.closed;
        this.alreadyTraversed = alreadyTraversed ?? new Map();
        this.context = context;
        for (const { triple } of starPattern.starPattern.values()) {
            this.bindings.set(triple.predicate, undefined);
        }
        for (const predicate of shape.getAll()) {
            this.shapePredicateBind.set(predicate.name, false);
        }
        for (const predicate of impliedPredicateNames(shape)) {
            if (!this.shapePredicateBind.has(predicate)) {
                this.shapePredicateBind.set(predicate, false);
            }
        }
        this.oneOfs = shape.oneOfIndexed.map((oneOfs: OneOfPathIndexed[]) => new OneOfBinding(oneOfs));
        const key = traversalKey(starPattern.name, shape.name);
        const ownsKey = !this.alreadyTraversed.has(key);
        this.alreadyTraversed.set(key, true);
        this.calculateBinding(shape, starPattern, linkedShape, unionStarPattern ?? []);
        if (ownsKey) {
            this.alreadyTraversed.delete(key);
        }

        // delete duplicate
        this.unboundTriple = Array.from(new Set(this.unboundTriple));
    }


    private calculateBinding(shape: IShape, starPattern: IStarPatternWithDependencies, linkedShape: Map<string, IShape>, unionStarPattern: IStarPatternWithDependencies[][]): void {
        for (const union of unionStarPattern) {
            const unionBinding = new UnionBinding(shape, union, linkedShape, this.context, this.alreadyTraversed);
            this.unionBindings.push(unionBinding);
            // The shapes that branch triple patterns reach through sh:node govern the nested star patterns too
            for (const binding of unionBinding.bindings) {
                for (const evidence of binding.getDependencyEvidence()) {
                    this.addDependencyEvidence(evidence.starPatternName, evidence);
                }
            }
        }
        const negatedTriples: ITriple[] = [];
        for (const { triple, dependencies } of starPattern.starPattern.values()) {
            if (triple.predicate === Triple.NEGATIVE_PREDICATE_SET) {
                negatedTriples.push(triple);
                continue;
            }
            const declaredPredicate = shape.get(triple.predicate);
            // A predicate declared under sh:not (ShEx: a negative triple constraint) states that
            // conforming data must NOT carry it, so it can never satisfy a triple pattern.
            const negatedByShape = declaredPredicate?.negative === true;
            const singlePredicate = negatedByShape ? undefined : declaredPredicate;
            let predicates: IPredicate[] = [];
            // check if the triple match a disjunction
            for (const oneOfBinding of this.oneOfs) {
                const predicatesOneOf = oneOfBinding.get(triple.predicate);
                if (predicatesOneOf !== undefined) {
                    predicates = predicates.concat(predicatesOneOf);
                }
            }
            // constraints the shape implies through its targets or sh:ignoredProperties
            if (!negatedByShape) {
                predicates = predicates.concat(impliedPredicates(shape, triple.predicate));
            }

            if (singlePredicate === undefined && predicates.length === 0) {
                // A shape that explicitly forbids the predicate contradicts the triple pattern
                // whether or not it is closed; an open shape merely stays silent about unknown ones.
                if (negatedByShape && triple.isOptional !== true && !this.strict) {
                    this.negativeContradiction = true;
                }
                if ((negatedByShape || this.closedShape) && triple.isOptional !== true && !this.strict) {
                    this.unboundTriple.push(triple);
                }
                continue;
            }

            if (singlePredicate !== undefined) {
                predicates.push(singlePredicate);
            }
            this.evaluateConstraint(predicates, triple, linkedShape, shape, dependencies);



        }
        // A predicate the star pattern excludes but the shape requires in its body is carried by
        // every conforming node, so no data conforming to the shape answers the star pattern.
        if (!this.strict) {
            for (const excludedPredicate of starPattern.excludedPredicates ?? []) {
                const declaredPredicate = shape.get(excludedPredicate);
                const required = [declaredPredicate, ...impliedPredicates(shape, excludedPredicate)]
                    .some(predicate => predicate !== undefined && predicate.negative !== true && (predicate.cardinality?.min ?? 0) >= 1);
                if (declaredPredicate?.negative !== true && required) {
                    this.negativeContradiction = true;
                }
            }
        }
        // A shape about given nodes only cannot contain a star pattern about another constant subject.
        const subjectOutsideTargets = isSubjectOutsideNodeTargets(shape, starPattern);
        // negative triple in a strict containment mean that the we can take any values
        // see paper https://link.springer.com/chapter/10.1007/978-3-319-25007-6_1
        if (!this.strict) {
            for (const triple of negatedTriples) {
                this.bindNegatedPropertySet(shape, triple);
            }
        }
        let boundedUnionFull = true;
        let boundedUnion = true;
        const uncontainedUnionStarPatterns: IStarPatternWithDependencies[] = []
        for (const unionBinding of this.unionBindings) {
            boundedUnion = ((unionBinding.hasOneContained && !this.strict) ||
                (this.strict && unionBinding.areAllContained)) && boundedUnion;
            boundedUnionFull = boundedUnionFull && unionBinding.areAllContained;
            uncontainedUnionStarPatterns.push(...unionBinding.uncontained);
        }
        this.fullyBounded = this.isEveryRequiredTripleBound(starPattern) && boundedUnion && !this.negativeContradiction
            && !subjectOutsideTargets;
        if (this.fullyBounded) {
            const cycle = new Set<string>();
            const rejectedValues = new Set<string>();
            const result = new Map<string, string[]>();
            this.fillNestedContainedStarPatternName(starPattern, cycle, starPattern.name, rejectedValues, result);
            for (const starPattern of rejectedValues) {
                result.delete(starPattern);
            }
            let nestedContainedStarPatternName: string[] = [];
            for (const nestedConstrainStarPattern of result.values()) {
                nestedContainedStarPatternName = nestedContainedStarPatternName.concat(nestedConstrainStarPattern);
            }

            // delete duplicate
            nestedContainedStarPatternName = Array.from(new Set(nestedContainedStarPatternName));
            this.nestedContainedStarPatternName = nestedContainedStarPatternName
                .map((starPatternName) => {
                    return {
                        shape: this.nestedContainedStarPatternNameShapesContained.get(starPatternName),
                        starPattern: starPatternName,
                        origin: starPattern.name
                    };
                });

            for (const unionBinding of this.unionBindings) {
                this.nestedContainedStarPatternName = this.nestedContainedStarPatternName.concat(unionBinding.dependentStarPattern);
            }
            // delete duplicate
            this.nestedContainedStarPatternName = Array.from(new Set(this.nestedContainedStarPatternName));
        }
        if (!this.fullyBounded) {
            this.typeOfContainment = { result: ContainmentType.NONE };
        } else if (this.fullyBounded && boundedUnionFull) {
            this.typeOfContainment = { result: ContainmentType.FULL };
        } else {
            this.typeOfContainment = { result: ContainmentType.PARTIAL, unContaineStarPattern: uncontainedUnionStarPatterns };
        }
    }

    /**
     * A star pattern is fully bound when every *required* triple pattern binds.
     * OPTIONAL triple patterns (and shape properties with sh:minCount 0) are not needed to answer
     * the query, so they never block containment — this rule is the same for open and closed shapes.
     * At least one triple must bind, in the star pattern or in a branch of one of its UNIONs, so a
     * star pattern made only of unmatched optional patterns is not considered contained.
     */
    private isEveryRequiredTripleBound(starPattern: IStarPatternWithDependencies): boolean {
        let boundCount = 0;
        for (const { triple } of starPattern.starPattern.values()) {
            if (this.boundTriples.has(triple)) {
                boundCount++;
            } else if (triple.isOptional !== true) {
                return false;
            }
        }
        return boundCount > 0 || this.unionBindings.some(unionBinding => unionBinding.hasOneContained);
    }

    /** Record that a triple pattern binds to the shape. */
    private bind(triple: ITriple): void {
        this.bindings.set(triple.predicate, triple);
        this.boundTriples.add(triple);
    }

    /**
     * A negated property set `!P` matches a property of the shape that is not in P and whose
     * constraints its object satisfies, like a triple pattern on that property would. A property that
     * the shape forbids matches nothing.
     */
    private bindNegatedPropertySet(shape: IShape, triple: ITriple): void {
        const candidates = [
            ...shape.getAll().filter(predicate => predicate.negative !== true),
            ...impliedPredicateNames(shape).flatMap(predicate => impliedPredicates(shape, predicate)),
            ...shape.oneOf.flat(2),
        ].filter(predicate => !triple.negatedSet?.has(predicate.name));
        const matches = candidates.some(predicate => predicate.constraint === undefined ||
            Bindings.handleTypeConstraint(predicate.constraint,
                new Triple({ subject: triple.subject, predicate: predicate.name, object: triple.object })) !== ConstraintResult.NOT_RESPECT);
        if (matches) {
            this.bind(triple);
        } else if (triple.isOptional !== true && (this.closedShape || candidates.length > 0)) {
            this.unboundTriple.push(triple);
        }
    }

    private evaluateConstraint(predicates: IPredicate[],
        triple: ITriple,
        linkedShape: Map<string, IShape>,
        shape: IShape,
        dependencies: IStarPatternWithDependencies | undefined): void {
        let validConstraint = false;
        for (const predicate of predicates) {
            const constraint = predicate.constraint;

            if (constraint === undefined) {
                validConstraint = validConstraint || true;
                break;
            }

            const shapeContraintResult = this.handleShapeConstraint(constraint, triple, linkedShape, shape, dependencies);
            if (shapeContraintResult === ConstraintResult.NOT_RESPECT) {
                validConstraint = validConstraint || false;
                continue;
            }
            if (shapeContraintResult === ConstraintResult.RESPECT) {
                validConstraint = validConstraint || true;
                continue;
            }

            const typeConstraintResult = Bindings.handleTypeConstraint(constraint, triple);
            if (typeConstraintResult === ConstraintResult.NOT_RESPECT) {
                validConstraint = validConstraint || false;
                continue;
            }
            if (typeConstraintResult === ConstraintResult.RESPECT) {
                validConstraint = validConstraint || true;
                continue;
            }

            // all the constraint are valid so we can skip the rest of the predicate with the same IRI but
            // possible different constraints.
            validConstraint = validConstraint || true;
            break;
        }

        // An optional triple pattern that does not match neither binds nor prevents containment
        if (validConstraint) {
            this.bind(triple);
            this.shapePredicateBind.set(triple.predicate, true);
        } else if (triple.isOptional !== true) {
            this.unboundTriple.push(triple);
        }
    }

    private fillNestedContainedStarPatternName(starPattern: IStarPatternWithDependencies, cycle: Set<string>, originalName: string, rejectedValues: Set<string>, result: Map<string, string[]>): void {
        for (const { dependencies } of starPattern.starPattern.values()) {
            if (dependencies !== undefined) {
                const currentBranch = result.get(starPattern.name);
                if (currentBranch !== undefined) {
                    currentBranch.push(dependencies.name);
                } else {
                    result.set(starPattern.name, [dependencies.name]);
                }
                if (result.has(dependencies.name)) {
                    cycle.add(dependencies.name);
                    cycle.add(starPattern.name);
                }
                // we don't make dependent star pattern directly cycled connected to the current star pattern
                if (result.has(dependencies.name) && dependencies.name === originalName) {
                    rejectedValues.add(dependencies.name);
                    rejectedValues.add(starPattern.name);
                }
                // to avoid infinite loop
                if (!cycle.has(dependencies.name)) {
                    this.fillNestedContainedStarPatternName(dependencies, cycle, originalName, rejectedValues, result);
                }
            }
        }

    }

    private handleShapeConstraint(
        constraint: IConstraint,
        triple: ITriple,
        linkedShape: Map<string, IShape>,
        currentShape: IShape,
        dependencies?: IStarPatternWithDependencies): ConstraintResult {
        if (constraint.type === ConstraintType.SHAPE && dependencies !== undefined && constraint.value.size == 1) {
            const shapeName = constraint.value.values().next().value;
            const currentLinkedShape = currentShape.name === shapeName ? currentShape 
                : shapeName !== undefined ? linkedShape.get(shapeName) : undefined;
            if (currentLinkedShape === undefined) {
                return ConstraintResult.RESPECT;
            }
            if (this.alreadyTraversed.has(traversalKey(dependencies.name, currentLinkedShape.name))) {
                return ConstraintResult.RESPECT;
            }
            const nestedBinding = new Bindings(withoutTargets(currentLinkedShape), dependencies, linkedShape,
                this.context?.unionsOf?.(dependencies.name) ?? [], this.strict, this.alreadyTraversed, this.context);
            // The filters of the input apply to the nested star pattern as to any other
            const filterCompatible = filtersCompatible(this.context?.filters, dependencies, currentLinkedShape);
            this.recordDependencyEvidence(dependencies.name, currentLinkedShape, nestedBinding, filterCompatible);
            for (const [starPatternName, evidence] of nestedBinding.dependencyEvidence) {
                for (const entry of evidence) {
                    this.addDependencyEvidence(starPatternName, entry);
                }
            }
            if (nestedBinding.isFullyBounded() && filterCompatible) {
                this.bind(triple);
                this.nestedContainedStarPatternNameShapesContained = new Map(
                    [
                        ...this.nestedContainedStarPatternNameShapesContained,
                        ...nestedBinding.nestedContainedStarPatternNameShapesContained
                    ]);
                const dependentShape = this.nestedContainedStarPatternNameShapesContained.get(dependencies.name);
                if (dependentShape === undefined) {
                    this.nestedContainedStarPatternNameShapesContained.set(dependencies.name, [currentLinkedShape.name]);
                } else {
                    dependentShape.push(currentLinkedShape.name);
                }
                return ConstraintResult.RESPECT;
            }
            // The dependency was not established. Distinguish a referenced shape that *refutes* the
            // nested pattern — it is closed and leaves a required triple unbound, or it forbids a
            // predicate — from one that does not decide it, because it is open. Only the former is
            // evidence of incompatibility; the latter leaves the predicate of this triple matched by
            // the current shape, which the classification records as a partial match.
            const refutes = (currentLinkedShape.closed && nestedBinding.getUnboundedTriple().length > 0)
                || nestedBinding.hasNegativeContradiction();
            if (!refutes) {
                this.nonRefutedDependency.add(triple.predicate);
            }
            return ConstraintResult.NOT_RESPECT;
        }

        return ConstraintResult.INAPPLICABLE;
    }

    private static handleTypeConstraint(
        constraint: IConstraint,
        triple: ITriple): ConstraintResult {
        if (constraint.type === ConstraintType.CLASS &&
            triple.predicate === RDF.type &&
            !Array.isArray(triple.object) &&
            triple.object.termType === "NamedNode"
            && constraint.value.has(triple.object.value)) {
            return ConstraintResult.RESPECT;

        } else if (constraint.type === ConstraintType.CLASS &&
            triple.predicate === RDF.type &&
            !Array.isArray(triple.object) &&
            triple.object.termType === "NamedNode"
            && !constraint.value.has(triple.object.value)) {
            return ConstraintResult.NOT_RESPECT;
        } else if (constraint.type === ConstraintType.CLASS &&
            triple.predicate === RDF.type &&
            Array.isArray(triple.object)) {
            for (const object of triple.object) {
                if (constraint.value.has(object.value)) {
                    return ConstraintResult.RESPECT;
                }
            }
            return ConstraintResult.NOT_RESPECT;
        } else if (constraint.type === ConstraintType.CLASS && triple.predicate !== RDF.type) {
            return ConstraintResult.NOT_RESPECT;
        }

        // Whether a node is an instance of a class is decided by the data, but a literal never is one
        if (constraint.type === ConstraintType.INSTANCE) {
            const objects = Array.isArray(triple.object) ? triple.object : [triple.object];
            return objects.every(object => object.termType === "Literal") ? ConstraintResult.NOT_RESPECT : ConstraintResult.INAPPLICABLE;
        }

        // An IRI is not a literal, so it has no datatype
        if (constraint.type === ConstraintType.DATATYPE && !Array.isArray(triple.object) && triple.object.termType === "NamedNode") {
            return ConstraintResult.NOT_RESPECT;
        }

        if (constraint.type === ConstraintType.DATATYPE &&
            !Array.isArray(triple.object) &&
            triple.object.termType === "Literal"
            && constraint.value.has(triple.object.datatype.value)
        ) {
            if (!Bindings.respectNumericFacets(constraint, triple.object.value)) {
                return ConstraintResult.NOT_RESPECT;
            }
            if (!Bindings.respectPatternFacet(constraint, triple.object.value)) {
                return ConstraintResult.NOT_RESPECT;
            }
            return ConstraintResult.RESPECT;
        } else if (constraint.type === ConstraintType.DATATYPE &&
            !Array.isArray(triple.object) &&
            triple.object.termType === "Literal"
            && !constraint.value.has(triple.object.datatype.value)) {
            return ConstraintResult.NOT_RESPECT;
        } else if (constraint.type === ConstraintType.DATATYPE &&
            Array.isArray(triple.object)) {
            let hasDatatypeMatch = false;
            for (const object of triple.object) {
                if (object.termType === "Literal" && constraint.value.has(object.datatype.value)) {
                    hasDatatypeMatch = true;
                    if (!Bindings.respectNumericFacets(constraint, object.value)) {
                        continue;
                    }
                    if (!Bindings.respectPatternFacet(constraint, object.value)) {
                        continue;
                    }
                    return ConstraintResult.RESPECT;
                }
            }
            if (hasDatatypeMatch) {
                return ConstraintResult.NOT_RESPECT;
            }
            return ConstraintResult.NOT_RESPECT;
        }

        return ConstraintResult.INAPPLICABLE;
    }

    private static respectNumericFacets(constraint: IConstraint, literalValue: string): boolean {
        const hasNumericFacet = constraint.minInclusive !== undefined
            || constraint.maxInclusive !== undefined
            || constraint.minExclusive !== undefined
            || constraint.maxExclusive !== undefined;

        if (!hasNumericFacet) {
            return true;
        }

        const value = Number(literalValue);
        if (Number.isNaN(value)) {
            return false;
        }

        if (constraint.minInclusive !== undefined && value < constraint.minInclusive) {
            return false;
        }
        if (constraint.maxInclusive !== undefined && value > constraint.maxInclusive) {
            return false;
        }
        if (constraint.minExclusive !== undefined && value <= constraint.minExclusive) {
            return false;
        }
        if (constraint.maxExclusive !== undefined && value >= constraint.maxExclusive) {
            return false;
        }

        return true;
    }

    private static respectPatternFacet(constraint: IConstraint, literalValue: string): boolean {
        if (constraint.pattern === undefined) {
            return true;
        }

        try {
            return new RegExp(constraint.pattern, constraint.flags).test(literalValue);
        } catch {
            return false;
        }
    }

    public isFullyBounded(): boolean {
        return this.fullyBounded;
    }

    public containmentType(): IContainmentType {
        return this.typeOfContainment;
    }

    public getUnboundedTriple(): ITriple[] {
        return new Array(...this.unboundTriple);
    }

    public getBindings(): Map<string, ITriple | undefined> {
        return new Map(this.bindings);
    }

    public getBoundTriple(): ITriple[] {
        const resp: ITriple[] = [];
        for (const triple of this.bindings.values()) {
            if (triple !== undefined) {
                resp.push(triple);
            }
        }
        return resp;
    }

    /**
     * A shape is worth visiting when a triple pattern of the input binds to it, in the star pattern or
     * in one of its UNION branches, or matches its predicate while its dependency is undecided.
     */
    public shouldVisitShape(): boolean {
        return this.hasRootMatch();
    }

    public hasNegativeContradiction(): boolean {
        return this.negativeContradiction;
    }

    public hasRootMatch(): boolean {
        return this.getBoundTriple().length > 0 || this.hasNonRefutedDependency()
            || this.unionBindings.some(unionBinding => unionBinding.hasMatch);
    }

    public hasNonRefutedDependency(): boolean {
        return this.nonRefutedDependency.size > 0;
    }

    public getDependencyEvidence(): IDependencyEvidence[] {
        const resp: IDependencyEvidence[] = [];
        for (const evidence of this.dependencyEvidence.values()) {
            resp.push(...evidence);
        }
        return resp;
    }

    private recordDependencyEvidence(starPatternName: string, shape: IShape, nested: Bindings, filterCompatible: boolean): void {
        this.addDependencyEvidence(starPatternName, {
            starPatternName,
            shapeName: shape.name,
            closed: shape.closed,
            hasMatch: nested.hasRootMatch(),
            contained: nested.isFullyBounded()
                && nested.containmentType().result === ContainmentType.FULL,
            filterCompatible,
            bindings: nested,
        });
    }

    private addDependencyEvidence(starPatternName: string, entry: IDependencyEvidence): void {
        const existing = this.dependencyEvidence.get(starPatternName);
        if (existing === undefined) {
            this.dependencyEvidence.set(starPatternName, [entry]);
            return;
        }
        if (!existing.some(candidate => candidate.shapeName === entry.shapeName)) {
            existing.push(entry);
        }
    }

    public getNestedContainedStarPatternName(): IDependentStarPattern[] {
        return this.nestedContainedStarPatternName;
    }

    public getNestedContainedStarPatternNameShapesContained(): Map<string, string[]> {
        return new Map(this.nestedContainedStarPatternNameShapesContained);
    }
}

export class OneOfBinding {
    private readonly paths: OneOfPathIndexed[];

    public constructor(paths: OneOfPathIndexed[]) {
        this.paths = paths;
    }

    public get(el: string): IPredicate[] | undefined {
        const resp = [];
        for (const path of this.paths) {
            const predicate = path.get(el);
            if (predicate !== undefined) {
                resp.push(predicate);
            }
        }
        return resp.length === 0 ? undefined : resp;
    }
}

export class UnionBinding {
    public readonly bindings: IBindings[];
    public readonly hasOneContained: boolean;
    public readonly areAllContained: boolean;
    // a triple pattern of a branch binds, in a branch whose filters do not contradict the shape
    public readonly hasMatch: boolean;
    // the branch star patterns that the shape does not contain
    public readonly uncontained: IStarPatternWithDependencies[];
    public readonly dependentStarPattern: IDependentStarPattern[];
    public readonly shape: IShape;
    public readonly linkedShape: Map<string, IShape>;
    // whether each branch is contained, its filters included
    private readonly contained: boolean[];

    public constructor(shape: IShape, union: IStarPatternWithDependencies[], linkedShape: Map<string, IShape>, context?: IBindingContext, alreadyTraversed?: Map<string, boolean>) {
        this.shape = shape;
        this.linkedShape = linkedShape;
        this.bindings = [];
        this.contained = [];
        let hasMatch = false;
        for (const starPattern of union) {
            const binding = new Bindings(shape, starPattern, linkedShape, undefined, undefined, alreadyTraversed, context);
            // The filters of the input and those of the branch apply to the branch star pattern
            const filters = [...context?.filters ?? [], ...context?.branchFilters?.get(starPattern) ?? []];
            const compatible = filtersCompatible(filters, starPattern, shape);
            this.bindings.push(binding);
            this.contained.push(compatible && binding.isFullyBounded());
            hasMatch = hasMatch || (compatible && binding.hasRootMatch());
        }
        this.hasMatch = hasMatch;
        this.uncontained = union.filter((_, index) => !this.contained[index]);
        this.hasOneContained = this.determineHasOneAtLeastContainment();
        this.areAllContained = this.determineAllContained();

        const dependentStarPatternSet = new Map<string, IDependentStarPattern>();

        for (const binding of this.bindings) {
            for (const startPattern of binding.getNestedContainedStarPatternName()) {
                dependentStarPatternSet.set(startPattern.starPattern, startPattern);
            }
        }

        this.dependentStarPattern = Array.from(dependentStarPatternSet.values());
    }

    private determineHasOneAtLeastContainment(): boolean {
        return this.contained.some(contained => contained);
    }

    private determineAllContained(): boolean {
        return this.contained.every(contained => contained);
    }
}