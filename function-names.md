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
| 39 | `log` | function | 10 | 1 |  |
| 57 | `constructor` | method | 6 | — | ✓ |
| 72 | `fileServices` | function | 6 | 1 |  |
| 81 | `fileConfig` | function | 6 | 1 |  |
| 90 | `inScope` | function | 4 | 3 |  |
| 95 | `compile` | const | 1 | 0 | ✓ |
| 97 | `plan` | const | 1 | 0 |  |
| 100 | `release` | function | 4 | 1 |  |
| 109 | `query` | function | 11 | 4 | ✓ |

## src/common/common.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 16 | `getServiceColorName` | const | 6 | 1 | ✓ |
| 25 | `isPlainObject` | const | 5 | 19 |  |
| 35 | `mapValues` | const | 5 | 11 |  |
| 42 | `filterObject` | const | 2 | 1 |  |
| 46 | `pick` | const | 2 | 6 | ✓ |
| 49 | `omit` | const | 1 | 7 |  |
| 52 | `getIn` | const | 1 | 10 |  |
| 56 | `setIn` | const | 4 | 3 |  |
| 62 | `omitIn` | const | 4 | 2 |  |
| 71 | `parseFieldPath` | const | 5 | 5 |  |
| 78 | `writeFieldPath` | const | 1 | 1 |  |
| 81 | `setPaths` | const | 2 | 4 |  |
| 85 | `defaults` | const | 9 | 3 |  |

