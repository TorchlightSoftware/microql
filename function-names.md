# MicroQL core — function names by file

Every named function in core: `function` declarations, `const` function values, object properties (util resources, store methods) and class methods. Anonymous inline callbacks are not listed.

- **lines** — length of the definition
- **refs** — identifiers naming the function in core: in its own file, plus in files that import it, leaving out its declaration, import and export lists, property keys and member names. 0 means public API used only by callers outside core (tests, hosts). Properties and methods are dispatched by name at run time, so they get no count. Names are matched textually, so a parameter that shadows a function is counted too.
- **0.6** — 0.6.6 core (`836d9bf`) also defined a function by this name

The tables below are generated. Regenerate them with `npm run docs:functions` after changing core; it rewrites only the text between the `generated:function-names` markers, so edit this introduction freely.

<!-- generated:function-names -->
## index.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 35 | `readJson` | const | 8 | 3 |  |
| 45 | `filesIn` | const | 8 | 3 |  |
| 54 | `isExpired` | const | 1 | 1 |  |
| 57 | `sweep` | function | 8 | 1 |  |
| 68 | `fileStore` | function | 27 | 2 |  |
| 69 | `fileOf` | const | 1 | 2 |  |
| 71 | `ready` | const | 1 | 4 |  |
| 75 | `get` | property | 4 | — | ✓ |
| 79 | `set` | property | 5 | — |  |
| 84 | `list` | property | 5 | — |  |
| 90 | `clear` | property | 3 | — |  |
| 98 | `clearingDir` | const | 4 | 2 |  |
| 100 | `clear` | property | 1 | — |  |
| 105 | `fileCache` | const | 1 | 1 |  |
| 109 | `fileRunStates` | const | 1 | 0 |  |
| 113 | `log` | function | 10 | 1 |  |
| 129 | `constructor` | method | 6 | — | ✓ |
| 142 | `withServices` | function | 9 | 3 |  |
| 154 | `fileConfig` | function | 6 | 1 |  |
| 161 | `compile` | const | 1 | 0 | ✓ |
| 163 | `plan` | const | 1 | 0 |  |
| 169 | `query` | function | 11 | 6 | ✓ |

## src/common/common.js

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
| 83 | `defaults` | const | 9 | 3 |  |

## src/common/format.js

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
| 72 | `format` | function | 4 | 10 |  |

## src/execute/concurrency.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 10 | `concurrencyLimit` | function | 27 | 1 |  |
| 14 | `acquire` | const | 7 | 1 |  |
| 22 | `release` | const | 5 | 1 |  |

## src/execute/errors.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 24 | `isErrorData` | const | 1 | 6 |  |
| 28 | `toErrorData` | function | 6 | 3 |  |
| 37 | `fromErrorData` | function | 4 | 2 |  |

## src/execute/execute.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 31 | `runSteps` | function | 7 | 2 |  |
| 40 | `runPosition` | function | 3 | 1 |  |
| 46 | `invoke` | function | 6 | 1 |  |
| 55 | `settle` | function | 3 | 1 |  |
| 62 | `abortion` | function | 8 | 1 |  |
| 71 | `isAbort` | const | 1 | 1 |  |
| 74 | `inFlightIn` | const | 1 | 1 |  |
| 78 | `report` | function | 7 | 1 |  |
| 89 | `resultHashes` | function | 5 | 1 |  |
| 96 | `phaseResult` | const | 2 | 1 |  |
| 102 | `runPhase` | function | 19 | 1 |  |
| 104 | `reportPhase` | const | 2 | 4 |  |
| 106 | `duration` | const | 1 | 3 |  |
| 123 | `targetPhase` | function | 7 | 1 |  |
| 134 | `extentOfRun` | function | 8 | 1 |  |
| 135 | `rerun` | property | 1 | — |  |
| 139 | `rerun` | property | 1 | — |  |
| 146 | `checkRunInputs` | function | 9 | 1 |  |
| 165 | `execute` | function | 38 | 1 | ✓ |
| 185 | `runPosition` | property | 1 | — |  |

## src/execute/ratelimit.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 1 | `timeoutPromise` | const | 1 | 1 | ✓ |
| 4 | `constructor` | method | 5 | — | ✓ |
| 9 | `push` | method | 13 | — | ✓ |
| 22 | `_call` | method | 9 | — | ✓ |

## src/execute/wrappers.js

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
| 126 | `recordResult` | function | 14 | 1 |  |
| 130 | `record` | const | 1 | 2 |  |
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
| 261 | `wrap` | function | 4 | 1 |  |
| 262 | `serviceCall` | const | 1 | 1 |  |

