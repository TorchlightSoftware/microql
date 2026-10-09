# MicroQL core — function names by file

Every named function in core: `function` declarations, `const` function values, object properties (util resources, store methods) and class methods. Anonymous inline callbacks are not listed.

- **lines** — length of the definition
- **refs** — references to the name in core: in its own file, plus in files that import it. 0 means public API used only by callers outside core (tests, hosts). Properties and methods are dispatched by name at run time, so their refs are not meaningful.
- **0.6** — the name also appears in 0.6.6 core (`836d9bf`)

## addresses.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 18 | `fieldPathOf` | const | 2 | 2 |  |
| 22 | `addressToPath` | function | 8 | 0 |  |
| 31 | `startsWith` | const | 1 | 2 | ✓ |
| 34 | `withField` | const | 1 | 2 |  |
| 38 | `pathToAddress` | function | 12 | 0 |  |

## common.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 9 | `getServiceColorName` | const | 6 | 1 | ✓ |

## compile.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 37 | `fail` | const | 3 | 21 |  |
| 42 | `isChain` | const | 2 | 3 | ✓ |
| 45 | `isPlainObject` | const | 1 | 4 |  |
| 49 | `parseDescriptor` | function | 16 | 1 |  |
| 69 | `lookupAction` | function | 17 | 1 |  |
| 88 | `targetField` | function | 5 | 1 |  |
| 94 | `parseSchemaWithErrorContext` | function | 8 | 2 | ✓ |
| 104 | `compileValidators` | const | 16 | 1 | ✓ |
| 123 | `compileSettings` | const | 8 | 1 | ✓ |
| 134 | `checkReferences` | function | 16 | 1 |  |
| 136 | `check` | const | 11 | 3 | ✓ |
| 151 | `parseWithSite` | function | 7 | 2 |  |
| 159 | `checkReference` | function | 8 | 1 |  |
| 169 | `declareBinding` | function | 8 | 1 |  |
| 180 | `sitesAt` | const | 4 | 3 |  |
| 188 | `compileSteps` | function | 6 | 3 |  |
| 200 | `compilePosition` | function | 23 | 1 |  |
| 225 | `positionFields` | function | 10 | 1 |  |
| 237 | `compileCall` | function | 45 | 1 |  |
| 283 | `compilePhase` | function | 9 | 1 |  |
| 294 | `compileGlobalOnError` | function | 4 | 1 |  |
| 300 | `compileSelect` | function | 10 | 1 |  |
| 315 | `compile` | function | 30 | 3 | ✓ |

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
| 66 | `invoke` | function | 6 | 1 |  |
| 75 | `settle` | function | 3 | 2 |  |
| 81 | `report` | function | 7 | 1 |  |
| 91 | `runPhase` | function | 18 | 1 |  |
| 93 | `reportPhase` | const | 2 | 3 |  |
| 95 | `duration` | const | 1 | 2 | ✓ |
| 111 | `targetPhase` | function | 7 | 1 |  |
| 122 | `scopeOfRun` | function | 8 | 1 |  |
| 123 | `rerun` | property | 1 | — |  |
| 127 | `rerun` | property | 1 | — |  |
| 132 | `handleGlobalError` | function | 11 | 1 |  |
| 152 | `execute` | function | 39 | 2 | ✓ |
| 170 | `runPosition` | property | 1 | — |  |

## forms.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 23 | `isPlainObject` | const | 1 | 2 |  |
| 27 | `canonical` | function | 3 | 1 | ✓ |
| 31 | `canonicalValue` | function | 13 | 4 |  |
| 46 | `hashOf` | function | 5 | 4 |  |
| 53 | `referenceForm` | function | 7 | 1 |  |
| 62 | `argumentsForm` | const | 6 | 3 |  |
| 70 | `stepsForm` | function | 9 | 3 |  |
| 83 | `callForm` | function | 21 | 1 |  |
| 109 | `formsOf` | function | 18 | 2 |  |

## graph.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 10 | `columnsOf` | function | 19 | 3 |  |
| 31 | `upstreamOf` | function | 10 | 1 |  |
| 33 | `visit` | const | 5 | 2 |  |

## node.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 28 | `readJson` | const | 8 | 3 |  |
| 38 | `filesIn` | const | 8 | 3 |  |
| 47 | `isExpired` | const | 1 | 1 |  |
| 50 | `sweep` | function | 8 | 1 |  |
| 61 | `fileStore` | function | 23 | 1 |  |
| 62 | `fileOf` | const | 1 | 2 |  |
| 64 | `ready` | const | 1 | 4 | ✓ |
| 68 | `get` | property | 4 | — | ✓ |
| 72 | `set` | property | 5 | — | ✓ |
| 77 | `list` | property | 5 | — | ✓ |
| 85 | `print` | function | 5 | 2 | ✓ |
| 91 | `recordFailure` | function | 6 | 2 | ✓ |
| 106 | `query` | function | 3 | 0 | ✓ |

## plan.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 22 | `typeOfArgument` | function | 10 | 3 |  |
| 33 | `describeType` | const | 1 | 3 |  |
| 35 | `warnUnless` | function | 5 | 2 |  |
| 41 | `stepsTypes` | function | 5 | 2 |  |
| 49 | `callTypes` | function | 23 | 1 |  |
| 74 | `inferTypes` | function | 12 | 1 |  |
| 92 | `plan` | function | 34 | 0 | ✓ |