## src/common/error-catalog.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 33 | `quoted` | const | 1 | 2 |  |
| 37 | `cause` | property | 1 | — |  |
| 37 | `hint` | property | 1 | — |  |
| 38 | `cause` | property | 1 | — |  |
| 39 | `cause` | property | 1 | — |  |
| 39 | `hint` | property | 1 | — |  |
| 40 | `cause` | property | 1 | — |  |
| 40 | `hint` | property | 1 | — |  |
| 41 | `cause` | property | 1 | — |  |
| 41 | `hint` | property | 1 | — |  |
| 42 | `cause` | property | 1 | — |  |
| 43 | `cause` | property | 1 | — |  |
| 43 | `hint` | property | 1 | — |  |
| 44 | `cause` | property | 1 | — |  |
| 45 | `cause` | property | 1 | — |  |
| 45 | `hint` | property | 1 | — |  |
| 46 | `cause` | property | 1 | — |  |
| 46 | `hint` | property | 1 | — |  |
| 47 | `cause` | property | 1 | — |  |
| 48 | `cause` | property | 1 | — |  |
| 49 | `cause` | property | 1 | — |  |
| 52 | `cause` | property | 1 | — |  |
| 52 | `hint` | property | 1 | — |  |
| 53 | `cause` | property | 1 | — |  |
| 53 | `hint` | property | 1 | — |  |
| 54 | `cause` | property | 1 | — |  |
| 54 | `hint` | property | 1 | — |  |
| 55 | `cause` | property | 1 | — |  |
| 56 | `cause` | property | 1 | — |  |
| 57 | `cause` | property | 1 | — |  |
| 58 | `cause` | property | 1 | — |  |
| 58 | `hint` | property | 1 | — |  |
| 61 | `cause` | property | 1 | — |  |
| 62 | `cause` | property | 1 | — |  |
| 62 | `hint` | property | 1 | — |  |
| 63 | `cause` | property | 1 | — |  |
| 64 | `cause` | property | 1 | — |  |
| 65 | `cause` | property | 1 | — |  |
| 66 | `cause` | property | 1 | — |  |
| 66 | `hint` | property | 1 | — |  |
| 67 | `cause` | property | 1 | — |  |
| 67 | `hint` | property | 1 | — |  |
| 68 | `cause` | property | 1 | — |  |
| 68 | `hint` | property | 1 | — |  |
| 69 | `cause` | property | 1 | — |  |
| 72 | `cause` | property | 1 | — |  |
| 73 | `cause` | property | 1 | — |  |
| 74 | `cause` | property | 1 | — |  |
| 75 | `cause` | property | 1 | — |  |
| 76 | `cause` | property | 1 | — |  |
| 76 | `hint` | property | 1 | — |  |
| 77 | `cause` | property | 1 | — |  |
| 78 | `cause` | property | 1 | — |  |
| 79 | `cause` | property | 1 | — |  |
| 82 | `cause` | property | 1 | — |  |
| 82 | `hint` | property | 1 | — |  |
| 83 | `cause` | property | 1 | — |  |
| 84 | `cause` | property | 1 | — |  |
| 85 | `cause` | property | 1 | — |  |
| 86 | `cause` | property | 1 | — |  |
| 87 | `cause` | property | 1 | — |  |
| 90 | `cause` | property | 1 | — |  |
| 91 | `cause` | property | 1 | — |  |
| 91 | `hint` | property | 1 | — |  |
| 92 | `cause` | property | 1 | — |  |
| 93 | `cause` | property | 1 | — |  |
| 94 | `cause` | property | 1 | — |  |
| 94 | `hint` | property | 1 | — |  |
| 95 | `cause` | property | 1 | — |  |
| 96 | `cause` | property | 1 | — |  |
| 97 | `cause` | property | 1 | — |  |
| 101 | `messageOf` | const | 1 | 2 |  |
| 108 | `errorOf` | function | 7 | 35 |  |
| 121 | `locate` | function | 5 | 3 |  |
| 128 | `reasonOf` | const | 1 | 3 |  |
| 131 | `isCatalogued` | const | 1 | 1 |  |

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
| 33 | `runSteps` | function | 7 | 2 |  |
| 42 | `runPosition` | function | 3 | 1 |  |
| 48 | `invoke` | function | 6 | 1 |  |
| 57 | `settle` | function | 3 | 1 |  |
| 64 | `abortion` | function | 8 | 1 |  |
| 73 | `isAbort` | const | 1 | 1 |  |
| 76 | `inFlightIn` | const | 1 | 1 |  |
| 80 | `report` | function | 7 | 1 |  |
| 91 | `resultHashes` | function | 5 | 1 |  |
| 98 | `phaseResult` | const | 2 | 1 |  |
| 104 | `runPhase` | function | 19 | 1 |  |
| 106 | `reportPhase` | const | 2 | 4 |  |
| 108 | `duration` | const | 1 | 3 |  |
| 125 | `targetPhase` | function | 6 | 1 |  |
| 135 | `extentOfRun` | function | 8 | 1 |  |
| 136 | `rerun` | property | 1 | — |  |
| 140 | `rerun` | property | 1 | — |  |
| 147 | `checkRunInputs` | function | 8 | 1 |  |
| 164 | `execute` | function | 38 | 1 | ✓ |
| 184 | `runPosition` | property | 1 | — |  |

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
| 35 | `labelOf` | const | 1 | 4 |  |
| 39 | `resolveArgs` | const | 2 | 2 |  |
| 45 | `catchWith` | const | 4 | 2 |  |
| 52 | `inputHash` | const | 1 | 1 |  |
| 57 | `withArgs` | const | 16 | 1 | ✓ |
| 74 | `withDebug` | const | 12 | 1 | ✓ |
| 78 | `show` | const | 1 | 3 |  |
| 90 | `labelError` | function | 10 | 1 |  |
| 102 | `withErrorLabel` | const | 4 | 1 |  |
| 109 | `withRunState` | const | 14 | 1 |  |
| 127 | `recordResult` | function | 14 | 1 |  |
| 131 | `record` | const | 1 | 2 |  |
| 142 | `parseTimeUnit` | const | 7 | 1 | ✓ |
| 155 | `withCache` | const | 15 | 1 | ✓ |
| 176 | `check` | function | 12 | 2 |  |
| 177 | `show` | const | 1 | 3 |  |
| 189 | `withPrecheck` | const | 4 | 1 |  |
| 194 | `withPostcheck` | const | 5 | 1 |  |
| 200 | `hasChecks` | const | 1 | 2 |  |
| 202 | `withRateLimit` | const | 2 | 1 | ✓ |
| 205 | `withConcurrency` | const | 2 | 1 |  |
| 208 | `withRetry` | const | 13 | 1 | ✓ |
| 222 | `withTimeout` | const | 12 | 1 | ✓ |
| 237 | `servicePositions` | const | 1 | 2 |  |
| 242 | `holdsCalls` | const | 1 | 2 |  |
| 245 | `wrappersFor` | function | 16 | 1 |  |
| 264 | `wrap` | function | 4 | 1 |  |
| 265 | `serviceCall` | const | 1 | 1 |  |

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
| 69 | `atSite` | const | 1 | 3 |  |
| 72 | `fail` | const | 3 | 25 |  |
| 77 | `isChain` | const | 2 | 3 | ✓ |
| 83 | `parseDescriptor` | function | 16 | 1 |  |
| 101 | `isService` | const | 1 | 1 |  |
| 104 | `missingCapability` | const | 1 | 2 |  |
| 108 | `serviceAt` | function | 8 | 1 |  |
| 120 | `lookedUp` | function | 8 | 1 |  |
| 131 | `declarationAt` | function | 8 | 1 |  |
| 141 | `targetField` | function | 4 | 1 |  |
| 147 | `parseSchemaAt` | function | 7 | 2 |  |
| 157 | `compileValidators` | const | 16 | 1 | ✓ |
| 176 | `compileSettings` | const | 7 | 1 | ✓ |
| 186 | `checkReferences` | function | 18 | 1 |  |
| 189 | `check` | const | 12 | 3 |  |
| 206 | `uniqueReads` | const | 1 | 2 |  |
| 208 | `parseWithSite` | function | 7 | 2 |  |
| 216 | `checkReference` | function | 6 | 1 |  |
| 224 | `declareBinding` | function | 8 | 1 |  |
| 235 | `sitesAt` | const | 4 | 3 |  |
| 243 | `compileSteps` | function | 6 | 3 |  |
| 255 | `compilePosition` | function | 20 | 1 |  |
| 278 | `positionFields` | function | 13 | 1 |  |
| 293 | `compileCall` | function | 51 | 1 |  |
| 345 | `compilePhase` | function | 9 | 1 |  |
| 356 | `compileGlobalCatch` | function | 4 | 1 |  |
| 362 | `compileSelect` | function | 10 | 1 |  |
| 378 | `compile` | function | 32 | 3 | ✓ |

