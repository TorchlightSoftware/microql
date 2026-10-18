/**
 * @fileoverview The concurrency limiter — a cap on calls in flight at once.
 *
 * Inferred parallelism can exceed what a platform allows (a Worker permits six
 * connections awaiting response headers), and would otherwise queue silently.
 * A freed slot passes straight to the next waiting call, so the cap holds.
 */

// A function that runs `fn` once fewer than `max` calls are in flight.
export function concurrencyLimit(max) {
  let active = 0
  const waiting = []

  const acquire = () => {
    if (active < max) {
      active++
      return Promise.resolve()
    }
    return new Promise(resolve => waiting.push(resolve))
  }

  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  return async (fn) => {
    await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}
