import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import query from '../query.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testSnapshotPath = path.join(__dirname, 'test-snapshot.json')

describe('Snapshot Tests', () => {
  
  afterEach(async () => {
    // Clean up test snapshot files
    try {
      await fs.remove(testSnapshotPath)
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  describe('Partial Query Execution', () => {
    
    it('should save and restore query execution state', async () => {
      // First run: execute up to intermediate step
      const result1 = await query({
        snapshot: testSnapshotPath,
        given: { input: 'test' },
        services: {
          step1: { async process({ data }) { return `step1-${data}` } },
          step2: { async process({ data }) { return `step2-${data}` } },
          step3: { async process({ data }) { return `step3-${data}` } }
        },
        query: {
          intermediate: ['step1', 'process', { data: '$.given.input' }],
          processed: ['step2', 'process', { data: '$.intermediate' }],
          // step3 intentionally not included in first run
        }
      })
      
      // Verify first run results
      assert.strictEqual(result1.intermediate, 'step1-test')
      assert.strictEqual(result1.processed, 'step2-step1-test')
      assert.strictEqual(result1.final, undefined) // Not executed yet
      
      // Verify snapshot was created
      assert(await fs.pathExists(testSnapshotPath))
      
      // Second run: add final step and resume from snapshot
      const result2 = await query({
        snapshot: testSnapshotPath,
        given: { input: 'test' },
        services: {
          step1: { async process({ data }) { return `step1-${data}` } },
          step2: { async process({ data }) { return `step2-${data}` } },
          step3: { async process({ data }) { return `step3-${data}` } }
        },
        query: {
          intermediate: ['step1', 'process', { data: '$.given.input' }],
          processed: ['step2', 'process', { data: '$.intermediate' }],
          final: ['step3', 'process', { data: '$.processed' }] // New query
        }
      })
      
      // Verify that previous results were restored and new query executed
      assert.strictEqual(result2.intermediate, 'step1-test') // From snapshot
      assert.strictEqual(result2.processed, 'step2-step1-test') // From snapshot
      assert.strictEqual(result2.final, 'step3-step2-step1-test') // Newly executed
    })
    
    it('should handle partial chain execution', async () => {
      let step2Called = false
      let step3Called = false
      
      // First run: execute chain partially
      const result1 = await query({
        snapshot: testSnapshotPath,
        given: { input: ['a', 'b'] },
        services: {
          processor: {
            async step1({ data }) { return data.map(x => `1-${x}`) },
            async step2({ data }) { 
              step2Called = true
              return data.map(x => `2-${x}`) 
            },
            async step3({ data }) { 
              step3Called = true
              return data.map(x => `3-${x}`) 
            }
          }
        },
        query: {
          result: [
            ['processor', 'step1', { data: '$.given.input' }],
            // step2 and step3 intentionally not included in first run
          ]
        }
      })
      
      // Verify first run
      assert.deepStrictEqual(result1.result, ['1-a', '1-b'])
      assert.strictEqual(step2Called, false)
      assert.strictEqual(step3Called, false)
      
      // Reset flags
      step2Called = false
      step3Called = false
      
      // Second run: extend the chain
      const result2 = await query({
        snapshot: testSnapshotPath,
        given: { input: ['a', 'b'] },
        services: {
          processor: {
            async step1({ data }) { 
              // Should not be called again
              throw new Error('step1 should not be re-executed')
            },
            async step2({ data }) { 
              step2Called = true
              return data.map(x => `2-${x}`) 
            },
            async step3({ data }) { 
              step3Called = true
              return data.map(x => `3-${x}`) 
            }
          }
        },
        query: {
          result: [
            ['processor', 'step1', { data: '$.given.input' }],
            ['processor', 'step2', { data: '@' }], // Resume from here
            ['processor', 'step3', { data: '@' }]
          ]
        }
      })
      
      // Verify that only new steps were executed
      assert.deepStrictEqual(result2.result, ['3-2-1-a', '3-2-1-b'])
      assert.strictEqual(step2Called, true) // Should have been called
      assert.strictEqual(step3Called, true) // Should have been called
    })
    
    it('should not save usedServices in snapshots', async () => {
      // Run query with snapshot
      await query({
        snapshot: testSnapshotPath,
        services: {
          testService: { async test() { return 'result' } }
        },
        query: {
          test: ['testService', 'test', {}]
        }
      })
      
      // Read the snapshot file
      const snapshotData = await fs.readJson(testSnapshotPath)
      
      // Verify usedServices is not saved
      assert.strictEqual(snapshotData.ast.usedServices, undefined)
      
      // But verify the AST structure is otherwise complete
      assert(snapshotData.ast.queries)
      assert(snapshotData.ast.queries.test)
      assert.strictEqual(snapshotData.ast.queries.test.completed, true)
      assert.strictEqual(snapshotData.ast.queries.test.value, 'result')
    })
    
    it('should work with select parameter', async () => {
      // First run: partial execution with select
      const result1 = await query({
        snapshot: testSnapshotPath,
        given: { input: 'test' },
        services: {
          step1: { async process({ data }) { return `step1-${data}` } },
          step2: { async process({ data }) { return `step2-${data}` } }
        },
        query: {
          intermediate: ['step1', 'process', { data: '$.given.input' }],
          processed: ['step2', 'process', { data: '$.intermediate' }]
        },
        select: 'intermediate'
      })
      
      // Should return only the selected query
      assert.strictEqual(result1, 'step1-test')
      
      // Second run: different select should work with restored state
      const result2 = await query({
        snapshot: testSnapshotPath,
        given: { input: 'test' },
        services: {
          step1: { async process({ data }) { return `step1-${data}` } },
          step2: { async process({ data }) { return `step2-${data}` } }
        },
        query: {
          intermediate: ['step1', 'process', { data: '$.given.input' }],
          processed: ['step2', 'process', { data: '$.intermediate' }]
        },
        select: 'processed'
      })
      
      // Should return the other query (both should be available from snapshot)
      assert.strictEqual(result2, 'step2-step1-test')
    })
  })
  
  describe('Error Handling', () => {
    
    it('should handle missing snapshot files gracefully', async () => {
      const nonExistentPath = path.join(__dirname, 'non-existent-snapshot.json')
      
      // Should execute normally when snapshot file doesn't exist
      const result = await query({
        snapshot: nonExistentPath,
        services: {
          test: { async run() { return 'success' } }
        },
        query: {
          result: ['test', 'run', {}]
        }
      })
      
      assert.strictEqual(result.result, 'success')
    })
    
    it('should handle corrupted snapshot files gracefully', async () => {
      // Create a corrupted snapshot file
      await fs.writeFile(testSnapshotPath, 'invalid json content')
      
      // Should execute normally despite corrupted snapshot
      const result = await query({
        snapshot: testSnapshotPath,
        services: {
          test: { async run() { return 'success' } }
        },
        query: {
          result: ['test', 'run', {}]
        }
      })
      
      assert.strictEqual(result.result, 'success')
    })
  })
})