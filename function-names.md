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
| 23 | `isPlainObject` | const | 5 | 17 |  |
| 33 | `mapValues` | const | 5 | 13 |  |
| 40 | `filterObject` | const | 2 | 1 |  |
| 44 | `pick` | const | 2 | 6 | ✓ |
| 47 | `omit` | const | 1 | 5 |  |
| 50 | `getIn` | const | 1 | 11 |  |
| 54 | `setIn` | const | 4 | 3 |  |
| 60 | `omitIn` | const | 4 | 2 |  |
| 68 | `parseFieldPath` | const | 5 | 5 |  |
| 75 | `setPaths` | const | 2 | 4 |  |
| 79 | `defaults` | const | 9 | 4 |  |

## compile.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 42 | `lettersOf` | const | 4 | 1 |  |
| 56 | `checkRetired` | function | 4 | 2 |  |
| 63 | `fail` | const | 3 | 26 |  |
| 68 | `isChain` | const | 2 | 3 | ✓ |
| 74 | `parseDescriptor` | function | 16 | 1 |  |
| 91 | `isService` | const | 1 | 1 |  |
| 96 | `lookupOperation` | function | 15 | 1 |  |
| 113 | `declarationAt` | function | 7 | 1 |  |
| 122 | `targetField` | function | 4 | 1 |  |
| 128 | `parseSchemaAt` | function | 7 | 2 |  |
| 138 | `compileValidators` | const | 16 | 1 | ✓ |
| 157 | `compileSettings` | const | 7 | 1 | ✓ |
| 167 | `checkReferences` | function | 18 | 1 |  |
| 170 | `check` | const | 12 | 3 |  |
| 187 | `uniqueReads` | const | 1 | 2 |  |
| 189 | `parseWithSite` | function | 7 | 2 |  |
| 197 | `checkReference` | function | 8 | 1 |  |
| 207 | `declareBinding` | function | 8 | 1 |  |
| 218 | `sitesAt` | const | 4 | 3 |  |
| 226 | `compileSteps` | function | 6 | 3 |  |
| 238 | `compilePosition` | function | 20 | 1 |  |
| 261 | `positionFields` | function | 13 | 1 |  |
| 276 | `compileCall` | function | 53 | 1 |  |
| 330 | `compilePhase` | function | 9 | 1 |  |
| 341 | `compileGlobalCatch` | function | 4 | 1 |  |
| 347 | `compileSelect` | function | 10 | 1 |  |
| 362 | `compile` | function | 33 | 2 | ✓ |

## concurrency.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 10 | `concurrencyLimit` | function | 27 | 1 |  |
| 14 | `acquire` | const | 7 | 1 |  |
| 22 | `release` | const | 5 | 1 |  |

## declaration.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 55 | `fits` | property | 1 | — |  |
| 56 | `fits` | property | 1 | — |  |
| 57 | `fits` | property | 1 | — |  |
| 58 | `fits` | property | 1 | — |  |
| 77 | `checkSource` | function | 10 | 3 |  |
| 90 | `readType` | function | 8 | 1 |  |
| 100 | `readTag` | function | 8 | 2 |  |
| 110 | `readField` | function | 14 | 1 |  |
| 112 | `named` | const | 1 | 6 |  |
| 125 | `isPrefix` | const | 1 | 1 |  |
| 130 | `inputSchemaOf` | function | 21 | 1 |  |
| 143 | `toSchema` | const | 6 | 2 |  |
| 152 | `readOutput` | function | 5 | 1 |  |
| 158 | `readDeclaration` | function | 15 | 1 |  |
| 181 | `declarationOf` | function | 4 | 1 |  |

## define-service.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 16 | `isOperation` | const | 1 | 1 |  |
| 20 | `operationOf` | function | 4 | 1 |  |
| 22 | `call` | property | 1 | — |  |
| 26 | `operationsByResource` | function | 8 | 1 |  |
| 35 | `verbsOf` | const | 1 | 2 |  |
| 41 | `defineService` | function | 24 | 1 |  |
| 43 | `name` | const | 1 | 3 |  |
| 45 | `lookup` | function | 11 | 1 |  |
| 59 | `operations` | property | 1 | — |  |
| 61 | `init` | property | 1 | — |  |
| 62 | `tearDown` | property | 1 | — |  |