## src/query/forms.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 29 | `canonical` | function | 3 | 11 |  |
| 33 | `canonicalValue` | function | 14 | 4 |  |
| 50 | `hashOf` | const | 1 | 7 |  |
| 53 | `referenceForm` | function | 7 | 1 |  |
| 62 | `argumentsForm` | const | 1 | 1 |  |
| 65 | `stepsForm` | function | 9 | 3 |  |
| 78 | `callForm` | function | 22 | 1 |  |
| 107 | `formsOf` | function | 15 | 2 |  |

## src/query/graph.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 12 | `columnsOf` | function | 19 | 3 |  |
| 33 | `upstreamOf` | function | 10 | 1 |  |
| 35 | `visit` | const | 5 | 2 |  |

## src/query/query.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 15 | `applySelection` | function | 5 | 1 | ✓ |
| 28 | `query` | function | 5 | 1 | ✓ |

## src/query/reference.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 36 | `isReference` | const | 2 | 5 |  |
| 42 | `mapReferences` | const | 6 | 4 |  |
| 50 | `malformation` | const | 6 | 1 |  |
| 57 | `pathOf` | const | 7 | 2 |  |
| 67 | `parseReference` | function | 11 | 4 |  |
| 87 | `enterPosition` | const | 5 | 6 |  |
| 94 | `contextRoot` | const | 4 | 3 |  |
| 103 | `readOf` | function | 5 | 1 |  |
| 112 | `readsOutside` | const | 2 | 1 |  |
| 116 | `resolveRead` | function | 4 | 1 |  |
| 122 | `resolveReference` | function | 4 | 2 |  |

