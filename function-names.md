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
| 23 | `isPlainObject` | const | 5 | 19 |  |
| 33 | `mapValues` | const | 5 | 11 |  |
| 40 | `filterObject` | const | 2 | 1 |  |
| 44 | `pick` | const | 2 | 6 | ✓ |
| 47 | `omit` | const | 1 | 5 |  |
| 50 | `getIn` | const | 1 | 10 |  |
| 54 | `setIn` | const | 4 | 3 |  |
| 60 | `omitIn` | const | 4 | 2 |  |
| 69 | `parseFieldPath` | const | 5 | 5 |  |
| 76 | `writeFieldPath` | const | 1 | 1 |  |
| 79 | `setPaths` | const | 2 | 4 |  |
| 83 | `defaults` | const | 9 | 4 |  |

## compile.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 47 | `lettersOf` | const | 4 | 1 |  |
| 61 | `checkRetired` | function | 4 | 2 |  |
| 68 | `fail` | const | 3 | 25 |  |
| 73 | `isChain` | const | 2 | 3 | ✓ |
| 79 | `parseDescriptor` | function | 16 | 1 |  |
| 97 | `isService` | const | 1 | 1 |  |
| 100 | `serviceAt` | function | 8 | 1 |  |
| 111 | `lookedUp` | function | 7 | 1 |  |
| 121 | `declarationAt` | function | 8 | 1 |  |
| 131 | `targetField` | function | 4 | 1 |  |
| 137 | `parseSchemaAt` | function | 7 | 2 |  |
| 147 | `compileValidators` | const | 16 | 1 | ✓ |
| 166 | `compileSettings` | const | 7 | 1 | ✓ |
| 176 | `checkReferences` | function | 18 | 1 |  |
| 179 | `check` | const | 12 | 3 |  |
| 196 | `uniqueReads` | const | 1 | 2 |  |
| 198 | `parseWithSite` | function | 7 | 2 |  |
| 206 | `checkReference` | function | 8 | 1 |  |
| 216 | `declareBinding` | function | 8 | 1 |  |
| 227 | `sitesAt` | const | 4 | 3 |  |
| 235 | `compileSteps` | function | 6 | 3 |  |
| 247 | `compilePosition` | function | 20 | 1 |  |
| 270 | `positionFields` | function | 13 | 1 |  |
| 285 | `compileCall` | function | 52 | 1 |  |
| 338 | `compilePhase` | function | 9 | 1 |  |
| 349 | `compileGlobalCatch` | function | 4 | 1 |  |
| 355 | `compileSelect` | function | 10 | 1 |  |
| 370 | `compile` | function | 33 | 2 | ✓ |

## concurrency.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 10 | `concurrencyLimit` | function | 27 | 1 |  |
| 14 | `acquire` | const | 7 | 1 |  |
| 22 | `release` | const | 5 | 1 |  |

## declaration.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 43 | `asFunction` | const | 2 | 2 |  |
| 47 | `refusedFunction` | const | 3 | 1 |  |
| 62 | `reading` | const | 1 | 4 |  |
| 67 | `planned` | property | 1 | — |  |
| 68 | `plannedData` | property | 1 | — |  |
| 73 | `readDocument` | function | 7 | 3 |  |
| 84 | `fieldsIn` | function | 10 | 2 |  |
| 95 | `checkTags` | function | 4 | 1 |  |
| 100 | `tagged` | const | 1 | 2 |  |
| 103 | `atRunTime` | function | 4 | 2 |  |
| 112 | `readDeclaration` | function | 17 | 2 |  |

## define-service.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 25 | `isServiceCall` | const | 1 | 1 |  |
| 28 | `serviceCallOf` | function | 4 | 1 |  |
| 34 | `serviceCallsByResource` | function | 8 | 1 |  |
| 43 | `methodsOf` | const | 1 | 2 |  |
| 44 | `nameOf` | const | 1 | 7 |  |
| 47 | `custodyRefusal` | function | 4 | 1 |  |
| 53 | `methodRefusal` | function | 5 | 1 |  |
| 63 | `defineService` | function | 33 | 1 |  |
| 67 | `serviceCallAt` | function | 7 | 2 |  |
| 75 | `supportedCalls` | const | 2 | 1 |  |
| 79 | `init` | function | 8 | 1 |  |
| 83 | `call` | property | 1 | — |  |
| 84 | `tearDown` | property | 1 | — |  |
| 89 | `lookup` | property | 1 | — |  |

## errors.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 24 | `isErrorData` | const | 1 | 6 |  |
| 28 | `toErrorData` | function | 6 | 3 |  |
| 37 | `fromErrorData` | function | 4 | 2 |  |