## src/query/addresses.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 21 | `fieldPathOf` | const | 2 | 1 |  |
| 25 | `addressToPath` | function | 11 | 0 |  |
| 37 | `startsWith` | const | 1 | 2 |  |
| 40 | `withField` | const | 1 | 2 |  |
| 44 | `pathToAddress` | function | 12 | 0 |  |

## src/query/compile.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 48 | `lettersOf` | const | 4 | 1 |  |
| 62 | `checkRetired` | function | 4 | 2 |  |
| 69 | `fail` | const | 3 | 26 |  |
| 74 | `isChain` | const | 2 | 3 | ✓ |
| 80 | `parseDescriptor` | function | 16 | 1 |  |
| 98 | `isService` | const | 1 | 1 |  |
| 102 | `serviceAt` | function | 10 | 1 |  |
| 115 | `lookedUp` | function | 7 | 1 |  |
| 125 | `declarationAt` | function | 8 | 1 |  |
| 135 | `targetField` | function | 4 | 1 |  |
| 141 | `parseSchemaAt` | function | 7 | 2 |  |
| 151 | `compileValidators` | const | 16 | 1 | ✓ |
| 170 | `compileSettings` | const | 7 | 1 | ✓ |
| 180 | `checkReferences` | function | 18 | 1 |  |
| 183 | `check` | const | 12 | 3 |  |
| 200 | `uniqueReads` | const | 1 | 2 |  |
| 202 | `parseWithSite` | function | 7 | 2 |  |
| 210 | `checkReference` | function | 8 | 1 |  |
| 220 | `declareBinding` | function | 8 | 1 |  |
| 231 | `sitesAt` | const | 4 | 3 |  |
| 239 | `compileSteps` | function | 6 | 3 |  |
| 251 | `compilePosition` | function | 20 | 1 |  |
| 274 | `positionFields` | function | 13 | 1 |  |
| 289 | `compileCall` | function | 51 | 1 |  |
| 341 | `compilePhase` | function | 9 | 1 |  |
| 352 | `compileGlobalCatch` | function | 4 | 1 |  |
| 358 | `compileSelect` | function | 10 | 1 |  |
| 375 | `compile` | function | 32 | 3 | ✓ |

## src/query/forms.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 29 | `canonical` | function | 3 | 9 |  |
| 33 | `canonicalValue` | function | 14 | 4 |  |
| 50 | `hashOf` | const | 1 | 8 |  |
| 53 | `referenceForm` | function | 7 | 1 |  |
| 62 | `argumentsForm` | const | 1 | 1 |  |
| 65 | `stepsForm` | function | 9 | 3 |  |
| 78 | `callForm` | function | 22 | 1 |  |
| 105 | `formsOf` | function | 15 | 2 |  |

## src/query/graph.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 10 | `columnsOf` | function | 19 | 3 |  |
| 31 | `upstreamOf` | function | 10 | 1 |  |
| 33 | `visit` | const | 5 | 2 |  |

## src/query/query.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 14 | `applySelection` | function | 5 | 1 | ✓ |
| 27 | `query` | function | 5 | 2 | ✓ |

## src/query/reference.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 35 | `isReference` | const | 2 | 5 |  |
| 41 | `mapReferences` | const | 6 | 4 |  |
| 49 | `malformation` | const | 8 | 1 |  |
| 58 | `pathOf` | const | 7 | 2 |  |
| 68 | `parseReference` | function | 11 | 4 |  |
| 88 | `enterPosition` | const | 5 | 6 |  |
| 95 | `contextRoot` | const | 4 | 3 |  |
| 104 | `readOf` | function | 5 | 1 |  |
| 113 | `readsOutside` | const | 2 | 1 |  |
| 117 | `resolveRead` | function | 4 | 1 |  |
| 123 | `resolveReference` | function | 4 | 2 |  |

## src/runtime/config.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 32 | `asOAuth` | function | 7 | 1 |  |
| 43 | `configSchemaOf` | const | 1 | 1 |  |
| 45 | `configError` | const | 1 | 4 |  |
| 48 | `configRefusal` | function | 14 | 2 |  |
| 79 | `constructor` | method | 4 | — | ✓ |
| 85 | `get` | method | 3 | — | ✓ |
| 90 | `set` | method | 9 | — |  |
| 100 | `delete` | method | 5 | — |  |
| 107 | `write` | method | 3 | — |  |
| 111 | `erase` | method | 3 | — |  |