## src/runtime/config.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 33 | `asOAuth` | function | 7 | 1 |  |
| 44 | `configSchemaOf` | const | 1 | 1 |  |
| 47 | `configRefusal` | function | 14 | 2 |  |
| 78 | `constructor` | method | 4 | — | ✓ |
| 84 | `get` | method | 3 | — | ✓ |
| 89 | `set` | method | 9 | — |  |
| 99 | `delete` | method | 5 | — |  |
| 106 | `write` | method | 3 | — |  |
| 110 | `erase` | method | 3 | — |  |

## src/runtime/file-stores.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 12 | `readJson` | const | 8 | 3 |  |
| 22 | `filesIn` | const | 8 | 3 |  |
| 31 | `isExpired` | const | 1 | 1 |  |
| 34 | `sweep` | function | 8 | 1 |  |
| 45 | `fileStore` | function | 27 | 1 |  |
| 46 | `fileOf` | const | 1 | 2 |  |
| 48 | `ready` | const | 1 | 4 |  |
| 52 | `get` | property | 4 | — | ✓ |
| 56 | `set` | property | 5 | — |  |
| 61 | `list` | property | 5 | — |  |
| 67 | `clear` | property | 3 | — |  |
| 77 | `fileStores` | function | 7 | 1 |  |
| 81 | `clear` | property | 1 | — |  |

## src/runtime/runtime.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 47 | `memoryStore` | function | 20 | 1 |  |
| 50 | `get` | property | 3 | — | ✓ |
| 53 | `set` | property | 4 | — |  |
| 57 | `list` | property | 3 | — |  |
| 61 | `clear` | property | 4 | — |  |
| 71 | `scopedStores` | function | 28 | 2 |  |
| 73 | `storeAt` | const | 5 | 4 |  |
| 79 | `get` | property | 1 | — | ✓ |
| 80 | `set` | property | 1 | — |  |
| 81 | `list` | property | 1 | — |  |
| 84 | `clear` | property | 13 | — |  |
| 101 | `memoryStores` | const | 1 | 2 |  |
| 104 | `storeIn` | const | 5 | 2 |  |
| 105 | `get` | property | 1 | — | ✓ |
| 106 | `set` | property | 1 | — |  |
| 107 | `list` | property | 1 | — |  |
| 111 | `constructor` | method | 7 | — | ✓ |
| 125 | `scopeOf` | method | 11 | — |  |
| 129 | `get` | property | 1 | — | ✓ |
| 131 | `call` | property | 1 | — |  |
| 140 | `register` | method | 1 | — |  |
| 144 | `call` | method | 4 | — |  |
| 151 | `tearDown` | method | 3 | — |  |
| 157 | `undefined` | method | 5 | — |  |

## src/runtime/service-registry.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 31 | `release` | const | 1 | 2 |  |
| 37 | `constructor` | method | 7 | — | ✓ |
| 46 | `withoutRun` | method | 3 | — |  |
| 51 | `register` | method | 3 | — |  |
| 55 | `unregister` | method | 3 | — |  |
| 60 | `get` | method | 3 | — | ✓ |
| 65 | `list` | method | 3 | — |  |
| 76 | `instanceOf` | method | 14 | — |  |
| 94 | `tearDown` | method | 4 | — |  |

## src/runtime/table.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 18 | `isWithin` | const | 2 | 1 |  |
| 27 | `constructor` | method | 4 | — | ✓ |
| 34 | `undefined` | method | 8 | — |  |
| 43 | `get` | method | 3 | — | ✓ |
| 47 | `set` | method | 5 | — |  |
| 54 | `list` | method | 3 | — |  |
| 62 | `remove` | method | 4 | — |  |
| 69 | `undefined` | method | 11 | — |  |