## errors.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 24 | `isErrorData` | const | 1 | 6 |  |
| 28 | `toErrorData` | function | 6 | 3 |  |
| 37 | `fromErrorData` | function | 4 | 2 |  |

## execute.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 33 | `initServices` | function | 8 | 1 |  |
| 43 | `callTearDown` | function | 12 | 1 | ✓ |
| 57 | `runSteps` | function | 7 | 2 |  |
| 66 | `runPosition` | function | 3 | 1 |  |
| 72 | `invoke` | function | 7 | 1 |  |
| 82 | `settle` | function | 3 | 1 |  |
| 89 | `abortion` | function | 8 | 1 |  |
| 98 | `isAbort` | const | 1 | 1 |  |
| 101 | `inFlightIn` | const | 1 | 1 |  |
| 105 | `report` | function | 7 | 1 |  |
| 116 | `resultHashes` | function | 5 | 1 |  |
| 123 | `phaseResult` | const | 2 | 1 |  |
| 129 | `runPhase` | function | 19 | 1 |  |
| 131 | `reportPhase` | const | 2 | 4 |  |
| 133 | `duration` | const | 1 | 3 |  |
| 150 | `targetPhase` | function | 7 | 1 |  |
| 161 | `scopeOfRun` | function | 8 | 1 |  |
| 162 | `rerun` | property | 1 | — |  |
| 166 | `rerun` | property | 1 | — |  |
| 171 | `checkCapabilities` | function | 9 | 1 |  |
| 183 | `checkRunInputs` | function | 11 | 1 |  |
| 204 | `execute` | function | 42 | 1 | ✓ |
| 225 | `runPosition` | property | 1 | — |  |

## format.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 27 | `truncate` | const | 1 | 2 | ✓ |
| 29 | `keyText` | const | 1 | 1 |  |
| 31 | `indent` | const | 1 | 1 |  |
| 34 | `bracketed` | function | 6 | 2 |  |
| 41 | `formatError` | function | 7 | 2 | ✓ |
| 49 | `formatList` | function | 6 | 1 |  |
| 56 | `formatObject` | function | 5 | 1 |  |
| 62 | `formatValue` | function | 9 | 4 |  |
| 72 | `format` | function | 4 | 7 |  |

## forms.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 29 | `canonical` | function | 3 | 3 |  |
| 33 | `canonicalValue` | function | 14 | 4 |  |
| 50 | `hashOf` | const | 1 | 6 |  |
| 53 | `referenceForm` | function | 7 | 1 |  |
| 62 | `argumentsForm` | const | 1 | 1 |  |
| 65 | `stepsForm` | function | 9 | 3 |  |
| 78 | `callForm` | function | 22 | 1 |  |
| 105 | `formsOf` | function | 15 | 2 |  |

## graph.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 10 | `columnsOf` | function | 19 | 3 |  |
| 31 | `upstreamOf` | function | 10 | 1 |  |
| 33 | `visit` | const | 5 | 2 |  |

## index.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 27 | `readJson` | const | 8 | 3 |  |
| 37 | `filesIn` | const | 8 | 3 |  |
| 46 | `isExpired` | const | 1 | 1 |  |
| 49 | `sweep` | function | 8 | 1 |  |
| 60 | `fileStore` | function | 27 | 1 |  |
| 61 | `fileOf` | const | 1 | 2 |  |
| 63 | `ready` | const | 1 | 4 |  |
| 67 | `get` | property | 4 | — | ✓ |
| 71 | `set` | property | 5 | — |  |
| 76 | `list` | property | 5 | — |  |
| 82 | `clear` | property | 3 | — |  |
| 90 | `log` | function | 10 | 1 |  |
| 108 | `query` | function | 3 | 0 | ✓ |

