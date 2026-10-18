# MicroQL 1.0 performance: engine overhead vs 0.6.6

0.6.6 is commit `836d9bf`, the last release before the 1.0 rewrite. Services in the benchmark answer instantly, so the time measured is MicroQL's own.

## Summary

- **Per-call engine overhead is now 2–5× 0.6.6, down from 4–12×.** It's still microseconds: an `each` over 1000 `util` calls takes about 15ms (0.6.6: 3ms, before: 33ms).
- **making SHA-256 synchronous was a significant improvement** Web Crypto's `digest` is always async. Most of each digest's cost was promise handling, argument checks and a hop to another thread, not hashing. The hop also made every call yield to the event loop, which hurt sequential chains most. `hashOf` now uses `@noble/hashes` (pure JS, audited, no dependencies of its own, runs on node, workerd and in browsers).  `formsOf` and `plan()` are now synchronous.
- **The store contract is unchanged.** Entries are still keyed by (form hash, input hash).
- **Some performance hits were necessary to adapt to cloud storage and the new feature set.** Per service call, 1.0 also canonicalizes and hashes the inputs, reads and writes the Run State with timing, and tracks the call for de-duplication and settling. That work buys resume, phase reruns, the Builder's results view, and identical calls running once.

## Current results

<!-- generated:bench-results -->
Measured 2026-10-18: node v22.13.0, 8 cores, Linux 6.18.49-1-MANJARO. Range of 5 runs, each the median of 7 warm runs after one warm-up, in µs per call.

| Workload | Calls | 0.6.6 | this checkout |
|---|---|---|---|
| 200 independent phases | 200 | 24–31 | 72–81 |
| each over 1000 items | 1000 | 3 | 17–23 |
| chain of 100 steps | 100 | 20–26 | 49–70 |
<!-- /generated:bench-results -->

## History

Measured on 2026-10-09 (node v22.13.0, 8 cores, Linux 6.18), in µs per call, each a range of 3–5 runs. "1.0 before" is `e91e1f6`. "Sync hash" is the change that made hashing synchronous. "No lodash" adds replacing lodash with the plain-data helpers in `common.js`. When a change moves these numbers, add a column.

| Workload | Calls | 0.6.6 | 1.0 before | sync hash | no lodash |
|---|---|---|---|---|---|
| 200 independent phases | 200 | 25–30 | 118–137 | 63–81 | 61–66 |
| `each` over 1000 items | 1000 | 3 | 30–37 | 12–16 | 15–19 |
| chain of 100 steps | 100 | 20–27 | 148–180 | 48–50 | 37–51 |

Measured on 2026-10-18 (same machine), 5 runs each. By then the benchmark's `add1` declared its target as `['number', {tags: ['target']}]`, since `target` had become a tag, not a type. "Scope schema read once" is the change that made each scoped table parse its scope schema once, not on every access. "Declaration read once" is the change that made compile read each service call's declaration once, however many calls name it.

| Workload | Calls | 1.2.0 | 1.3.0 | scope schema read once | declaration read once |
|---|---|---|---|---|---|
| 200 independent phases | 200 | 58–71 | 156–188 | 69–79 | 72–81 |
| `each` over 1000 items | 1000 | 13–18 | 51–58 | 18–20 | 17–23 |
| chain of 100 steps | 100 | 154–165 | 208–258 | 163–183 | 49–70 |

**1.3.0 tripled per-call overhead, by reading the scope schema on every service call.** Each scoped table checked its scope with zodly's `validate`, which parses the schema into a fresh zod schema each time, and zod compiles each new schema before its first parse. That was about 40% of the profile. Reading it once per table brings 1.3.0 back to about 1.2.0's numbers: within 15%, the benchmark's noise. What's left of the scope's cost is canonicalizing it, to key the tables and Run States, on each access.

**The chain of 100 steps had been 3–4× slower since 2026-10-09, because each call read its declaration afresh.** Every call site built its own zod schemas from its service's declaration while compiling, and zod compiled each run-time schema on its first and only check. A chain is 100 call sites of one declaration, so it paid that 100 times per Query; the other workloads call a service that declares nothing. Reading a declaration once, shared by every call that names it, brings the chain back to its 2026-10-09 numbers.

**Dropping lodash was about neutral for speed.** lodash's own CPU time was 11.7% of the profile; the helpers that replace it take 4.6%. That saving is within the benchmark's ±15% noise. What it buys is one less dependency, about 70KB less in a Workers bundle, and helpers that do only what core needs.

## Where the remaining time goes

CPU profile of `npm run bench`, sampled every 50µs. Shares are inclusive (including what each function calls), so they overlap:

| Share | What |
|---|---|
| ~21% | `hashOf`: canonical JSON (~6%), UTF-8 encoding (~2%), SHA-256 itself (~5%) |
| ~16% | `compile`, run once per Query. `compileSettings` and `compileValidators` (zod schemas) are the largest parts |
| ~13% | `formsOf`, run once per Run, and mostly its hashing |
| ~8% | module loading, an artefact of the benchmark |
| rest | Run State entries (`recordResult`: dates, ISO strings, store writes), the wrapper chain's promises, garbage collection |

## Candidates not yet taken

- **Key the scope once per Query.** Run State and table accesses each canonicalize their scope to key it, about 8% of the `each` profile. Keying by the scope object's identity would skip that, but would go wrong if a platform changed a scope object after using it.
- **Let `execute` accept the forms `plan()` already computed.** Less pressing now that forms are synchronous and cheap.

Rejected:
- **Moving input hashing into the stores.** It changes the entry-store contract from input hash to input key, and makes every persistent store hash for itself. A synchronous hash in core gets the same gain.
- **No Run State for plain `query()`.** That reaches parity, but drops "identical calls run once".
- **Skipping input hashing when the Run State lives only in memory.** Canonical JSON would still be needed as the key, so it saves about 7%, and only on the CLI path. It would mean keying the Run State two ways.
- **Removing more async.** The entry-store contract is async on purpose, and the remaining async wrappers are worth an estimated 5–10% at most.

## Regenerating This File

- `npm run docs:bench` reruns the benchmark 5 times against this checkout and against 0.6.6, each run in a fresh process, and rewrites only the **Current results** section. On first use it extracts 0.6.6 from git into the system temp directory and installs its dependencies, which needs the network. It takes about a minute.
- `npm run bench` prints one run for this checkout, for a quick check while working.
- The **History** table, the summary and the profile breakdown are written by hand: they record judgments, not just measurements.
- To profile, run `node --cpu-prof --cpu-prof-interval 50 scripts/bench.js`, open the `.cpuprofile` in Chrome DevTools, then delete it.

Results vary by about ±15% between runs, so compare ranges, not single numbers.