## src/runtime/runtime.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 43 | `memoryStore` | function | 20 | 2 |  |
| 46 | `get` | property | 3 | — | ✓ |
| 49 | `set` | property | 4 | — |  |
| 53 | `list` | property | 3 | — |  |
| 57 | `clear` | property | 4 | — |  |
| 65 | `storesBy` | function | 22 | 2 |  |
| 68 | `of` | property | 5 | — |  |
| 74 | `remove` | property | 5 | — |  |
| 80 | `removeAll` | property | 5 | — |  |
| 90 | `scopedCache` | function | 15 | 2 |  |
| 93 | `get` | property | 1 | — | ✓ |
| 94 | `set` | property | 1 | — |  |
| 95 | `list` | property | 1 | — |  |
| 98 | `clear` | property | 5 | — |  |
| 109 | `scopedRunStates` | function | 15 | 2 |  |
| 111 | `storeOfRun` | const | 1 | 3 |  |
| 113 | `get` | property | 1 | — | ✓ |
| 114 | `set` | property | 1 | — |  |
| 115 | `list` | property | 1 | — |  |
| 118 | `clear` | property | 4 | — |  |
| 126 | `memoryCache` | const | 1 | 1 |  |
| 129 | `memoryRunStates` | const | 1 | 1 |  |
| 133 | `inScope` | const | 15 | 1 |  |
| 135 | `get` | property | 1 | — | ✓ |
| 136 | `call` | property | 1 | — |  |
| 138 | `get` | property | 1 | — | ✓ |
| 139 | `set` | property | 1 | — |  |
| 140 | `list` | property | 1 | — |  |
| 142 | `runStateOf` | property | 5 | — |  |
| 143 | `get` | property | 1 | — | ✓ |
| 144 | `set` | property | 1 | — |  |
| 145 | `list` | property | 1 | — |  |
| 150 | `missingCapability` | const | 1 | 2 |  |
| 153 | `constructor` | method | 7 | — | ✓ |
| 164 | `register` | method | 1 | — |  |
| 167 | `call` | method | 4 | — |  |
| 173 | `tearDown` | method | 3 | — |  |
| 179 | `undefined` | method | 5 | — |  |

## src/runtime/service-registry.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 24 | `release` | const | 1 | 2 |  |
| 30 | `constructor` | method | 5 | — | ✓ |
| 37 | `register` | method | 3 | — |  |
| 41 | `unregister` | method | 3 | — |  |
| 46 | `get` | method | 3 | — | ✓ |
| 51 | `list` | method | 3 | — |  |
| 62 | `instanceOf` | method | 14 | — |  |
| 79 | `tearDown` | method | 4 | — |  |

## src/runtime/table.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 18 | `constructor` | method | 3 | — | ✓ |
| 24 | `undefined` | method | 8 | — |  |
| 33 | `get` | method | 3 | — | ✓ |
| 37 | `set` | method | 5 | — |  |
| 44 | `list` | method | 3 | — |  |
| 50 | `remove` | method | 4 | — |  |
| 57 | `undefined` | method | 11 | — |  |

## src/service/define-service.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 26 | `isServiceCall` | const | 1 | 1 |  |
| 29 | `serviceCallOf` | function | 4 | 1 |  |
| 35 | `serviceCallsByResource` | function | 8 | 1 |  |
| 44 | `methodsOf` | const | 1 | 2 |  |
| 45 | `nameOf` | const | 1 | 7 |  |
| 48 | `custodyRefusal` | function | 4 | 1 |  |
| 54 | `methodRefusal` | function | 5 | 1 |  |
| 64 | `defineService` | function | 33 | 1 |  |
| 68 | `serviceCallAt` | function | 7 | 2 |  |
| 76 | `supportedCalls` | const | 2 | 1 |  |
| 80 | `init` | function | 8 | 1 |  |
| 84 | `call` | property | 1 | — |  |
| 85 | `tearDown` | property | 1 | — |  |
| 90 | `lookup` | property | 1 | — |  |

## src/service/smoke-test.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 25 | `check` | const | 3 | 11 |  |
| 30 | `refuses` | function | 4 | 3 |  |
| 36 | `row` | const | 1 | 10 |  |
| 38 | `isFunction` | const | 1 | 5 |  |
| 39 | `hasFunction` | const | 2 | 2 |  |
| 42 | `nameOf` | const | 1 | 4 |  |
| 45 | `withInstance` | function | 8 | 4 |  |
| 55 | `listedCalls` | const | 1 | 1 |  |
| 61 | `serviceSmokeTests` | function | 53 | 0 |  |
| 64 | `keyOf` | const | 1 | 7 |  |

## src/service/util.js

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

## src/types/declaration.js

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

## src/types/plan.js

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
| 175 | `plan` | function | 35 | 1 |  |

## src/types/sources.js

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

## src/types/types.js

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
<!-- /generated:function-names -->
