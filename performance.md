# MicroQL 1.0 performance: engine overhead vs 0.6.6

Measured on 2026-10-09: node v22.13.0, 8 cores, Linux 6.18. 0.6.6 is commit `836d9bf`. "Before" is `e91e1f6`; "after" is the change that made hashing synchronous.

## Summary

- **Per-call engine overhead is now 2–5× 0.6.6, down from 4–12×.** It's still microseconds: an `each` over 1000 `util` calls takes 14ms (0.6.6: 3ms, before: 33ms).
- **The win came from making SHA-256 synchronous.** Web Crypto's `digest` is always async. Most of each digest's cost was promise handling, argument checks and a hop to another thread, not hashing. The hop also made every call yield to the event loop, which hurt sequential chains most. `hashOf` now uses `@noble/hashes` (pure JS, audited, no dependencies of its own, runs on node, workerd and in browsers). It gives the same hex digests, so stored Run State and Cache entries stay valid. `formsOf` and `plan()` are now synchronous.
- **The store contract is unchanged.** Entries are still keyed by (form hash, input hash).
- **Parity still isn't reachable while the Run State is on.** Per call, 1.0 also canonicalizes and hashes the inputs, reads and writes the Run State with timing, and tracks the call for de-duplication and settling. That work buys resume, phase reruns, the Builder's results view, and identical calls running once.

## Results

Services answer instantly, so the time measured is MicroQL's own. Each figure is a median of 7 warm runs after one warm-up, as µs per call, from `npm run bench`. The range covers 3–5 runs.

| Workload | Calls | 0.6.6 | 1.0 before | 1.0 after |
|---|---|---|---|---|
| 200 independent phases | 200 | 25–30 | 118–137 | 63–81 |
| `each` over 1000 items | 1000 | 3 | 30–37 | 12–16 |
| chain of 100 steps | 100 | 20–27 | 148–180 | 48–50 |

## Where the remaining time goes

CPU profile of `npm run bench`, sampled every 50µs. Shares are inclusive (including what each function calls), so they overlap:

| Share | What |
|---|---|
| ~21% | `hashOf`: canonical JSON (~6%), UTF-8 encoding (~2%), SHA-256 itself (~5%) |
| ~16% | `compile`, run once per Query. `compileSettings` (lodash `omit`/`defaults`) and `compileValidators` (zod schemas) are the largest parts |
| ~13% | `formsOf`, run once per Run, and mostly its hashing |
| ~8% | module loading, an artefact of the benchmark |
| rest | Run State entries (`recordResult`: dates, ISO strings, store writes), the wrapper chain's promises, garbage collection |

## Candidates not yet taken

- **Shallow `omit` in compile and forms.** lodash's `omit` collects inherited and symbol keys and unsets paths one by one. It's ~5% here, mostly in `compileSettings`.
- **Let `execute` accept the forms `plan()` already computed.** Less pressing now that forms are synchronous and cheap.

Rejected:
- **Moving input hashing into the stores.** It changes the entry-store contract from input hash to input key, and makes every persistent store hash for itself. A synchronous hash in core gets the same gain.
- **No Run State for plain `query()`.** That reaches parity, but drops "identical calls run once".

## How to reproduce

```bash
cd ~/projects/tlsft/internal/microql
npm run bench                     # this checkout

# 0.6.6: extract it next to the repo (git archive reads the commit without touching the working tree)
mkdir -p /tmp/microql-bench/old-full
git archive 836d9bf | tar -x -C /tmp/microql-bench/old-full
(cd /tmp/microql-bench/old-full && npm ci --ignore-scripts --no-audit --no-fund)
(cd /tmp/microql-bench/old-full && node ~/projects/tlsft/internal/microql/scripts/bench.js old query.js && rm -rf .cache)
```

Results vary by about ±15% between runs, so compare medians of several. To profile, run `node --cpu-prof --cpu-prof-interval 50 scripts/bench.js` and open the `.cpuprofile` in Chrome DevTools.
