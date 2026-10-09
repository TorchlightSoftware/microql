# MicroQL 1.0 performance: engine overhead vs 0.6.6

0.6.6 is commit `836d9bf`, the last release before the 1.0 rewrite. Services in the benchmark answer instantly, so the time measured is MicroQL's own.

## Summary

- **Per-call engine overhead is now 2–5× 0.6.6, down from 4–12×.** It's still microseconds: an `each` over 1000 `util` calls takes about 15ms (0.6.6: 3ms, before: 33ms).
- **making SHA-256 synchronous was a significant improvement** Web Crypto's `digest` is always async. Most of each digest's cost was promise handling, argument checks and a hop to another thread, not hashing. The hop also made every call yield to the event loop, which hurt sequential chains most. `hashOf` now uses `@noble/hashes` (pure JS, audited, no dependencies of its own, runs on node, workerd and in browsers).  `formsOf` and `plan()` are now synchronous.
- **The store contract is unchanged.** Entries are still keyed by (form hash, input hash).
- **Some performance hits were necessary to adapt to cloud storage and the new feature set.** Per service call, 1.0 also canonicalizes and hashes the inputs, reads and writes the Run State with timing, and tracks the call for de-duplication and settling. That work buys resume, phase reruns, the Builder's results view, and identical calls running once.

## Current results

<!-- generated:bench-results -->
Measured 2026-10-09: node v22.13.0, 8 cores, Linux 6.18.49-1-MANJARO. Range of 5 runs, each the median of 7 warm runs after one warm-up, in µs per call.

| Workload | Calls | 0.6.6 | this checkout |
|---|---|---|---|
| 200 independent phases | 200 | 25–30 | 55–69 |
| each over 1000 items | 1000 | 3–4 | 15–18 |
| chain of 100 steps | 100 | 21–31 | 38–42 |
<!-- /generated:bench-results -->

## History

Measured on 2026-10-09 (node v22.13.0, 8 cores, Linux 6.18), in µs per call, each a range of 3–5 runs. "1.0 before" is `e91e1f6`. "Sync hash" is the change that made hashing synchronous. "No lodash" adds replacing lodash with the plain-data helpers in `common.js`. When a change moves these numbers, add a column.

| Workload | Calls | 0.6.6 | 1.0 before | sync hash | no lodash |
|---|---|---|---|---|---|
| 200 independent phases | 200 | 25–30 | 118–137 | 63–81 | 61–66 |
| `each` over 1000 items | 1000 | 3 | 30–37 | 12–16 | 15–19 |
| chain of 100 steps | 100 | 20–27 | 148–180 | 48–50 | 37–51 |

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
