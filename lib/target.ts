import { ConstraintType, type IPredicate, type IShape, hasTargets, targetsOf } from './Shape';
import type { IStarPatternWithDependencies } from './Triple';
import { RDF } from './constant';

/**
 * The constants the subject of a star pattern is restricted to, or undefined when it is a variable.
 */
export function constantSubjects(starPattern: IStarPatternWithDependencies): Set<string> | undefined {
  if (starPattern.subjectValues !== undefined) {
    return starPattern.subjectValues;
  }
  return starPattern.isVariable ? undefined : new Set([starPattern.name]);
}

/**
 * The property constraints a shape implies without declaring them, as alternatives for a predicate.
 *
 * - A class target (sh:targetClass, or an implicit class target) makes every focus node an instance
 *   of a target class, so the shape implies `rdf:type` with one of those classes as value.
 * - A subjects-of target (sh:targetSubjectsOf) makes every focus node carry the predicate.
 * - A closed shape allows the properties listed by sh:ignoredProperties, without constraining them.
 *
 * The focus nodes of a shape are the union of the nodes of its targets, so an implied constraint is
 * only required (minimum 1) when every focus node carries it: when all the targets are class
 * targets, or when the only target is one subjects-of target.
 *
 * Targets only apply when the shape is used on its own (`useTargets`): SHACL ignores them when the
 * shape is reached through sh:node. sh:ignoredProperties applies in both cases.
 */
export function impliedPredicates(shape: IShape, predicate: string, useTargets: boolean): IPredicate[] {
  const implied: IPredicate[] = [];
  if (useTargets) {
    const { nodes, classes, subjectsOf, objectsOf } = targetsOf(shape);
    if (predicate === RDF.type && classes.length > 0) {
      const onlyClassTargets = nodes.length + subjectsOf.length + objectsOf.length === 0;
      implied.push({
        name: predicate,
        constraint: { type: ConstraintType.CLASS, value: new Set(classes) },
        cardinality: { min: onlyClassTargets ? 1 : 0, max: -1 },
      });
    }
    if (subjectsOf.includes(predicate)) {
      const onlyTarget = subjectsOf.length === 1 && nodes.length + classes.length + objectsOf.length === 0;
      implied.push({ name: predicate, cardinality: { min: onlyTarget ? 1 : 0, max: -1 } });
    }
  }
  if (shape.closed && (shape.ignoredProperties ?? []).includes(predicate)) {
    implied.push({ name: predicate, cardinality: { min: 0, max: -1 }, optional: true });
  }
  return implied;
}

/**
 * Every predicate for which {@link impliedPredicates} yields a constraint.
 */
export function impliedPredicateNames(shape: IShape, useTargets: boolean): string[] {
  const names = new Set<string>();
  if (useTargets) {
    const { classes, subjectsOf } = targetsOf(shape);
    if (classes.length > 0) {
      names.add(RDF.type);
    }
    for (const predicate of subjectsOf) {
      names.add(predicate);
    }
  }
  if (shape.closed) {
    for (const predicate of shape.ignoredProperties ?? []) {
      names.add(predicate);
    }
  }
  return Array.from(names);
}

/**
 * Whether a shape whose only targets are node targets is about other nodes than the star pattern.
 * Such a shape describes the listed nodes and nothing else, so it cannot contain a star pattern whose
 * subject is a constant it does not list. Any other target leaves the subject undecided.
 */
export function isSubjectOutsideNodeTargets(shape: IShape, starPattern: IStarPatternWithDependencies): boolean {
  const { nodes, classes, subjectsOf, objectsOf } = targetsOf(shape);
  if (nodes.length === 0 || classes.length + subjectsOf.length + objectsOf.length > 0) {
    return false;
  }
  const subjects = constantSubjects(starPattern);
  if (subjects === undefined) {
    return false;
  }
  return !Array.from(subjects).some(subject => nodes.includes(subject));
}

/**
 * Whether a shape describes a star pattern: the shape's closedness and negative property constraints
 * apply to the nodes matching the pattern. A shape without targets describes every star pattern. A
 * shape with targets only describes the nodes of its targets, so it describes a star pattern only
 * when every node matching it is in a target:
 *
 * - its subject is a node target;
 * - it requires an `rdf:type` whose values are all target classes;
 * - it requires a predicate whose subjects are targets (sh:targetSubjectsOf); or
 * - it is reached through a required triple pattern whose predicate has objects as targets
 *   (sh:targetObjectsOf).
 *
 * @param incoming the predicates of the required triple patterns through which each star pattern is reached
 */
export function describesStarPattern(
  shape: IShape,
  starPattern: IStarPatternWithDependencies,
  incoming: Map<string, Set<string>>,
): boolean {
  if (!hasTargets(shape)) {
    return true;
  }
  const { nodes, classes, subjectsOf, objectsOf } = targetsOf(shape);

  const subjects = constantSubjects(starPattern);
  if (subjects !== undefined && subjects.size > 0 && Array.from(subjects).every(subject => nodes.includes(subject))) {
    return true;
  }

  for (const { triple } of starPattern.starPattern.values()) {
    if (triple.isOptional === true) {
      continue;
    }
    if (triple.predicate === RDF.type && classes.length > 0) {
      const objects = Array.isArray(triple.object) ? triple.object : [ triple.object ];
      if (objects.length > 0 && objects.every(object => object.termType === 'NamedNode' && classes.includes(object.value))) {
        return true;
      }
    }
    if (subjectsOf.includes(triple.predicate)) {
      return true;
    }
  }

  const incomingPredicates = incoming.get(starPattern.name);
  return incomingPredicates !== undefined && objectsOf.some(predicate => incomingPredicates.has(predicate));
}

/**
 * For each star pattern, the predicates of the required triple patterns whose object it is.
 */
export function incomingRequiredPredicates(
  starPatterns: Map<string, IStarPatternWithDependencies>,
): Map<string, Set<string>> {
  const incoming = new Map<string, Set<string>>();
  for (const starPattern of starPatterns.values()) {
    for (const { triple, dependencies } of starPattern.starPattern.values()) {
      if (dependencies === undefined || triple.isOptional === true) {
        continue;
      }
      let predicates = incoming.get(dependencies.name);
      if (predicates === undefined) {
        predicates = new Set();
        incoming.set(dependencies.name, predicates);
      }
      predicates.add(triple.predicate);
    }
  }
  return incoming;
}
