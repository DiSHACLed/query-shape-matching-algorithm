# query-shape-matching-algorithm
[![npm version](https://badge.fury.io/js/query-shape-detection.svg)](https://www.npmjs.com/package/query-shape-detection)

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

| Result         | Description                                                  |
| :------------- | :----------------------------------------------------------- |
| **`CONTAIN`**  | All triple patterns in the graph star pattern are covered by the shape's constraints. |
| **`ALIGNED`**  | At least one triple pattern matches, but some parts of the graph star pattern are not covered. |
| **`DEPEND`**   | The pattern is reachable via a property that links to another shape (nested containment). |
| **`REJECTED`** | No part of the star pattern matches any property defined in the shape. |

### Examples of Containment Results

#### 1. `CONTAIN`

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

#### 2. `ALIGNED`

The query matches one property (`foaf:name`), but contains `ex:age` which is not defined in the closed shape.

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

#### 3. `DEPEND`

The `?person` pattern matches the shape's link to another shape. Its full containment depends on whether `?friend` also matches its shape.

* **Query**:

  ```sparql
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  SELECT * WHERE {
    ?person foaf:knows ?friend . 
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

#### 4. `REJECTED`

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
    sh:property [ sh:path foaf:name ] .
  ```

## SPARQL Limitations

The detection logic is focused on **Triple Patterns** and **Star Patterns**. Currently, the following SPARQL features are not (yet) supported:

- **Filter Expressions**: Logic inside `FILTER` clauses is not checked against shape constraints.
- **Negative Patterns**: `MINUS` and `FILTER NOT EXISTS` are not used to determine containment.
- **Complex Property Paths**: While simple paths are supported, complex or recursive property paths are not considered yet.
- **Aggregates & Subqueries**: `GROUP BY`, `HAVING`, and subqueries are not processed.
- **Federated Queries**: `SERVICE` clauses are currently ignored.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for more information.

