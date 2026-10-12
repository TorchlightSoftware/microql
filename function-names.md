# MicroQL core — function names by file

Every named function in core: `function` declarations, `const` function values, object properties (util resources, store methods) and class methods. Anonymous inline callbacks are not listed.

- **lines** — length of the definition
- **refs** — identifiers naming the function in core: in its own file, plus in files that import it, leaving out its declaration, import and export lists, property keys and member names. 0 means public API used only by callers outside core (tests, hosts). Properties and methods are dispatched by name at run time, so they get no count. Names are matched textually, so a parameter that shadows a function is counted too.
- **0.6** — 0.6.6 core (`836d9bf`) also defined a function by this name

The tables below are generated. Regenerate them with `npm run docs:functions` after changing core; it rewrites only the text between the `generated:function-names` markers, so edit this introduction freely.

<!-- generated:function-names -->
## addresses.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 21 | `fieldPathOf` | const | 2 | 1 |  |
| 25 | `addressToPath` | function | 11 | 0 |  |
| 37 | `startsWith` | const | 1 | 2 |  |
| 40 | `withField` | const | 1 | 2 |  |
| 44 | `pathToAddress` | function | 12 | 0 |  |

## common.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 14 | `getServiceColorName` | const | 6 | 1 | ✓ |
| 23 | `isPlainObject` | const | 5 | 14 |  |
| 33 | `mapValues` | const | 5 | 12 |  |
| 40 | `filterObject` | const | 2 | 2 |  |
| 44 | `pick` | const | 2 | 6 | ✓ |
| 47 | `omit` | const | 1 | 5 |  |
| 50 | `getIn` | const | 1 | 10 |  |
| 54 | `setIn` | const | 4 | 3 |  |
| 60 | `omitIn` | const | 4 | 2 |  |
| 68 | `parseFieldPath` | const | 5 | 4 |  |
| 75 | `setPaths` | const | 2 | 4 |  |
| 79 | `defaults` | const | 9 | 3 |  |

## compile.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 39 | `fail` | const | 3 | 24 |  |
| 44 | `isChain` | const | 2 | 3 | ✓ |
| 50 | `parseDescriptor` | function | 16 | 1 |  |
| 67 | `isService` | const | 1 | 1 |  |
| 72 | `lookupOperation` | function | 15 | 1 |  |
| 89 | `declarationAt` | function | 7 | 1 |  |
| 98 | `targetField` | function | 4 | 1 |  |
| 104 | `parseSchemaAt` | function | 7 | 2 |  |
| 114 | `compileValidators` | const | 16 | 1 | ✓ |
| 133 | `compileSettings` | const | 7 | 1 | ✓ |
| 143 | `checkReferences` | function | 16 | 1 |  |
| 145 | `check` | const | 11 | 3 |  |
| 160 | `parseWithSite` | function | 7 | 2 |  |
| 168 | `checkReference` | function | 8 | 1 |  |
| 178 | `declareBinding` | function | 8 | 1 |  |
| 189 | `sitesAt` | const | 4 | 3 |  |
| 197 | `compileSteps` | function | 6 | 3 |  |
| 209 | `compilePosition` | function | 22 | 1 |  |
| 234 | `positionFields` | function | 13 | 1 |  |
| 249 | `compileCall` | function | 44 | 1 |  |
| 294 | `compilePhase` | function | 9 | 1 |  |
| 305 | `compileGlobalOnError` | function | 4 | 1 |  |
| 311 | `compileSelect` | function | 10 | 1 |  |
| 326 | `compile` | function | 32 | 2 | ✓ |

## concurrency.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 10 | `concurrencyLimit` | function | 27 | 1 |  |
| 14 | `acquire` | const | 7 | 1 |  |
| 22 | `release` | const | 5 | 1 |  |

