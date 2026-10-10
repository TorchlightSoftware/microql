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
| 18 | `fieldPathOf` | const | 2 | 2 |  |
| 22 | `addressToPath` | function | 8 | 0 |  |
| 31 | `startsWith` | const | 1 | 2 |  |
| 34 | `withField` | const | 1 | 2 |  |
| 38 | `pathToAddress` | function | 12 | 0 |  |

## common.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 14 | `getServiceColorName` | const | 6 | 1 | ✓ |
| 23 | `isPlainObject` | const | 5 | 11 |  |
| 33 | `mapValues` | const | 5 | 11 |  |
| 40 | `filterObject` | const | 2 | 3 |  |
| 44 | `pick` | const | 2 | 6 | ✓ |
| 47 | `omit` | const | 1 | 4 |  |
| 50 | `getIn` | const | 1 | 3 |  |
| 53 | `defaults` | const | 9 | 3 |  |

## compile.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 36 | `fail` | const | 3 | 21 |  |
| 41 | `isChain` | const | 2 | 3 | ✓ |
| 47 | `parseDescriptor` | function | 16 | 1 |  |
| 67 | `lookupAction` | function | 17 | 1 |  |
| 86 | `targetField` | function | 5 | 1 |  |
| 92 | `parseSchemaWithErrorContext` | function | 8 | 3 | ✓ |
| 103 | `compileValidators` | const | 16 | 1 | ✓ |
| 122 | `compileSettings` | const | 8 | 1 | ✓ |
| 133 | `checkReferences` | function | 16 | 1 |  |
| 135 | `check` | const | 11 | 3 |  |
| 150 | `parseWithSite` | function | 7 | 2 |  |
| 158 | `checkReference` | function | 8 | 1 |  |
| 168 | `declareBinding` | function | 8 | 1 |  |
| 179 | `sitesAt` | const | 4 | 3 |  |
| 187 | `compileSteps` | function | 6 | 3 |  |
| 199 | `compilePosition` | function | 23 | 1 |  |
| 224 | `positionFields` | function | 10 | 1 |  |
| 236 | `compileCall` | function | 45 | 1 |  |
| 282 | `compilePhase` | function | 9 | 1 |  |
| 293 | `compileGlobalOnError` | function | 4 | 1 |  |
| 299 | `compileSelect` | function | 10 | 1 |  |
| 314 | `compile` | function | 32 | 2 | ✓ |

## concurrency.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 10 | `concurrencyLimit` | function | 27 | 1 |  |
| 14 | `acquire` | const | 7 | 1 |  |
| 22 | `release` | const | 5 | 1 |  |

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
| 29 | `canonical` | function | 3 | 5 |  |
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

## node.js

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
| 22 | `typeOfArgument` | function | 10 | 3 |  |
| 33 | `describeType` | const | 1 | 3 |  |
| 37 | `checkType` | function | 5 | 2 |  |
| 43 | `stepsTypes` | function | 5 | 2 |  |
| 51 | `callTypes` | function | 23 | 1 |  |
| 78 | `triggerType` | const | 2 | 1 |  |
| 81 | `inferTypes` | function | 12 | 1 |  |
| 99 | `plan` | function | 35 | 0 |  |

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

## services/util.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 13 | `isFailure` | const | 1 | 3 |  |
| 14 | `successes` | const | 1 | 4 |  |
| 17 | `filterHidden` | const | 9 | 2 | ✓ |
| 29 | `copyPlain` | const | 2 | 5 |  |
| 33 | `union` | function | 10 | 1 |  |
| 47 | `mergeValues` | function | 9 | 2 |  |
| 57 | `truncate` | const | 2 | 1 | ✓ |
| 62 | `init` | property | 3 | — |  |
| 69 | `/each` | property | 6 | — |  |
| 79 | `/filter` | property | 5 | — |  |
| 89 | `/removeErrors` | property | 3 | — |  |
| 96 | `/removeNulls` | property | 3 | — |  |
| 103 | `/removeSuccesses` | property | 3 | — |  |
| 110 | `/partitionErrors` | property | 3 | — |  |
| 117 | `/concat` | property | 3 | — |  |
| 124 | `/when` | property | 3 | — |  |
| 128 | `/eq` | property | 3 | — |  |
| 132 | `/gt` | property | 3 | — |  |
| 136 | `/lt` | property | 3 | — |  |
| 143 | `/exists` | property | 3 | — |  |
| 150 | `/length` | property | 3 | — |  |
| 157 | `/pick` | property | 3 | — |  |
| 164 | `/merge` | property | 3 | — |  |
| 171 | `/print` | property | 10 | — |  |
| 185 | `/recordFailure` | property | 13 | — |  |
| 203 | `/template` | property | 3 | — |  |
| 273 | `comparison` | const | 1 | 3 |  |

## types.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 25 | `typeOfSchema` | function | 5 | 8 |  |
| 31 | `convertSchema` | function | 9 | 1 |  |
| 42 | `typeOfValue` | function | 10 | 6 |  |
| 54 | `listOf` | function | 5 | 2 |  |
| 61 | `typeAtPath` | function | 7 | 1 |  |
| 71 | `satisfies` | function | 6 | 2 |  |

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
| 238 | `holdsCalls` | const | 1 | 1 |  |
| 241 | `wrappersFor` | function | 16 | 1 |  |
| 259 | `wrap` | function | 4 | 1 |  |
| 260 | `action` | const | 1 | 1 |  |
<!-- /generated:function-names -->
