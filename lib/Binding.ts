import { ConstraintType, IContraint, IPredicate, IShape, OneOfPathIndexed } from "./Shape";
import { IStarPatternWithDependencies, type ITriple, Triple } from "./Triple";

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
    private unboundTriple: ITriple[] = [];
    private fullyBounded = false;
    private readonly closedShape: boolean;
    private nestedContainedStarPatternName: IDependentStarPattern[] = [];
    private nestedContainedStarPatternNameShapesContained = new Map<string, string[]>();
    private readonly oneOfs: OneOfBinding[];
    private unionBindings: UnionBinding[] = [];
    private shapePredicateBind = new Map<string, boolean>();
    private strict: boolean;
    private allOptional = true;
    private typeOfContainment: IContainmentType = { result: ContainmentType.NONE, unContaineStarPattern: [] };
    private alreadyTraversed: Map<string, boolean>;
    public readonly starPattern: IStarPatternWithDependencies;

    public constructor(shape: IShape, starPattern: IStarPatternWithDependencies, linkedShape: Map<string, IShape>, unionStarPattern?: IStarPatternWithDependencies[][], strict?: boolean, alreadyTraversed?: Map<string, boolean>) {
        this.starPattern = starPattern;
        this.strict = strict ?? false;
        this.closedShape = shape.closed;
        this.alreadyTraversed = alreadyTraversed ?? new Map();
        for (const { triple } of starPattern.starPattern.values()) {
            this.bindings.set(triple.predicate, undefined);
            this.allOptional = this.allOptional && triple.isOptional === true;
        }
        for (const predicate of shape.getAll()) {
            this.shapePredicateBind.set(predicate.name, false);
        }
        this.oneOfs = shape.oneOfIndexed.map((oneOfs: OneOfPathIndexed[]) => new OneOfBinding(oneOfs));
        this.calculateBinding(shape, starPattern, linkedShape, unionStarPattern ?? []);

        // delete duplicate
        this.unboundTriple = Array.from(new Set(this.unboundTriple));
    }


    private calculateBinding(shape: IShape, starPattern: IStarPatternWithDependencies, linkedShape: Map<string, IShape>, unionStarPattern: IStarPatternWithDependencies[][]): void {
        for (const union of unionStarPattern) {
            this.unionBindings.push(new UnionBinding(shape, union, linkedShape));
        }
        const negatedTriples: ITriple[] = [];
        for (const { triple, dependencies } of starPattern.starPattern.values()) {
            if (!this.closedShape) {
                this.bindings.set(triple.predicate, triple);
                continue;
            }
            if (triple.predicate === Triple.NEGATIVE_PREDICATE_SET) {
                negatedTriples.push(triple);
                continue;
            }
            const singlePredicate = shape.get(triple.predicate);
            let predicates: IPredicate[] = [];
            // check if the triple match a disjunction
            for (const oneOfBinding of this.oneOfs) {
                const predicatesOneOf = oneOfBinding.get(triple.predicate);
                if (predicatesOneOf !== undefined) {
                    predicates = predicates.concat(predicatesOneOf);
                }
            }

            if (singlePredicate === undefined &&
                predicates.length === 0
                && triple.isOptional !== true &&
                !this.strict) {
                this.unboundTriple.push(triple);
            } else {
                if (singlePredicate !== undefined) {
                    predicates.push(singlePredicate);
                }
                this.evaluateConstraint(predicates, triple, linkedShape, shape, dependencies);
            }



        }
        // negative triple in a strict containment mean that the we can take any values
        // see paper https://link.springer.com/chapter/10.1007/978-3-319-25007-6_1
        if (!this.strict) {
            for (const triple of negatedTriples) {
                let hasBind = false;
                for (const [predicate, isBind] of this.shapePredicateBind) {
                    if (!isBind && !triple.negatedSet?.has(predicate)) {
                        this.bindings.set(triple.predicate, triple);
                        this.shapePredicateBind.set(predicate, true);
                        hasBind = true;
                        continue;
                    }
                }
                if (!hasBind) {
                    this.unboundTriple.push(triple);
                }
            }
        }
        let boundedUnionFull = true;
        const uncontainedUnionStarPatterns: IStarPatternWithDependencies[] = []

        if (shape.closed === false) {
            this.fullyBounded = starPattern.starPattern.size !== 0;
        } else {
            let boundedUnion = true;
            for (const unionBinding of this.unionBindings) {
                boundedUnion = ((unionBinding.hasOneContained && !this.strict) ||
                    (this.strict && unionBinding.areAllContained)) && boundedUnion;
                boundedUnionFull = boundedUnionFull && unionBinding.areAllContained;
                if (!unionBinding.areAllContained) {
                    for (const binding of unionBinding.bindings) {
                        if (!binding.isFullyBounded()) {
                            uncontainedUnionStarPatterns.push(binding.starPattern);
                        }
                    }
                }
            }
            this.fullyBounded = this.unboundTriple.length === 0 && starPattern.starPattern.size !== 0 && boundedUnion;
        }
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

            const typeConstraintResult = Bindings.handleShapeType(constraint, triple);
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

        if (validConstraint) {
            this.bindings.set(triple.predicate, triple);
            this.shapePredicateBind.set(triple.predicate, true);
        } else if (!this.strict && triple.isOptional === true && this.allOptional === false) {
            this.bindings.set(triple.predicate, triple);
        } else {
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
        constraint: IContraint,
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
            const nestedBinding = new Bindings(currentLinkedShape, dependencies, linkedShape, [], this.strict);
            if (nestedBinding.isFullyBounded()) {
                this.bindings.set(triple.predicate, triple);
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
            } else {
                return ConstraintResult.NOT_RESPECT;
            }
        }

        return ConstraintResult.INAPPLICABLE;
    }

    private static handleShapeType(
        constraint: IContraint,
        triple: ITriple): ConstraintResult {
        if (constraint.type === ConstraintType.TYPE &&
            !Array.isArray(triple.object) &&
            triple.object.termType === "Literal"
            && constraint.value.has(triple.object.datatype.value)
        ) {
            return ConstraintResult.RESPECT;
        } else if (constraint.type === ConstraintType.TYPE &&
            !Array.isArray(triple.object) &&
            triple.object.termType === "NamedNode"
            && constraint.value.has(triple.object.value)) {
            return ConstraintResult.RESPECT;

        } else if (constraint.type === ConstraintType.TYPE &&
            !Array.isArray(triple.object) &&
            triple.object.termType === "Literal"
            && !constraint.value.has(triple.object.datatype.value)) {
            return ConstraintResult.NOT_RESPECT;
        }
        else if (constraint.type === ConstraintType.TYPE &&
            !Array.isArray(triple.object) &&
            triple.object.termType === "NamedNode"
            && !constraint.value.has(triple.object.value)) {
            return ConstraintResult.NOT_RESPECT;
        } else if (constraint.type === ConstraintType.TYPE &&
            Array.isArray(triple.object)) {
            for (const object of triple.object) {
                if (constraint.value.has(object.value) || (object.termType === "Literal" && constraint.value.has(object.datatype.value))) {
                    return ConstraintResult.RESPECT;
                }
            }
        }

        return ConstraintResult.INAPPLICABLE;
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

    public shouldVisitShape(): boolean {
        return this.getBoundTriple().length > 0;
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
    public readonly dependentStarPattern: IDependentStarPattern[];
    public readonly shape: IShape;
    public readonly linkedShape: Map<string, IShape>;

    public constructor(shape: IShape, union: IStarPatternWithDependencies[], linkedShape: Map<string, IShape>) {
        this.shape = shape;
        this.linkedShape = linkedShape;
        this.bindings = [];
        for (const starPattern of union) {
            this.bindings.push(new Bindings(shape, starPattern, linkedShape));
        }
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
        let hasOneContainment = false;
        for (const binding of this.bindings) {
            hasOneContainment = hasOneContainment || binding.isFullyBounded();
        }
        return hasOneContainment;
    }

    private determineAllContained(): boolean {
        let hasOneContainment = true;
        for (const binding of this.bindings) {
            hasOneContainment = hasOneContainment && binding.isFullyBounded();
        }
        return hasOneContainment;
    }
}