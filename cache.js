import {createHash} from 'crypto'
import {readFile, writeFile, utimes, mkdir, readdir, stat, unlink} from 'fs/promises'
import {existsSync} from 'fs'
import path from 'path'

const parseTimeUnit = (timeStr) => {
  const match = timeStr.match(/^(\d+)([smhDM])$/)
  if (!match) throw new Error(`Invalid time format: ${timeStr}`)
  const [, amount, unit] = match
  const multipliers = {s: 1000, m: 60000, h: 3600000, D: 86400000, M: 2592000000}
  return parseInt(amount) * multipliers[unit]
}

export default class Cache {
  constructor(cacheConfig = {}) {
    this.baseDir = cacheConfig.configDir || cacheConfig.baseDir || '.cache'
    this.invalidateAfter = cacheConfig.invalidateAfter
    this.memoryCache = new Map()
    this.pendingPromises = new Map()
    if (!existsSync(this.baseDir)) mkdir(this.baseDir, {recursive: true}).catch(() => {})
    this.cleanupByModifiedTime().catch(() => {})
  }

  generateKey(serviceName, action, args) {
    return createHash('md5').update(JSON.stringify({serviceName, action, args}, null, 0)).digest('hex')
  }

  async getOrCompute(serviceName, action, args, computeFn) {
    const key = this.generateKey(serviceName, action, args)

    // check memory cache and pending promises
    if (this.memoryCache.has(key)) return this.memoryCache.get(key)
    if (this.pendingPromises.has(key)) return await this.pendingPromises.get(key)

    const computePromise = (async () => {
      const dir = path.join(this.baseDir, `${serviceName}-${action}`)
      const file = path.join(dir, `${key}.json`)

      // check disk cache
      try {
        const cached = JSON.parse(await readFile(file, 'utf8'))
        this.memoryCache.set(key, cached.result)
        utimes(file, new Date(), new Date()).catch(() => {})
        return cached.result

      // run the service normally and cache it
      } catch {
        const result = await computeFn()
        this.memoryCache.set(key, result)

        if (!existsSync(dir)) await mkdir(dir, {recursive: true})
        await writeFile(file, JSON.stringify({created: new Date().toISOString(), result}, null, 2))

        return result
      } finally {
        this.pendingPromises.delete(key)

        // Run cleanup if invalidateAfter is specified
        // TODO: this probably shouldn't run after every request
        // Maybe it should during tearDown at the end of the query
        if (this.invalidateAfter) {
          this.cleanupExpired(this.invalidateAfter)
        }
      }
    })()

    // add promises to a map in case another service is called with the same args
    this.pendingPromises.set(key, computePromise)
    return await computePromise
  }

  async cleanupExpired(invalidateAfter) {
    if (!invalidateAfter) return
    const cutoff = Date.now() - parseTimeUnit(invalidateAfter)
    await this.cleanup(async (filePath) => {
      const cached = JSON.parse(await readFile(filePath, 'utf8'))
      return new Date(cached.created).getTime() < cutoff
    })
  }

  async cleanupByModifiedTime() {
    const oneWeekAgo = Date.now() - 604800000
    await this.cleanup(async (filePath) => {
      const fileStat = await stat(filePath)
      return fileStat.mtime.getTime() < oneWeekAgo
    })
  }

  async cleanup(shouldDelete) {
    try {
      const serviceDirs = await readdir(this.baseDir)
      for (const serviceDir of serviceDirs) {
        const fullServiceDir = path.join(this.baseDir, serviceDir)
        if (!(await stat(fullServiceDir)).isDirectory()) continue

        const files = await readdir(fullServiceDir)
        for (const file of files.filter(f => f.endsWith('.json'))) {
          const filePath = path.join(fullServiceDir, file)
          try {
            if (await shouldDelete(filePath)) await unlink(filePath)
          } catch {
            await unlink(filePath)
          }
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
