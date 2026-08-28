1. [VALUES](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) / [FILTER IN](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) vs `sh:in`

- SPARQL side: explicit finite allowed values.
- SHACL side: enumeration constraint.
- This is a very natural implication check: query allowed-set should be compatible with shape allowed-set.

2. Constant object patterns vs `sh:hasValue`

- SPARQL: [?s ex:p ex:Foo](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) or [?s ex:p "x"](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html).
- SHACL: property must contain a specific value.
- This is stricter than plain datatype/class matching and often easier to reason about.

3. [FILTER(?x = ?y)](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) / `sameTerm` vs cross-property equality constraints

- SHACL has [sh:equals](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html).
- This compares relational constraints between two properties, not just one property in isolation.

4. [FILTER(?x != ?y)](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) or exclusion sets vs `sh:disjoint`

- Similar idea, but for incompatibility between two properties.

5. Numeric comparisons vs `sh:lessThan` / `sh:lessThanOrEquals`

- These are cross-property numeric/order constraints.
- They matter when the query relates two variables rather than constraining one value against a constant.

6. [FILTER isIRI / isLiteral / isBlank](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) vs `sh:nodeKind`

- This is a clean semantic pairing:
  - `isIRI` ↔ IRI node kind
  - `isLiteral` ↔ literal node kind
  - `isBlank` ↔ blank node kind
- This would strengthen class/datatype reasoning substantially.

7. String functions vs string facets

- SPARQL: `STRSTARTS`, `STRENDS`, `CONTAINS`, `LCASE/UCASE`, `STRLEN`
- SHACL: `sh:minLength`, `sh:maxLength`, [sh:pattern](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html), `sh:languageIn`, `sh:uniqueLang`
- Some implications are straightforward, others need conservative reasoning.

8. Language filters vs `sh:languageIn`

- SPARQL: `lang(?x) = "en"` or `langMatches(...)`
- SHACL: language whitelist.
- This is one of the clearest missing literal-comparison axes.

9. Property-path structure vs SHACL path structure

- SPARQL already has sequence, inverse, alternative, cardinality paths in [query.ts](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html).
- SHACL also has richer path forms.
- Comparing just the terminal predicate is weaker than comparing actual path semantics.

10. `OPTIONAL` vs relaxed cardinality / optionality

- A query optional triple is not the same as a shape optional property, but there is a real compatibility relation there.
- Especially useful when deciding contained vs merely aligned.

11. [UNION](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) / branch structure vs [sh:or](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html), [sh:xone](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html), `sh:and`

- [or](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) is already the obvious pairing.
- [xone](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) and `and` could be reasoned about more precisely than “best-effort branch compatibility”.

12. Negation constructs vs negative shape constraints

- SPARQL: [FILTER NOT EXISTS](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html), `MINUS`, negated property sets
- SHACL: [sh:not](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html), forbidden properties, disjointness-style constraints
- This is harder, but it is the real way to represent absence constraints rather than dropping them in [shapeToQuery](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html).

13. Closed shape semantics vs query predicate completeness

- SHACL [closed=true](vscode-file://vscode-app/usr/share/code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) says extra predicates are disallowed.
- On the query side, you can ask whether the query’s mentioned predicates are exhaustive or only partial.
- This matters for containment classification, not just local predicate matching.

14. Conditional existence vs qualified constraints

- SPARQL can express “if there exists X then ...” via `EXISTS`/`NOT EXISTS`.
- SHACL has `qualifiedValueShape`, `qualifiedMinCount`, `qualifiedMaxCount`.
- This is a strong next step for nested-shape reasoning.

15. Count-like query structure vs cardinality families

- Even without full aggregates, repeated triple patterns and path multiplicities can sometimes imply minimum multiplicity.
- SHACL cardinalities could be compared against that more aggressively.