## declaration.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 41 | `checkSource` | function | 12 | 2 |  |
| 55 | `readTag` | function | 8 | 2 |  |
| 65 | `readField` | function | 14 | 1 |  |
| 67 | `named` | const | 1 | 6 |  |
| 80 | `isPrefix` | const | 1 | 1 |  |
| 85 | `inputSchemaOf` | function | 21 | 1 |  |
| 98 | `toSchema` | const | 6 | 2 |  |
| 107 | `readOutput` | function | 5 | 1 |  |
| 113 | `readDeclaration` | function | 15 | 1 |  |
| 136 | `declarationOf` | function | 4 | 1 |  |

## execute.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 29 | `initServices` | function | 8 | 1 |  |
| 39 | `callTearDown` | function | 12 | 1 | ✓ |
| 53 | `runSteps` | function | 7 | 2 |  |
| 62 | `runPosition` | function | 3 | 2 |  |
| 68 | `invoke` | function | 7 | 1 |  |
| 78 | `settle` | function | 3 | 2 |  |
| 85 | `abortion` | function | 8 | 1 |  |
| 94 | `isAbort` | const | 1 | 2 |  |
| 97 | `inFlightIn` | const | 1 | 1 |  |
| 101 | `report` | function | 7 | 1 |  |
| 112 | `resultHashes` | function | 5 | 1 |  |
| 121 | `runPhase` | function | 19 | 1 |  |
| 123 | `reportPhase` | const | 2 | 4 |  |
| 125 | `duration` | const | 1 | 3 |  |
| 142 | `targetPhase` | function | 7 | 1 |  |
| 153 | `scopeOfRun` | function | 8 | 1 |  |
| 154 | `rerun` | property | 1 | — |  |
| 158 | `rerun` | property | 1 | — |  |
| 163 | `handleGlobalError` | function | 11 | 1 |  |
| 177 | `checkRunInputs` | function | 10 | 1 |  |
| 197 | `execute` | function | 46 | 1 | ✓ |
| 218 | `runPosition` | property | 1 | — |  |

## forms.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 29 | `canonical` | function | 3 | 3 |  |
| 33 | `canonicalValue` | function | 14 | 4 |  |
| 50 | `hashOf` | const | 1 | 5 |  |
| 53 | `referenceForm` | function | 7 | 1 |  |
| 62 | `argumentsForm` | const | 1 | 1 |  |
| 65 | `stepsForm` | function | 9 | 3 |  |
| 78 | `callForm` | function | 21 | 1 |  |
| 104 | `formsOf` | function | 15 | 2 |  |

## graph.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 10 | `columnsOf` | function | 19 | 3 |  |
| 31 | `upstreamOf` | function | 10 | 1 |  |
| 33 | `visit` | const | 5 | 2 |  |

## index.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 29 | `readJson` | const | 8 | 3 |  |
| 39 | `filesIn` | const | 8 | 3 |  |
| 48 | `isExpired` | const | 1 | 1 |  |
| 51 | `sweep` | function | 8 | 1 |  |
| 62 | `fileStore` | function | 27 | 1 |  |
| 63 | `fileOf` | const | 1 | 2 |  |
| 65 | `ready` | const | 1 | 4 |  |
| 69 | `get` | property | 4 | — | ✓ |
| 73 | `set` | property | 5 | — |  |
| 78 | `list` | property | 5 | — |  |
| 84 | `clear` | property | 3 | — |  |
| 90 | `print` | function | 5 | 1 | ✓ |
| 96 | `recordFailure` | function | 6 | 1 | ✓ |
| 112 | `query` | function | 3 | 0 | ✓ |

