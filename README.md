# query-shape-matching-algorithm
[![npm version](https://badge.fury.io/js/query-shape-matching.svg)](https://www.npmjs.com/package/query-shape-matching)

Reference implementation for the query/shape matching algorithm described in the discovery specification.

It is implemented as a Node.js library to calculate the containment (subsumption) between [SPARQL queries](https://www.w3.org/TR/sparql11-query/) and [RDF data shapes](https://www.w3.org/groups/wg/data-shapes/) (ShEx and SHACL) at the star pattern level.

## Features

- **Support for different shape formats**: Supports both **ShEx** (Shape Expressions) and **SHACL** (Shapes Constraint Language).
- **Star Pattern Decomposition**: Breaks down complex SPARQL queries into star patterns (groups of triple patterns sharing the same subject).
- **Alignment Detection**: Identifies how closely a query matches the constraints defined in a shape.
- **Dependency Tracking**: Handles links between shapes, detecting when a star pattern depends on another to be fully bounded.

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

## Example Code

### Simple SHACL Example

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

console.log(report.starPatternsContainment.get("person"));
```

### Simple ShEx Example

```ts
import { shexShapeFromQuads } from 'query-shape-detection';

// Parsing a ShEx shape follows the same pattern
const shexQuads = /* RDF quads from ShEx definition */;
const personShape = await shexShapeFromQuads(shexQuads, "http://example.org/PersonShape");
```

## Containment Results

The library returns a report where each star pattern is assigned one of the following `ContainmentResult` values:

| Result             | Description |
| :----------------- | :---------- |
| **`CONTAINED`**    | All query star patterns, including nested ones, are matched by the shape. |
| **`ALIGNED`**      | At least one triple pattern from the root star pattern matches on an open shape. |
| **`UNALINGED`**    | Partial root star pattern match on a closed shape; or match on a nested star pattern while having no match on root star pattern. |
| **`WEAKLY_REJECTED`** | None of the triple patterns match on an open shape. |
| **`REJECTED`**     | None of the triple patterns match on a closed shape. |

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
Instead, FILTER expressions are only used when they can be checked against shape constraints.
For example, a numeric comparison like `?age > 18` is compatible with an `xsd:integer` constraint,
but can contradict a non-numeric datatype constraint.

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

Another `UNALINGED` case with FILTER and constraints:

* **Query**:

  ```sparql
  PREFIX ex: <https://www.example.ca/>
  PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
  SELECT * WHERE {
    ?person ex:age ?age ;
            ex:status ?status .
    FILTER(?age > 18)
  }
  ```

* **Shape**:

  ```turtle
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

  <http://example.org/ClosedAgeShape> a sh:NodeShape ;
    sh:closed true ;
    sh:property [
      sh:path <https://www.example.ca/age> ;
      sh:datatype xsd:integer
    ] .
  ```

On a closed shape, `ex:age` matches but `ex:status` does not, so containment is partial (`UNALINGED`) even though the FILTER is constraint-compatible.

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

Another `WEAKLY_REJECTED` case with FILTER and constraints:

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

  <http://example.org/OpenStringAgeShape> a sh:NodeShape ;
    sh:property [
      sh:path <https://www.example.ca/age> ;
      sh:datatype xsd:string
    ] .
  ```

The numeric FILTER contradicts the string datatype constraint. Because the shape is open, the result is `WEAKLY_REJECTED`.

#### 5. `REJECTED`

The query uses `schema:birthDate`, but the shape only defines `foaf:name`.

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

## SPARQL Limitations

The detection logic is focused on **Triple Patterns** and **Star Patterns**. Currently, the following SPARQL features are not (yet) supported:

- **Filter Expressions**: FILTERs are only used to detect contradictions with shape constraints (for example numeric comparisons against non-numeric datatype constraints). Expressions that cannot be safely compared to shape constraints are conservatively ignored for containment decisions.
- **Negative Patterns**: `MINUS` and `FILTER NOT EXISTS` are not used to determine containment.
- **Complex Property Paths**: While simple paths are supported, complex or recursive property paths are not considered yet.
- **Aggregates & Subqueries**: `GROUP BY`, `HAVING`, and subqueries are not processed.
- **Federated Queries**: `SERVICE` clauses are currently ignored.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for more information.