## plan.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 23 | `typeOfArgument` | function | 10 | 3 |  |
| 35 | `onPair` | const | 1 | 4 |  |
| 40 | `fromZod` | property | 1 | — |  |
| 41 | `fromField` | property | 1 | — |  |
| 42 | `fromList` | property | 1 | — |  |
| 43 | `fromObject` | property | 1 | — |  |
| 44 | `fromValue` | property | 1 | — |  |
| 45 | `fromZodly` | property | 1 | — |  |
| 46 | `toList` | property | 1 | — |  |
| 47 | `toObject` | property | 1 | — |  |
| 55 | `resolveSource` | function | 5 | 8 |  |
| 63 | `type-mismatch` | property | 1 | — |  |
| 64 | `maybe-missing` | property | 1 | — |  |
| 65 | `type-narrowing` | property | 1 | — |  |
| 71 | `checkType` | function | 6 | 2 |  |
| 78 | `stepsTypes` | function | 5 | 3 |  |
| 87 | `argumentsType` | function | 5 | 1 |  |
| 97 | `fieldsOf` | function | 16 | 1 |  |
| 100 | `declared` | const | 1 | 3 |  |
| 102 | `typeOf` | const | 6 | 1 |  |
| 108 | `valueAt` | const | 1 | 1 |  |
| 116 | `argumentTypes` | function | 7 | 1 |  |
| 126 | `itemOf` | const | 4 | 1 |  |
| 133 | `catchType` | const | 2 | 2 |  |
| 140 | `positionTypes` | function | 15 | 1 |  |
| 142 | `inputOf` | const | 1 | 2 |  |
| 157 | `returnType` | const | 2 | 1 |  |
| 161 | `callTypes` | function | 8 | 1 |  |
| 173 | `triggerType` | const | 2 | 1 |  |
| 177 | `inferTypes` | function | 14 | 1 |  |
| 197 | `plan` | function | 35 | 0 |  |

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
| 35 | `isReference` | const | 2 | 5 |  |
| 41 | `mapReferences` | const | 6 | 4 |  |
| 49 | `malformation` | const | 8 | 1 |  |
| 58 | `pathOf` | const | 7 | 2 |  |
| 68 | `parseReference` | function | 11 | 4 |  |
| 88 | `enterPosition` | const | 5 | 6 |  |
| 95 | `scopedRoot` | const | 4 | 3 |  |
| 104 | `readOf` | function | 5 | 1 |  |
| 113 | `readsOutside` | const | 2 | 1 |  |
| 117 | `resolveRead` | function | 4 | 1 |  |
| 123 | `resolveReference` | function | 4 | 2 |  |

## runtime.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 20 | `memoryStore` | function | 20 | 1 |  |
| 23 | `get` | property | 3 | — | ✓ |
| 26 | `set` | property | 4 | — |  |
| 30 | `list` | property | 3 | — |  |
| 34 | `clear` | property | 4 | — |  |

## services/util.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 19 | `copyPlain` | const | 2 | 5 |  |
| 23 | `union` | function | 10 | 1 |  |
| 37 | `mergeValues` | function | 9 | 2 |  |
| 57 | `leftOver` | const | 1 | 2 |  |
| 65 | `eachItem` | const | 1 | 2 |  |
| 68 | `leaveOut` | function | 5 | 2 |  |
| 76 | `asError` | const | 1 | 2 |  |
| 95 | `init` | property | 3 | — |  |
| 103 | `call` | property | 1 | — |  |
| 110 | `call` | property | 1 | — |  |
| 117 | `call` | property | 1 | — |  |
| 124 | `call` | property | 3 | — |  |
| 137 | `call` | property | 5 | — |  |
| 148 | `call` | property | 1 | — |  |
| 155 | `call` | property | 1 | — |  |
| 161 | `call` | property | 1 | — |  |
| 167 | `call` | property | 1 | — |  |
| 174 | `call` | property | 1 | — |  |
| 181 | `call` | property | 1 | — |  |
| 187 | `call` | property | 1 | — |  |
| 193 | `call` | property | 1 | — |  |
| 200 | `call` | property | 1 | — |  |
| 207 | `call` | property | 1 | — |  |
| 214 | `call` | property | 1 | — |  |
| 221 | `call` | property | 5 | — |  |
| 232 | `call` | property | 4 | — |  |
| 241 | `call` | property | 1 | — |  |
| 250 | `lookup` | property | 4 | — |  |