## plan.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 24 | `typeOfArgument` | function | 10 | 3 |  |
| 38 | `fromZod` | property | 1 | — |  |
| 39 | `fromField` | property | 1 | — |  |
| 40 | `fromList` | property | 1 | — |  |
| 41 | `fromObject` | property | 1 | — |  |
| 42 | `toList` | property | 1 | — |  |
| 43 | `toObject` | property | 1 | — |  |
| 47 | `resolveSource` | function | 5 | 5 |  |
| 55 | `type-mismatch` | property | 1 | — |  |
| 56 | `maybe-missing` | property | 1 | — |  |
| 57 | `type-narrowing` | property | 1 | — |  |
| 63 | `checkType` | function | 6 | 2 |  |
| 70 | `stepsTypes` | function | 5 | 2 |  |
| 79 | `fieldsOf` | function | 14 | 1 |  |
| 82 | `declared` | const | 1 | 3 |  |
| 84 | `typeOf` | const | 6 | 2 |  |
| 90 | `expectedOf` | const | 1 | 1 |  |
| 96 | `argumentTypes` | function | 7 | 1 |  |
| 107 | `positionTypes` | function | 10 | 1 |  |
| 119 | `returnType` | const | 2 | 1 |  |
| 123 | `callTypes` | function | 8 | 1 |  |
| 135 | `triggerType` | const | 2 | 1 |  |
| 138 | `inferTypes` | function | 12 | 1 |  |
| 156 | `plan` | function | 35 | 0 |  |

## query.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 14 | `applySelection` | function | 5 | 1 | ✓ |
| 26 | `query` | function | 5 | 1 | ✓ |

## ratelimit.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 1 | `timeoutPromise` | const | 1 | 1 | ✓ |
| 4 | `constructor` | method | 5 | — | ✓ |
| 9 | `push` | method | 13 | — | ✓ |
| 22 | `_call` | method | 9 | — | ✓ |

## reference.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 35 | `isReference` | const | 2 | 4 |  |
| 41 | `mapReferences` | const | 6 | 4 |  |
| 49 | `malformation` | const | 8 | 1 |  |
| 58 | `pathOf` | const | 7 | 2 |  |
| 68 | `parseReference` | function | 11 | 4 |  |
| 86 | `enterPosition` | const | 5 | 4 |  |
| 93 | `scopedRoot` | const | 4 | 3 |  |
| 99 | `resolveReference` | function | 4 | 2 |  |

## runtime.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 18 | `memoryStore` | function | 20 | 1 |  |
| 21 | `get` | property | 3 | — | ✓ |
| 24 | `set` | property | 4 | — |  |
| 28 | `list` | property | 3 | — |  |
| 32 | `clear` | property | 4 | — |  |

## service-table.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 15 | `isOperation` | const | 1 | 1 |  |
| 19 | `operationOf` | function | 4 | 1 |  |
| 21 | `call` | property | 1 | — |  |
| 25 | `operationsByResource` | function | 8 | 1 |  |
| 34 | `verbsOf` | const | 1 | 2 |  |
| 40 | `serviceFromTable` | function | 23 | 1 |  |
| 42 | `name` | const | 1 | 3 |  |
| 44 | `lookup` | function | 11 | 1 |  |
| 58 | `operations` | property | 1 | — |  |
| 59 | `init` | property | 1 | — |  |
| 60 | `tearDown` | property | 1 | — |  |

## services/util.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 15 | `isFailure` | const | 1 | 3 |  |
| 16 | `successes` | const | 1 | 4 |  |
| 19 | `filterHidden` | const | 9 | 2 | ✓ |
| 31 | `copyPlain` | const | 2 | 5 |  |
| 35 | `union` | function | 10 | 1 |  |
| 49 | `mergeValues` | function | 9 | 2 |  |
| 59 | `truncate` | const | 2 | 1 | ✓ |
| 66 | `typed` | const | 1 | 27 |  |
| 77 | `eachItem` | function | 5 | 2 |  |
| 89 | `init` | property | 3 | — |  |
| 104 | `call` | property | 1 | — |  |
| 115 | `call` | property | 5 | — |  |
| 126 | `call` | property | 1 | — |  |
| 133 | `call` | property | 1 | — |  |
| 140 | `call` | property | 1 | — |  |
| 147 | `call` | property | 1 | — |  |
| 154 | `call` | property | 1 | — |  |
| 159 | `call` | property | 1 | — |  |
| 165 | `call` | property | 1 | — |  |
| 172 | `call` | property | 1 | — |  |
| 179 | `call` | property | 1 | — |  |
| 185 | `call` | property | 1 | — |  |
| 191 | `call` | property | 1 | — |  |
| 198 | `call` | property | 1 | — |  |
| 205 | `call` | property | 1 | — |  |
| 212 | `call` | property | 7 | — |  |
| 228 | `call` | property | 11 | — |  |
| 244 | `call` | property | 1 | — |  |