## execute.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 29 | `servicesUsed` | const | 1 | 1 |  |
| 32 | `runSteps` | function | 7 | 2 |  |
| 41 | `runPosition` | function | 3 | 1 |  |
| 47 | `invoke` | function | 6 | 1 |  |
| 56 | `settle` | function | 3 | 1 |  |
| 63 | `abortion` | function | 8 | 1 |  |
| 72 | `isAbort` | const | 1 | 1 |  |
| 75 | `inFlightIn` | const | 1 | 1 |  |
| 79 | `report` | function | 7 | 1 |  |
| 90 | `resultHashes` | function | 5 | 1 |  |
| 97 | `phaseResult` | const | 2 | 1 |  |
| 103 | `runPhase` | function | 19 | 1 |  |
| 105 | `reportPhase` | const | 2 | 4 |  |
| 107 | `duration` | const | 1 | 3 |  |
| 124 | `targetPhase` | function | 7 | 1 |  |
| 135 | `scopeOfRun` | function | 8 | 1 |  |
| 136 | `rerun` | property | 1 | — |  |
| 140 | `rerun` | property | 1 | — |  |
| 145 | `runError` | const | 2 | 1 |  |
| 150 | `requirementsOf` | const | 1 | 1 |  |
| 154 | `configRefusal` | function | 13 | 1 |  |
| 173 | `runtimeRefusal` | function | 5 | 2 |  |
| 180 | `checkService` | function | 4 | 1 |  |
| 186 | `checkServices` | function | 5 | 1 |  |
| 194 | `checkRunInputs` | function | 12 | 1 |  |
| 216 | `execute` | function | 40 | 1 | ✓ |
| 236 | `runPosition` | property | 1 | — |  |

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
| 72 | `format` | function | 4 | 8 |  |

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
| 92 | `log` | function | 10 | 1 |  |
| 113 | `query` | function | 3 | 0 | ✓ |

## plan.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 24 | `typeOfArgument` | function | 10 | 3 |  |
| 37 | `plannedDocument` | const | 1 | 3 |  |
| 39 | `expectedData` | const | 1 | 1 |  |
| 40 | `expectedInput` | const | 1 | 1 |  |
| 41 | `expectedOutput` | const | 1 | 1 |  |
| 45 | `type-mismatch` | property | 1 | — |  |
| 46 | `maybe-missing` | property | 1 | — |  |
| 47 | `type-narrowing` | property | 1 | — |  |
| 53 | `checkType` | function | 6 | 2 |  |
| 60 | `stepsTypes` | function | 5 | 3 |  |
| 69 | `argumentsType` | function | 5 | 1 |  |
| 79 | `fieldsOf` | function | 13 | 1 |  |
| 82 | `declared` | const | 1 | 2 |  |
| 84 | `typeOf` | const | 5 | 1 |  |
| 89 | `valueAt` | const | 1 | 1 |  |
| 95 | `argumentTypes` | function | 5 | 1 |  |
| 103 | `itemOf` | const | 4 | 1 |  |
| 110 | `catchType` | const | 2 | 2 |  |
| 117 | `positionTypes` | function | 16 | 1 |  |
| 120 | `signatureOf` | const | 1 | 2 |  |
| 135 | `returnType` | const | 2 | 1 |  |
| 139 | `callTypes` | function | 8 | 1 |  |
| 151 | `triggerType` | const | 2 | 1 |  |
| 155 | `inferTypes` | function | 14 | 1 |  |
| 175 | `plan` | function | 35 | 0 |  |

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
| 26 | `memoryStore` | function | 20 | 1 |  |
| 29 | `get` | property | 3 | — | ✓ |
| 32 | `set` | property | 4 | — |  |
| 36 | `list` | property | 3 | — |  |
| 40 | `clear` | property | 4 | — |  |
| 49 | `runtimeFor` | const | 1 | 2 |  |
| 59 | `serviceRegistry` | function | 31 | 1 |  |
| 61 | `instancesOf` | const | 1 | 2 |  |
| 65 | `instanceOf` | function | 10 | 1 |  |
| 77 | `init` | property | 5 | — |  |
| 82 | `tearDown` | property | 6 | — |  |

## services/util.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 19 | `copyPlain` | const | 2 | 5 |  |
| 23 | `union` | function | 10 | 1 |  |
| 37 | `mergeValues` | function | 9 | 2 |  |
| 47 | `eachItem` | const | 1 | 2 |  |
| 50 | `leaveOut` | function | 5 | 2 |  |
| 58 | `asError` | const | 1 | 2 |  |
| 77 | `init` | property | 3 | — |  |
| 90 | `call` | property | 1 | — |  |
| 102 | `call` | property | 1 | — |  |
| 109 | `call` | property | 1 | — |  |
| 116 | `call` | property | 3 | — |  |
| 129 | `call` | property | 5 | — |  |
| 140 | `call` | property | 1 | — |  |
| 147 | `call` | property | 1 | — |  |
| 153 | `call` | property | 1 | — |  |
| 159 | `call` | property | 1 | — |  |
| 166 | `call` | property | 1 | — |  |
| 173 | `call` | property | 1 | — |  |
| 179 | `call` | property | 1 | — |  |
| 185 | `call` | property | 1 | — |  |
| 192 | `call` | property | 1 | — |  |
| 199 | `call` | property | 1 | — |  |
| 206 | `call` | property | 1 | — |  |
| 218 | `call` | property | 5 | — |  |
| 229 | `call` | property | 4 | — |  |
| 238 | `call` | property | 1 | — |  |
| 247 | `lookup` | property | 4 | — |  |

