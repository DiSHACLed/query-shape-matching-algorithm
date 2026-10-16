import type { Term } from '@rdfjs/types';
import { ConstraintType, type IPredicate, type IShape, type IShapeTargets } from './Shape';
import type { IStarPatternWithDependencies } from './Triple';
import { RDF, XSD } from './constant';

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
 * The focus nodes a shape selects through its targets when it is used on its own:
 *
 * - `any`: the shape declares no target and describes any node;
 * - `nodes`: only node targets (sh:targetNode);
 * - `objectsOf`: a single objects-of target (sh:targetObjectsOf) and no other target;
 * - `alternatives`: only class and subjects-of targets, see {@link targetAlternatives};
 * - `mixed`: node or objects-of targets combined with other targets, or several objects-of targets.
 */
export type FocusNodes =
  | { kind: 'any' }
  | { kind: 'nodes', nodes: string[] }
  | { kind: 'objectsOf', predicate: string }
  | { kind: 'alternatives', alternatives: ITargetAlternative[] }
  | { kind: 'mixed' };

/**
 * A predicate that some focus nodes carry because of a target: `rdf:type` with one of the target
 * classes, or the predicate of a subjects-of target.
 */
export interface ITargetAlternative {
  predicate: string;
  // the target classes, for the alternative of the class targets
  classes?: string[];
}

export function focusNodes(targets: IShapeTargets): FocusNodes {
  const { nodes, classes, subjectsOf, objectsOf } = targets;
  const kinds = [ nodes, classes, subjectsOf, objectsOf ].filter(values => values.length > 0).length;
  if (kinds === 0) {
    return { kind: 'any' };
  }
  if (nodes.length === 0 && objectsOf.length === 0) {
    return { kind: 'alternatives', alternatives: targetAlternatives(targets) };
  }
  if (kinds > 1 || objectsOf.length > 1) {
    return { kind: 'mixed' };
  }
  return nodes.length > 0 ? { kind: 'nodes', nodes } : { kind: 'objectsOf', predicate: objectsOf[0] };
}

/**
 * The alternatives the class and subjects-of targets offer: one for all the class targets, which
 * all imply `rdf:type`, and one per subjects-of target. The focus nodes of a shape are the union of
 * the nodes of its targets, so an alternative holds for every focus node only when it is the only
 * alternative and the shape has no other target.
 */
export function targetAlternatives({ classes, subjectsOf }: IShapeTargets): ITargetAlternative[] {
  const alternatives: ITargetAlternative[] = classes.length > 0 ? [{ predicate: RDF.type, classes }] : [];
  return alternatives.concat(subjectsOf.map(predicate => ({ predicate })));
}

/**
 * The key of an RDF term as a node target. An IRI is its value, as the constant subject of a star
 * pattern is; a literal or a blank node is its N-Triples form, so that it neither matches an IRI
 * with the same text nor loses its datatype or language.
 */
export function nodeTargetKey(term: Term): string {
  if (term.termType === 'BlankNode') {
    return `_:${term.value}`;
  }
  if (term.termType !== 'Literal') {
    return term.value;
  }
  const value = JSON.stringify(term.value);
  if (term.language !== '') {
    return `${value}@${term.language}`;
  }
  return term.datatype.value === XSD.string ? value : `${value}^^<${term.datatype.value}>`;
}

/**
 * The property constraints a shape implies without declaring them, as alternatives for a predicate.
 *
 * - A class target (sh:targetClass, or an implicit class target) makes every focus node an instance
 *   of a target class, so the shape implies `rdf:type` with one of those classes as value.
 * - A subjects-of target (sh:targetSubjectsOf) makes every focus node carry the predicate.
 * - A closed shape allows the properties listed by sh:ignoredProperties, without constraining them.
 *
 * A constraint implied by a target is only required (minimum 1) when every focus node carries it,
 * see {@link targetAlternatives}.
 *
 * Targets only apply when the shape is used on its own (`useTargets`): SHACL ignores them when the
 * shape is reached through sh:node. sh:ignoredProperties applies in both cases.
 */
export function impliedPredicates(shape: IShape, predicate: string, useTargets: boolean): IPredicate[] {
  const implied: IPredicate[] = [];
  if (useTargets) {
    const alternatives = targetAlternatives(shape.targets);
    const required = alternatives.length === 1 && focusNodes(shape.targets).kind === 'alternatives';
    for (const alternative of alternatives) {
      if (alternative.predicate !== predicate) {
        continue;
      }
      implied.push({
        name: predicate,
        ...alternative.classes !== undefined ?
          { constraint: { type: ConstraintType.CLASS, value: new Set(alternative.classes) } } :
          {},
        cardinality: { min: required ? 1 : 0, max: -1 },
      });
    }
  }
  if (shape.closed && shape.ignoredProperties.includes(predicate)) {
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
    for (const { predicate } of targetAlternatives(shape.targets)) {
      names.add(predicate);
    }
  }
  if (shape.closed) {
    for (const predicate of shape.ignoredProperties) {
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
  const focus = focusNodes(shape.targets);
  const subjects = constantSubjects(starPattern);
  if (focus.kind !== 'nodes' || subjects === undefined) {
    return false;
  }
  return !Array.from(subjects).some(subject => focus.nodes.includes(subject));
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
  if (focusNodes(shape.targets).kind === 'any') {
    return true;
  }
  const { nodes, classes, subjectsOf, objectsOf } = shape.targets;

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