## query.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 14 | `applySelection` | function | 5 | 1 | ✓ |
| 26 | `query` | function | 5 | 2 | ✓ |

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
| 39 | `malformation` | const | 8 | 1 |  |
| 48 | `pathOf` | const | 7 | 2 |  |
| 58 | `parseReference` | function | 11 | 4 |  |
| 76 | `enterPosition` | const | 5 | 4 |  |
| 83 | `scopedRoot` | const | 4 | 3 |  |
| 89 | `resolveReference` | function | 4 | 2 |  |

## runtime.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 19 | `memoryStore` | function | 15 | 2 |  |
| 22 | `get` | property | 3 | — | ✓ |
| 25 | `set` | property | 4 | — | ✓ |
| 29 | `list` | property | 3 | — | ✓ |
| 36 | `print` | property | 1 | — | ✓ |
| 37 | `inspect` | property | 1 | — | ✓ |
| 38 | `recordFailure` | property | 1 | — | ✓ |

## types.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 24 | `typeOfSchema` | function | 5 | 7 |  |
| 30 | `convertSchema` | function | 9 | 1 |  |
| 41 | `typeOfValue` | function | 10 | 6 |  |
| 53 | `listOf` | function | 5 | 2 |  |
| 60 | `typeAtPath` | function | 7 | 1 |  |
| 70 | `satisfies` | function | 6 | 2 |  |

## validation.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 47 | `showAsJson` | const | 1 | 1 |  |
| 53 | `formatError` | function | 34 | 1 | ✓ |
| 91 | `validate` | function | 10 | 2 | ✓ |
| 107 | `parseSchema` | function | 10 | 2 | ✓ |
| 118 | `parseSchemaRecursive` | function | 116 | 7 | ✓ |
| 235 | `applyModifiers` | function | 16 | 8 | ✓ |
| 252 | `transformObjectShape` | const | 1 | 2 | ✓ |

## wrappers.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 23 | `isPlainObject` | const | 1 | 1 |  |
| 26 | `labelOf` | const | 1 | 5 |  |
| 30 | `resolveArgs` | const | 6 | 4 |  |
| 39 | `withArgs` | const | 12 | 1 | ✓ |
| 52 | `withDebug` | const | 12 | 1 | ✓ |
| 56 | `show` | const | 1 | 3 |  |
| 66 | `labelError` | function | 8 | 1 |  |
| 77 | `recover` | function | 21 | 1 |  |
| 99 | `withErrorHandling` | const | 8 | 1 | ✓ |
| 110 | `withRunState` | const | 12 | 1 |  |
| 123 | `recordResult` | function | 14 | 1 |  |
| 138 | `parseTimeUnit` | const | 7 | 1 | ✓ |
| 151 | `withCache` | const | 14 | 1 | ✓ |
| 168 | `check` | function | 13 | 2 | ✓ |
| 169 | `show` | const | 1 | 3 |  |
| 182 | `withPrecheck` | const | 4 | 1 |  |
| 187 | `withPostcheck` | const | 5 | 1 |  |
| 193 | `hasChecks` | const | 1 | 2 |  |
| 195 | `withRateLimit` | const | 2 | 1 | ✓ |
| 198 | `withConcurrency` | const | 2 | 1 |  |
| 201 | `withRetry` | const | 13 | 1 | ✓ |
| 215 | `withTimeout` | const | 12 | 1 | ✓ |
| 230 | `holdsCalls` | const | 1 | 1 |  |
| 233 | `wrappersFor` | function | 16 | 1 |  |
| 251 | `wrap` | function | 4 | 1 | ✓ |
| 252 | `action` | const | 1 | 1 | ✓ |

## services/util.js

| line | name | kind | lines | refs | 0.6 |
|---|---|---|---|---|---|
| 12 | `isFailure` | const | 1 | 3 |  |
| 13 | `successes` | const | 1 | 4 | ✓ |
| 16 | `filterHidden` | const | 9 | 2 | ✓ |
| 26 | `truncate` | const | 2 | 1 | ✓ |
| 31 | `init` | property | 3 | — |  |
| 38 | `/each` | property | 6 | — |  |
| 48 | `/filter` | property | 5 | — |  |
| 58 | `/removeErrors` | property | 3 | — |  |
| 65 | `/removeNulls` | property | 3 | — |  |
| 72 | `/removeSuccesses` | property | 3 | — |  |
| 79 | `/partitionErrors` | property | 3 | — |  |
| 86 | `/concat` | property | 3 | — |  |
| 93 | `/when` | property | 3 | — |  |
| 97 | `/eq` | property | 3 | — |  |
| 101 | `/gt` | property | 3 | — |  |
| 105 | `/lt` | property | 3 | — |  |
| 112 | `/exists` | property | 3 | — |  |
| 119 | `/length` | property | 3 | — |  |
| 126 | `/pick` | property | 3 | — |  |
| 133 | `/merge` | property | 3 | — |  |
| 140 | `/print` | property | 10 | — |  |
| 154 | `/recordFailure` | property | 13 | — |  |
| 172 | `/template` | property | 3 | — |  |
| 242 | `comparison` | const | 1 | 3 | ✓ |