## types.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 29 | `unwrap` | const | 1 | 11 |  |
| 31 | `typeOf` | const | 1 | 6 |  |
| 33 | `isAny` | const | 1 | 7 |  |
| 36 | `mayBeMissing` | const | 1 | 3 |  |
| 40 | `openTo` | const | 4 | 5 |  |
| 47 | `fieldOf` | const | 2 | 4 |  |
| 51 | `objectLike` | const | 1 | 1 |  |
| 53 | `enumValues` | const | 1 | 3 |  |
| 56 | `isAbsent` | const | 1 | 1 |  |
| 63 | `describeSchema` | function | 20 | 20 |  |
| 85 | `described` | const | 1 | 1 |  |
| 88 | `sharedSchema` | function | 4 | 4 |  |
| 94 | `schemaOfValue` | function | 9 | 5 |  |
| 105 | `elementOf` | function | 4 | 1 |  |
| 112 | `valueOf` | function | 8 | 1 |  |
| 122 | `schemaAtPath` | function | 9 | 3 |  |
| 133 | `severityOf` | const | 1 | 3 |  |
| 135 | `issue` | const | 1 | 13 |  |
| 139 | `baseTypeOf` | function | 6 | 3 |  |
| 149 | `compareFields` | function | 5 | 1 |  |
| 157 | `array` | property | 3 | — |  |
| 160 | `object` | property | 3 | — |  |
| 163 | `record` | property | 7 | — |  |
| 170 | `enum` | property | 6 | — |  |
| 176 | `literal` | property | 4 | — |  |
| 183 | `compareToUnion` | function | 4 | 1 |  |
| 193 | `compare` | function | 13 | 8 |  |
| 208 | `membersOf` | const | 1 | 5 |  |
| 211 | `unionOf` | function | 4 | 3 |  |
| 226 | `union` | const | 4 | 6 |  |
| 237 | `difference` | function | 7 | 1 |  |
| 245 | `isScalar` | const | 1 | 1 |  |
| 253 | `literalOf` | function | 8 | 3 |  |
| 264 | `literal` | property | 1 | — |  |
| 265 | `undefined` | property | 1 | — |  |
| 266 | `tuple` | property | 1 | — |  |
| 267 | `object` | property | 1 | — |  |
| 271 | `isLiteral` | const | 4 | 2 |  |
| 277 | `valueOfLiteral` | function | 7 | 3 |  |
| 290 | `describedBy` | function | 4 | 1 |  |
| 297 | `keysIn` | function | 5 | 1 |  |
| 309 | `pick` | function | 11 | 1 | ✓ |
| 312 | `pickFrom` | const | 6 | 1 |  |
| 322 | `alternativesOf` | function | 7 | 6 |  |
| 333 | `mergeOne` | function | 12 | 1 |  |
| 352 | `merge` | function | 5 | 2 | ✓ |

## wrappers.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 34 | `labelOf` | const | 1 | 4 |  |
| 38 | `resolveArgs` | const | 2 | 2 |  |
| 44 | `catchWith` | const | 4 | 2 |  |
| 51 | `inputHash` | const | 1 | 1 |  |
| 56 | `withArgs` | const | 16 | 1 | ✓ |
| 73 | `withDebug` | const | 12 | 1 | ✓ |
| 77 | `show` | const | 1 | 3 |  |
| 89 | `labelError` | function | 10 | 1 |  |
| 101 | `withErrorLabel` | const | 4 | 1 |  |
| 108 | `withRunState` | const | 14 | 1 |  |
| 123 | `recordResult` | function | 14 | 1 |  |
| 138 | `parseTimeUnit` | const | 7 | 1 | ✓ |
| 151 | `withCache` | const | 15 | 1 | ✓ |
| 169 | `check` | function | 13 | 2 |  |
| 170 | `show` | const | 1 | 3 |  |
| 183 | `withPrecheck` | const | 4 | 1 |  |
| 188 | `withPostcheck` | const | 5 | 1 |  |
| 194 | `hasChecks` | const | 1 | 2 |  |
| 196 | `withRateLimit` | const | 2 | 1 | ✓ |
| 199 | `withConcurrency` | const | 2 | 1 |  |
| 202 | `withRetry` | const | 13 | 1 | ✓ |
| 216 | `withTimeout` | const | 12 | 1 | ✓ |
| 231 | `servicePositions` | const | 1 | 2 |  |
| 236 | `holdsCalls` | const | 1 | 2 |  |
| 239 | `wrappersFor` | function | 16 | 1 |  |
| 257 | `wrap` | function | 4 | 1 |  |
| 258 | `operation` | const | 1 | 1 |  |
<!-- /generated:function-names -->