## smoke-test.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 25 | `check` | const | 3 | 10 |  |
| 30 | `refuses` | function | 4 | 3 |  |
| 36 | `row` | const | 1 | 10 |  |
| 38 | `isFunction` | const | 1 | 5 |  |
| 39 | `hasFunction` | const | 2 | 2 |  |
| 42 | `nameOf` | const | 1 | 4 |  |
| 45 | `withInstance` | function | 8 | 4 |  |
| 55 | `listedCalls` | const | 1 | 1 |  |
| 61 | `serviceSmokeTests` | function | 53 | 0 |  |
| 66 | `keyOf` | const | 1 | 7 |  |

## sources.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 32 | `refuse` | const | 3 | 2 |  |
| 40 | `path` | property | 1 | — |  |
| 41 | `zodly` | property | 1 | — |  |
| 42 | `pair` | property | 3 | — |  |
| 48 | `onPair` | const | 1 | 3 |  |
| 52 | `resolve` | property | 1 | — |  |
| 53 | `resolve` | property | 1 | — |  |
| 54 | `resolve` | property | 1 | — |  |
| 55 | `resolve` | property | 1 | — |  |
| 58 | `resolve` | property | 1 | — |  |
| 69 | `checkSource` | function | 9 | 3 |  |
| 80 | `resolveSource` | function | 4 | 4 |  |
| 91 | `checkedAsAny` | const | 4 | 1 |  |
| 96 | `resolvedIn` | const | 2 | 2 |  |

## types.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 31 | `unwrap` | const | 1 | 17 |  |
| 33 | `typeOf` | const | 1 | 7 |  |
| 35 | `isAny` | const | 1 | 8 |  |
| 38 | `mayBeMissing` | const | 1 | 3 |  |
| 42 | `openTo` | const | 4 | 5 |  |
| 49 | `fieldOf` | const | 2 | 4 |  |
| 53 | `objectLike` | const | 1 | 1 |  |
| 55 | `enumValues` | const | 1 | 3 |  |
| 58 | `isAbsent` | const | 1 | 1 |  |
| 65 | `describeSchema` | function | 20 | 21 |  |
| 87 | `describeUnion` | const | 2 | 1 |  |
| 91 | `described` | const | 1 | 1 |  |
| 94 | `sharedSchema` | function | 4 | 4 |  |
| 101 | `widenedTypeOf` | function | 9 | 5 |  |
| 112 | `elementOf` | function | 4 | 1 |  |
| 119 | `fieldValueOf` | function | 8 | 1 |  |
| 129 | `schemaAtPath` | function | 9 | 4 |  |
| 140 | `severityOf` | const | 1 | 3 |  |
| 142 | `issue` | const | 1 | 13 |  |
| 146 | `baseTypeOf` | function | 6 | 3 |  |
| 156 | `compareFields` | function | 5 | 1 |  |
| 164 | `array` | property | 3 | — |  |
| 167 | `object` | property | 3 | — |  |
| 170 | `record` | property | 7 | — |  |
| 177 | `enum` | property | 6 | — |  |
| 183 | `literal` | property | 4 | — |  |
| 190 | `compareToUnion` | function | 4 | 1 |  |
| 200 | `compare` | function | 14 | 8 |  |
| 216 | `membersOf` | const | 1 | 5 |  |
| 219 | `unionOf` | function | 4 | 3 |  |
| 225 | `simplified` | const | 1 | 3 |  |
| 229 | `receivedBy` | const | 1 | 2 |  |
| 232 | `returnedBy` | const | 1 | 2 |  |
| 244 | `union` | const | 4 | 6 |  |
| 255 | `difference` | function | 7 | 1 |  |
| 263 | `isScalar` | const | 1 | 1 |  |
| 271 | `literalTypeOf` | function | 8 | 3 |  |
| 282 | `literal` | property | 1 | — |  |
| 283 | `undefined` | property | 1 | — |  |
| 284 | `tuple` | property | 1 | — |  |
| 285 | `object` | property | 1 | — |  |
| 289 | `isLiteral` | const | 4 | 2 |  |
| 295 | `valueOfLiteral` | function | 7 | 3 |  |
| 308 | `schemaOfDescriptor` | function | 4 | 1 |  |
| 315 | `keysIn` | function | 5 | 1 |  |
| 327 | `pick` | function | 11 | 1 | ✓ |
| 330 | `pickFrom` | const | 6 | 1 |  |
| 340 | `alternativesOf` | function | 7 | 6 |  |
| 351 | `mergeOne` | function | 12 | 1 |  |
| 370 | `merge` | function | 5 | 2 | ✓ |

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
| 257 | `wrap` | function | 5 | 1 |  |
| 259 | `serviceCall` | const | 1 | 1 |  |
<!-- /generated:function-names -->
