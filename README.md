# query-shape-matching-algorithm
[![CI](https://github.com/DiSHACLed/query-shape-matching-algorithm/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DiSHACLed/query-shape-matching-algorithm/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/query-shape-matching.svg)](https://www.npmjs.com/package/query-shape-matching)

Reference implementation for the query/shape matching algorithm described in the discovery specification.

It is implemented as a Node.js library to calculate the containment (subsumption) between [SPARQL queries](https://www.w3.org/TR/sparql11-query/) and [RDF data shapes](https://www.w3.org/groups/wg/data-shapes/) (ShEx and SHACL) at the star pattern level.

## Features

- **Support for different shape formats**: Supports both **ShEx** (Shape Expressions) and **SHACL** (Shapes Constraint Language).
- **Star Pattern Decomposition**: Breaks down complex SPARQL queries into star patterns (groups of triple patterns sharing the same subject).
- **Alignment Detection**: Identifies how closely a query matches the constraints defined in a shape.
- **Dependency Tracking**: Handles links between shapes, detecting when a star pattern depends on another to be fully bounded.
- **Explicit Negation**: A predicate declared under SHACL `sh:not` or limited by `sh:maxCount 0` (or a ShEx negative triple constraint) never matches. Because such a shape states that the property must be absent, a query needing it is `REJECTED` even when the shape is open.
- **Negated Triple Patterns**: A `FILTER NOT EXISTS` or `MINUS` over a single triple pattern `?s p ?o` (with `?s` bound by a required triple pattern and `?o` fresh) states that `?s` must not carry `p`. A shape that requires `p` (`sh:minCount` of at least 1) contradicts it, so the star pattern is `REJECTED` even when the shape is open. A `sh:not` of an input shape is translated the same way.
- **SHACL Targets**: `sh:targetNode`, `sh:targetClass` (including implicit class targets), `sh:targetSubjectsOf` and `sh:targetObjectsOf` say which nodes a shape describes. The targets of a source shape become patterns about its focus node; the targets of a candidate shape are matched, and limit which star patterns its closedness can reject. See [Targets](#targets).

## How it Works

1. **Query Parsing**: The library converts a SPARQL query into its algebraic representation and groups triple patterns into **Star Patterns**.
2. **Shape Parsing**: It parses ShEx or SHACL definitions (from their RDF quads) into a unified internal `IShape` representation.
3. **Containment Analysis**: It matches each star pattern against the shape's property constraints, cardinalities, and logic (AND, OR, NOT), returning a report on the level of containment.

## Installation

```sh
npm install query-shape-detection
# or
yarn add query-shape-detection
```

## Code examples

### SPARQL-to-SHACL Example

```ts
import { 
  generateQuery, 
  shaclShapeFromQuads, 
  solveShapeQueryContainment 
} from 'query-shape-detection';
import { Parser as SPARQLParser } from '@traqula/parser-sparql-1-1';
import { toAlgebra } from '@traqula/algebra-sparql-1-1';
import * as N3 from 'n3';

// 1. Prepare the Query
const rawQuery = `
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  SELECT ?name ?mbox WHERE {
    ?person foaf:name ?name;
            foaf:mbox ?mbox.
  }
`;
const sparqlParser = new SPARQLParser();
const query = generateQuery(toAlgebra(sparqlParser.parse(rawQuery)));

// 2. Prepare the SHACL Shape (from Turtle)
const shape = `
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix foaf: <http://xmlns.com/foaf/0.1/> .
  
  <http://example.org/PersonShape> a sh:NodeShape ;
    sh:property [ sh:path foaf:name ] ;
    sh:property [ sh:path foaf:mbox ] .
`;
const shapeQuads = new N3.Parser().parse(shape);
const personShape = await shaclShapeFromQuads(shapeQuads, "http://example.org/PersonShape");

// 3. Solve Containment
const report = solveShapeQueryContainment({
    query: query,
    shapes: [personShape],
});

// 4. Read the global result for the complete query.
console.log(report.result); // ContainmentResult.CONTAINED

// 5. Inspect how the global result was obtained by checking every query star pattern.
for (const [starPatternName, containment] of report.starPatternsContainment) {
  console.log(starPatternName);       // "person"
  console.log(containment.result);    // ContainmentResult.CONTAINED
  console.log(containment.target);    // ["http://example.org/PersonShape"]
  console.log(containment.bindings);  // Detailed predicate/dependency matches
}
```

`report.result` is the aggregate result for the complete query. It is
`CONTAINED` only when every star pattern is also `CONTAINED`; otherwise it reports the most restrictive result among the star patterns.

### Shape-to-Shape Example

You can compare a source shape against candidate target shapes directly using
`solveShapeShapeContainment`. Internally, this uses a shape-to-query translation and then reuses the existing query-to-shape containment engine.

```ts
import {
  shaclShapeFromQuads,
  solveShapeShapeContainment,
} from 'query-shape-detection';
import * as N3 from 'n3';

const sourceShapeRaw = `
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix ex: <https://www.example.org/> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

  ex:SourceShape a sh:NodeShape ;
    sh:closed true ;
    sh:property [
      sh:path ex:age ;
      sh:datatype xsd:integer ;
      sh:minInclusive 18 ;
      sh:maxInclusive 35
    ] .
`;

const targetShapeRaw = `
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix ex: <https://www.example.org/> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

  ex:TargetShape a sh:NodeShape ;
    sh:closed true ;
    sh:property [
      sh:path ex:age ;
      sh:datatype xsd:integer ;
      sh:minInclusive 10 ;
      sh:maxInclusive 40
    ] .
`;

const sourceShape = await shaclShapeFromQuads(
  new N3.Parser().parse(sourceShapeRaw),
  'https://www.example.org/SourceShape',
);
const targetShape = await shaclShapeFromQuads(
  new N3.Parser().parse(targetShapeRaw),
  'https://www.example.org/TargetShape',
);

const report = solveShapeShapeContainment({
  sourceShape,
  targetShapes: [targetShape],
});

// Read the global result for the complete source-shape/target-shape comparison.
console.log(report.result); // ContainmentResult.CONTAINED

// Inspect the individual result for every star pattern generated from the source shape.
for (const [starPatternName, containment] of report.starPatternsContainment) {
  console.log(starPatternName);
  console.log(containment.result);    // ContainmentResult.CONTAINED
  console.log(containment.target);    // ["https://www.example.org/TargetShape"]
  console.log(containment.bindings);  // Detailed predicate/dependency matches
}
```

## Containment Results

The library returns a report where each star pattern is assigned one of the following `ContainmentResult` values:

| Result             | Description |
| :----------------- | :---------- |
| **`CONTAINED`**    | Every *required* triple pattern of every star pattern, including nested ones, is matched by the shape. Unmatched `OPTIONAL` patterns do not prevent this. |
| **`ALIGNED`**      | At least one triple pattern from the root star pattern matches on an open shape. |
| **`UNALINGED`**    | Partial root star pattern match on a closed shape; or match on a nested star pattern while having no match on root star pattern. A predicate the shape declares but whose `sh:node` dependency could not be established counts as such a partial match. |
| **`WEAKLY_REJECTED`** | No triple pattern matches, and at least one candidate shape that describes the pattern is open and does not forbid the predicates involved, or no candidate shape describes it (see [Targets](#targets)). |
| **`REJECTED`**     | No triple pattern matches, and every shape that describes the pattern (at least one) either is closed or explicitly forbids a required predicate through `sh:not` or `sh:maxCount 0`. Also returned when there is no candidate shape. |

### Nested dependencies

A predicate constrained by `sh:node` is only fully bound when the nested star pattern is
bound by the referenced shape. When it is not, the outcome depends on *why*:

- the referenced shape is **closed** and does not declare what the nested pattern asks
  for, so it forbids it. The dependency is refuted, the predicate does not match, and the
  root pattern can be `REJECTED`. This is what lets a closed shape graph prune.
- the referenced shape is **open** and merely silent about it. Nothing is refuted: data
  conforming to that shape may well carry the predicate. The root predicate still matched
  the referring shape, so the root pattern is a partial match — `UNALINGED` on a closed
  referring shape, `ALIGNED` on an open one — and never `REJECTED`.

A shape reached only through `sh:node` also governs the nested star pattern it resolves,
so that pattern is classified against it even when the shape is passed as a
`dependentShapes` entry rather than a candidate. Both placements give the same
classification. This applies regardless of `decidingShapes`: role filtering chooses which
shapes may decide a resource's relevance, not which shape governs a pattern inside the
shape graph. Only references reached from a candidate count, though: a shape excluded by
`decidingShapes` lends no evidence through `sh:node` references of its own.

`OPTIONAL` triple patterns are never required for containment: a resource can answer
the query without them. The rule is the same for open and closed shapes, so adding
`sh:closed true` to a shape never raises its result.

A source shape follows the cardinality semantics of its language. In SHACL, an absent
`sh:minCount` is 0 and an absent `sh:maxCount` is unbounded, so a property constraint
without `sh:minCount` becomes an optional triple pattern. In ShEx, a triple constraint
without a cardinality occurs exactly once, so it becomes a required one.

### Targets

The SHACL targets of a shape (`IShape.targets`: `nodes`, `classes`, `subjectsOf`, `objectsOf`)
say which nodes it describes when it is used on its own. A shape that is also an
`rdfs:Class` (or an instance of a class declared a subclass of `rdfs:Class` in the shapes
graph) targets its own instances. SHACL ignores targets when a shape is reached through
`sh:node`, and so does this library, on both sides.

**Source shapes.** `shapeToQuery` translates the targets of the given shape into patterns
about its focus node:

- a class target requires `rdf:type` with the class as value, and a subjects-of target
  requires its predicate;
- node targets restrict the subject of the focus star pattern to the target nodes
  (`IStarPatternWithDependencies.subjectValues`);
- an objects-of target `p` adds a star pattern `?s p <focus>` that depends on the focus
  star pattern;
- several class and subjects-of targets become the branches of a UNION, as the branches
  of an `sh:or` do, so a resource contains the shape only when every alternative is
  covered.

Node and objects-of targets combined with other targets, or several objects-of targets,
cannot be represented: they are ignored and reported as `TARGETS` in `unsupported`, which
can only over-estimate relevance. A shape without constraints whose targets are node
targets asks for any triple about those nodes, and sets `matchesAnyTriple`.

**Candidate shapes.** A target implies constraints that the shape does not declare: a
class target implies `rdf:type` with a target class as value (matched by IRI, without
subclass reasoning), and a subjects-of target implies its predicate. They match like
declared constraints, and a closed shape does not forbid them. Since the focus nodes are
the union of the nodes of the targets, an implied constraint is only required — for
negated triple patterns — when every focus node carries it: when all the targets are
class targets, or the only target is one subjects-of target. A closed shape also allows
its `sh:ignoredProperties`. A shape whose only targets are node targets describes those
nodes and nothing else, so it cannot contain a star pattern about another constant
subject.

A shape without targets describes every star pattern, as before. A shape with targets
only constrains the nodes of its targets, so its closedness and negative constraints
count only for a star pattern whose matching nodes are all in a target: its subject is a
node target, it requires `rdf:type` with target classes only, it requires the predicate
of a subjects-of target, or it is reached through a required triple pattern whose
predicate is that of an objects-of target. For any other star pattern the shape neither
supports nor softens a rejection, and its matches count as on an open shape. A closed
shape targeting persons therefore does not reject a query about places.

### Examples of Containment Results

#### 1. `CONTAINED`

The star pattern for `?person` is fully covered by the shape.

* **Query**:

  ```sparql
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  SELECT * WHERE {
    ?person foaf:name ?name ;
            foaf:mbox ?mbox .
  }
  ```

* **Shape**:

  ```turtle
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix foaf: <http://xmlns.com/foaf/0.1/> .
  
  <http://example.org/PersonShape> a sh:NodeShape ;
    sh:property [ sh:path foaf:name ] ;
    sh:property [ sh:path foaf:mbox ] .
  ```

Another `CONTAINED` case combines a FILTER expression with compatible shape constraints.

* **Query**:

  ```sparql
  PREFIX ex: <https://www.example.ca/>
  PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

  SELECT * WHERE {
    ?person ex:age ?age .
    FILTER(?age > 18)
  }
  ```

* **Shape**:

  ```turtle
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

  <http://example.org/AgeShape> a sh:NodeShape ;
    sh:closed true ;
    sh:property [
      sh:path <https://www.example.ca/age> ;
      sh:datatype xsd:integer ;
      sh:minInclusive 18 ;
      sh:maxInclusive 35
    ] .
  ```

Containment decisions do not use runtime FILTER truth values directly.
Instead, FILTER expressions are only used when they can be checked against shape constraints. For example, a numeric comparison like `?age > 18` is compatible with an `xsd:integer` constraint, but can contradict a non-numeric datatype constraint.

#### 2. `ALIGNED`

The query matches one property (`foaf:name`), but contains `ex:age` which is not defined in the open shape.

* **Query**:

  ```sparql
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  PREFIX ex: <http://example.org/>
  SELECT * WHERE {
    ?person foaf:name ?name ;
            ex:age ?age .
  }
  ```

* **Shape**:

  ```turtle
  <http://example.org/PersonShape> a sh:NodeShape ;
    sh:property [ sh:path foaf:name ] .
  ```

Another `ALIGNED` case with FILTER and constraints:

* **Query**:

  ```sparql
  PREFIX ex: <https://www.example.ca/>
  PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
  SELECT * WHERE {
    ?person ex:age ?age ;
            ex:nickname ?nick .
    FILTER(?age > 18)
  }
  ```

* **Shape**:

  ```turtle
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

  <http://example.org/OpenAdultShape> a sh:NodeShape ;
    sh:property [
      sh:path <https://www.example.ca/age> ;
      sh:datatype xsd:integer
    ] .
  ```

`ex:age` aligns and the numeric FILTER is compatible with the datatype constraint, while `ex:nickname` is not constrained by this open shape.

#### 3. `UNALINGED`

The root star pattern has partial matching triples against closed shapes.

* **Query**:

  ```sparql
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  PREFIX ex: <http://example.org/>
  SELECT * WHERE {
    ?person foaf:name ?name ;
            ex:age ?age .
  }
  ```

* **Shape**:

  ```turtle
  <http://example.org/PersonShape> a sh:NodeShape ;
    sh:closed true ;
    sh:property [ sh:path foaf:name ] .
  ```

Another `UNALINGED` case is when the root star pattern does not match, but a nested star pattern (reachable through a linked variable) does on a open or closed shape.

* **Query**:

  ```sparql
  PREFIX ex: <http://example.org/>
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  SELECT * WHERE {
    ?person ex:unknownLink ?friend .
    ?friend foaf:name ?friendName .
  }
  ```

* **Shape**:

  ```turtle
  <http://example.org/PersonShape> a sh:NodeShape ;
    sh:property [
      sh:path foaf:knows ;
      sh:node <http://example.org/FriendShape>
    ] .

  <http://example.org/FriendShape> a sh:NodeShape ;
    sh:property [ sh:path foaf:name ] .
  ```

Another `UNALINGED` case occurs when the root pattern does not match, but an
optional nested star pattern reachable through a linked variable does.

* **Query**:

  ```sparql
  PREFIX ex: <http://example.org/>
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  SELECT * WHERE {
    ?person ex:unknownLink ?friend .
    OPTIONAL {
      ?friend foaf:name ?friendName .
    }
  }
  ```

* **Shape**:

  ```turtle
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix ex: <http://example.org/> .

  ex:PersonShape a sh:NodeShape ;
    sh:closed true ;
    sh:property [
      sh:path ex:knows ;
      sh:node ex:FriendShape
    ] .

  ex:FriendShape a sh:NodeShape ;
    sh:closed true ;
    sh:property [ sh:path foaf:name ] .
  ```

The required root `ex:unknownLink` pattern does not match the shape, but the
optional nested `foaf:name` pattern matches `ex:FriendShape`. The root result is
therefore `UNALINGED` because only a nested star pattern is aligned.

#### 4. `WEAKLY_REJECTED`

No triple pattern matches and at least one candidate shape is open.

* **Query**:

  ```sparql
  PREFIX schema: <http://schema.org/>
  SELECT * WHERE {
    ?person schema:birthDate ?date .
  }
  ```

* **Shape**:

  ```turtle
  <http://example.org/PersonShape> a sh:NodeShape ;
    sh:property [ sh:path foaf:name ] .
  ```

Another `WEAKLY_REJECTED` case has only optional predicates, none of which are
defined by an open shape:

* **Query**:

  ```sparql
  PREFIX ex: <http://example.org/>
  SELECT * WHERE {
    OPTIONAL {
      ?person ex:email ?email ;
              ex:phone ?phone .
    }
  }
  ```

* **Shape**:

  ```turtle
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix ex: <http://example.org/> .

  ex:PersonShape a sh:NodeShape ;
    sh:property [
      sh:path ex:name
    ] .
  ```

Neither optional predicate is defined by the open shape, so no triple pattern
matches. Because the shape is open, the result is `WEAKLY_REJECTED` rather than
`REJECTED`.

#### 5. `REJECTED`

The query uses `schema:birthDate`, but the closed shape only defines `foaf:name`.

* **Query**:

  ```sparql
  PREFIX schema: <http://schema.org/>
  SELECT * WHERE {
    ?person schema:birthDate ?date .
  }
  ```

* **Shape**:

  ```turtle
  <http://example.org/PersonShape> a sh:NodeShape ;
    sh:closed true ;
    sh:property [ sh:path foaf:name ] .
  ```

Another `REJECTED` case with FILTER and constraints:

* **Query**:

  ```sparql
  PREFIX ex: <https://www.example.ca/>
  SELECT * WHERE {
    ?person ex:age ?age .
    FILTER(?age > 18)
  }
  ```

* **Shape**:

  ```turtle
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

  <http://example.org/ClosedStringAgeShape> a sh:NodeShape ;
    sh:closed true ;
    sh:property [
      sh:path <https://www.example.ca/age> ;
      sh:datatype xsd:string
    ] .
  ```

The same numeric FILTER/constraint contradiction on a closed shape yields `REJECTED`.

Another `REJECTED` case due to min/max value constraints:

* **Query**:

  ```sparql
  PREFIX ex: <https://www.example.ca/>
  SELECT * WHERE {
    ?person ex:age ?age .
    FILTER(?age > 35)
  }
  ```

* **Shape**:

  ```turtle
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

  <http://example.org/ClosedAdultRangeShape> a sh:NodeShape ;
    sh:closed true ;
    sh:property [
      sh:path <https://www.example.ca/age> ;
      sh:datatype xsd:integer ;
      sh:minInclusive 18 ;
      sh:maxInclusive 35
    ] .
  ```

The FILTER range (`> 35`) conflicts with the shape range (`18..35`), so the result is `REJECTED`.

## Solver options and report fields

`solveShapeQueryContainment` accepts, besides `query` and `shapes`:

| Option | Meaning |
| :----- | :------ |
| `dependentShapes` | Shapes that are not candidates themselves but are referenced by `sh:node` from a candidate. They are needed to resolve those references: an unresolvable `sh:node` cannot be refuted and is treated as satisfied, so omitting them over-estimates relevance. |
| `decidingShapes` | Restricts which shapes in `shapes` are candidates. The others are treated as `dependentShapes`: they still resolve `sh:node` references from the candidates, but never classify a star pattern themselves, lend evidence through `sh:node` references of their own, or receive a visit indication. Use it to apply an external eligibility rule, such as the input/output role filtering defined by the discovery specification. |

The report carries:

| Field | Meaning |
| :---- | :------ |
| `result` | The aggregate result for the complete query (see above). |
| `starPatternsContainment` | Per star pattern: its result, the matching shape IRIs, and the predicate-level bindings. |
| `visitShapeBoundedResource` | Per shape: whether at least one triple pattern bound to it. Independent of `result`, and usable to decide whether to retrieve the data behind a shape. |
| `unsupported` | Constructs discarded during normalization, if any, including the targets of a source shape that could not be translated (`TARGETS`). |

## SPARQL Limitations

The detection logic is focused on **Triple Patterns** and **Star Patterns**. Currently, the following SPARQL features are not (yet) supported:

- **Filter Expressions**: FILTERs are only used to detect contradictions with shape constraints (for example numeric comparisons against non-numeric datatype constraints). Expressions that cannot be safely compared to shape constraints are conservatively ignored for containment decisions.
- **Negative Patterns**: `MINUS` and `FILTER NOT EXISTS` are only supported over a single triple pattern, as negated triple patterns (see above). Any other form is discarded: its triple patterns describe solutions to exclude, not data the resource must hold, so collecting them as ordinary patterns would move the result in both directions.
- **Existence Tests**: Any other `EXISTS` or `NOT EXISTS` stays in its `FILTER` but is undecidable, so it never causes a rejection; the rest of the expression is still evaluated. It is reported as discarded.
- **Complex Property Paths**: While simple paths are supported, complex or recursive property paths are not considered yet.
- **Aggregates & Subqueries**: `GROUP BY`, `HAVING`, and subqueries are not processed.
- **Federated Queries**: `SERVICE` clauses are discarded, since they read data from another endpoint.

Discarding a construct removes constraints, so the result can over-estimate relevance
but never ranks a relevant resource lower than it would otherwise be. Whatever was
discarded is listed on `query.unsupported` and echoed on `report.unsupported`.

### Queries with no usable triple pattern

An unrestricted triple pattern (`?s ?p ?o`) yields no star pattern, because shapes
constrain named predicates. It still asks for every triple of the resource, so such a
query is `CONTAINED` by any shape, every shape is marked visitable, and
`query.matchesAnyTriple` is set.

A query with no triple pattern at all — an empty `WHERE`, a body of only `VALUES` or
`FILTER`, or one left empty after discarding — never asks the resource for data, so no
relevance degree applies. `solveShapeQueryContainment` throws `EmptyQueryError` rather
than reporting `CONTAINED` for it.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for more information.