## types.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 28 | `unwrap` | const | 1 | 7 |  |
| 30 | `typeOf` | const | 1 | 2 |  |
| 32 | `isAny` | const | 1 | 3 |  |
| 35 | `mayBeMissing` | const | 1 | 5 |  |
| 37 | `enumValues` | const | 1 | 3 |  |
| 40 | `isAbsent` | const | 1 | 1 |  |
| 46 | `describeSchema` | function | 17 | 16 |  |
| 65 | `sharedSchema` | function | 4 | 3 |  |
| 71 | `schemaOfValue` | function | 9 | 5 |  |
| 82 | `elementOf` | function | 4 | 1 |  |
| 89 | `valueOf` | function | 8 | 1 |  |
| 99 | `schemaAtPath` | function | 9 | 3 |  |
| 110 | `severityOf` | const | 1 | 3 |  |
| 112 | `issue` | const | 1 | 15 |  |
| 116 | `baseTypeOf` | function | 6 | 3 |  |
| 125 | `compareFields` | function | 12 | 1 |  |
| 140 | `array` | property | 3 | — |  |
| 143 | `object` | property | 3 | — |  |
| 146 | `record` | property | 7 | — |  |
| 153 | `enum` | property | 6 | — |  |
| 159 | `literal` | property | 4 | — |  |
| 166 | `compareToUnion` | function | 4 | 1 |  |
| 176 | `compare` | function | 13 | 8 |  |

## validation.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 47 | `showAsJson` | const | 1 | 1 |  |
| 54 | `pathText` | const | 2 | 1 |  |
| 57 | `formatError` | function | 26 | 1 | ✓ |
| 87 | `validate` | function | 10 | 3 | ✓ |
| 103 | `parseSchema` | function | 10 | 2 | ✓ |
| 114 | `parseSchemaRecursive` | function | 116 | 7 | ✓ |
| 231 | `applyModifiers` | function | 16 | 8 | ✓ |
| 248 | `transformObjectShape` | const | 1 | 2 | ✓ |

## wrappers.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 26 | `labelOf` | const | 1 | 5 |  |
| 30 | `resolveArgs` | const | 2 | 2 |  |
| 35 | `withArgs` | const | 15 | 1 | ✓ |
| 51 | `withDebug` | const | 12 | 1 | ✓ |
| 55 | `show` | const | 1 | 3 |  |
| 65 | `labelError` | function | 8 | 1 |  |
| 76 | `recover` | function | 21 | 1 |  |
| 98 | `withErrorHandling` | const | 10 | 1 | ✓ |
| 111 | `withRunState` | const | 14 | 1 |  |
| 126 | `recordResult` | function | 14 | 1 |  |
| 141 | `parseTimeUnit` | const | 7 | 1 | ✓ |
| 154 | `withCache` | const | 15 | 1 | ✓ |
| 172 | `check` | function | 13 | 2 |  |
| 173 | `show` | const | 1 | 3 |  |
| 186 | `withPrecheck` | const | 4 | 1 |  |
| 191 | `withPostcheck` | const | 5 | 1 |  |
| 197 | `hasChecks` | const | 1 | 2 |  |
| 199 | `withRateLimit` | const | 2 | 1 | ✓ |
| 202 | `withConcurrency` | const | 2 | 1 |  |
| 205 | `withRetry` | const | 13 | 1 | ✓ |
| 219 | `withTimeout` | const | 12 | 1 | ✓ |
| 234 | `servicePositions` | const | 1 | 2 |  |
| 239 | `holdsCalls` | const | 1 | 2 |  |
| 242 | `wrappersFor` | function | 16 | 1 |  |
| 260 | `wrap` | function | 4 | 1 |  |
| 261 | `operation` | const | 1 | 1 |  |
<!-- /generated:function-names -->