## src/service/define-service.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 28 | `isServiceCall` | const | 1 | 1 |  |
| 31 | `serviceCallOf` | function | 4 | 1 |  |
| 37 | `serviceCallsByResource` | function | 8 | 1 |  |
| 46 | `methodsOf` | const | 1 | 1 |  |
| 47 | `nameOf` | const | 1 | 6 |  |
| 50 | `custodyRefusal` | function | 4 | 1 |  |
| 56 | `methodRefusal` | function | 5 | 1 |  |
| 66 | `defineService` | function | 33 | 1 |  |
| 70 | `serviceCallAt` | function | 7 | 2 |  |
| 78 | `supportedCalls` | const | 2 | 1 |  |
| 82 | `init` | function | 8 | 1 |  |
| 86 | `call` | property | 1 | — |  |
| 87 | `tearDown` | property | 1 | — |  |
| 92 | `lookup` | property | 1 | — |  |

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
| 20 | `copyPlain` | const | 2 | 5 |  |
| 24 | `union` | function | 10 | 1 |  |
| 38 | `mergeValues` | function | 9 | 2 |  |
| 48 | `eachItem` | const | 1 | 2 |  |
| 51 | `leaveOut` | function | 5 | 2 |  |
| 59 | `asError` | const | 1 | 2 |  |
| 78 | `init` | property | 3 | — |  |
| 91 | `call` | property | 1 | — |  |
| 103 | `call` | property | 1 | — |  |
| 110 | `call` | property | 1 | — |  |
| 117 | `call` | property | 3 | — |  |
| 130 | `call` | property | 5 | — |  |
| 141 | `call` | property | 1 | — |  |
| 148 | `call` | property | 1 | — |  |
| 154 | `call` | property | 1 | — |  |
| 160 | `call` | property | 1 | — |  |
| 167 | `call` | property | 1 | — |  |
| 174 | `call` | property | 1 | — |  |
| 180 | `call` | property | 1 | — |  |
| 186 | `call` | property | 1 | — |  |
| 193 | `call` | property | 1 | — |  |
| 200 | `call` | property | 1 | — |  |
| 207 | `call` | property | 1 | — |  |
| 219 | `call` | property | 5 | — |  |
| 230 | `call` | property | 4 | — |  |
| 239 | `call` | property | 1 | — |  |
| 248 | `lookup` | property | 4 | — |  |

## src/types/declaration.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 44 | `asFunction` | const | 2 | 2 |  |
| 48 | `refusedFunction` | const | 3 | 1 |  |
| 63 | `reading` | const | 1 | 4 |  |
| 68 | `planned` | property | 1 | — |  |
| 69 | `plannedData` | property | 1 | — |  |
| 74 | `readDocument` | function | 7 | 3 |  |
| 85 | `fieldsIn` | function | 10 | 2 |  |
| 96 | `checkTags` | function | 4 | 1 |  |
| 101 | `tagged` | const | 1 | 2 |  |
| 104 | `atRunTime` | function | 4 | 2 |  |
| 110 | `read` | function | 17 | 1 |  |
| 137 | `readDeclaration` | function | 4 | 2 |  |

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
| 150 | `triggerType` | const | 2 | 1 |  |
| 156 | `inferTypes` | function | 14 | 1 |  |
| 176 | `plan` | function | 35 | 1 |  |

## src/types/sources.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 33 | `refuse` | const | 3 | 2 |  |
| 41 | `path` | property | 1 | — |  |
| 42 | `zodly` | property | 1 | — |  |
| 43 | `pair` | property | 3 | — |  |
| 49 | `onPair` | const | 1 | 3 |  |
| 53 | `resolve` | property | 1 | — |  |
| 54 | `resolve` | property | 1 | — |  |
| 55 | `resolve` | property | 1 | — |  |
| 56 | `resolve` | property | 1 | — |  |
| 59 | `resolve` | property | 1 | — |  |
| 70 | `checkSource` | function | 9 | 3 |  |
| 81 | `resolveSource` | function | 4 | 4 |  |
| 92 | `checkedAsAny` | const | 4 | 1 |  |
| 97 | `resolvedIn` | const | 2 | 2 |  |

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
