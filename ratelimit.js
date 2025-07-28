const timeoutPromise = (timeout) => new Promise((fulfill, _) => setTimeout(fulfill, timeout))

export default class RateLimitedQueue {
  constructor(interval) {
    this.interval = interval
    this.fns = []
    this.executing = false
  }
  push(fn) {
    const promise = new Promise((resolve, reject) => {
      this.fns.push(async () => {
        try {
          resolve(await fn())
        } catch (error) {
          reject(error)
        }
      })
    })
    this._call()
    return promise
  }
  async _call() {
    if (!this.executing && this.fns.length > 0) {
      this.executing = true
      const fn = this.fns.shift()
      await Promise.all([fn(), timeoutPromise(this.interval)])
      this.executing = false
      this._call()
    }
  }
}
