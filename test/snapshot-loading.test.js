import { describe, it } from 'mocha'
import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import query from '../query.js'
import util from '../util.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testSnapshotPath = path.join(__dirname, 'test-snapshot-loading.json')

describe('Snapshot Loading Tests', () => {
  
  afterEach(async () => {
    // Clean up test snapshot files
    try {
      await fs.remove(testSnapshotPath)
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  it('should load snapshots created by util:snapshot', async () => {
    // First, create a snapshot using util:snapshot
    await query({
      given: { value: 'test-data' },
      services: { util },
      query: {
        step1: ['util', 'when', { test: true, then: 'completed', or: 'failed' }],
        step2: ['util', 'pick', { on: '$.given', fields: ['value'] }],
        // Save snapshot using util:snapshot service
        save: ['$.step2', 'util:snapshot', { capture: '$', out: testSnapshotPath }]
      }
    })
    
    // Verify snapshot file was created
    assert(await fs.pathExists(testSnapshotPath))
    const snapshotData = JSON.parse(await fs.readFile(testSnapshotPath, 'utf8'))
    assert(snapshotData.timestamp)
    assert(snapshotData.results)
    assert.strictEqual(snapshotData.results.step1, 'completed')
    assert.deepStrictEqual(snapshotData.results.step2, { value: 'test-data' })
    
    // Now test loading the snapshot
    const result = await query({
      snapshot: testSnapshotPath,
      given: { value: 'test-data' },
      services: { util },
      query: {
        step1: ['util', 'when', { test: true, then: 'completed', or: 'failed' }],
        step2: ['util', 'pick', { on: '$.given', fields: ['value'] }],
        // Add a new query that should execute
        step3: ['util', 'template', { fromSnapshot: '$.step1', newData: 'fresh' }]
      }
    })
    
    // step1 and step2 should be loaded from snapshot (not re-executed)
    assert.strictEqual(result.step1, 'completed')
    assert.deepStrictEqual(result.step2, { value: 'test-data' })
    // step3 should be newly executed
    assert.deepStrictEqual(result.step3, { fromSnapshot: 'completed', newData: 'fresh' })
  })
  
  it('should handle missing snapshot files gracefully', async () => {
    const nonExistentPath = path.join(__dirname, 'non-existent-snapshot.json')
    
    // Should execute normally when snapshot file doesn't exist
    const result = await query({
      snapshot: nonExistentPath,
      services: { util },
      query: {
        test: ['util', 'when', { test: true, then: 'success', or: 'failure' }]
      }
    })
    
    assert.strictEqual(result.test, 'success')
  })
  
  it('should handle corrupted snapshot files gracefully', async () => {
    // Create a corrupted snapshot file
    await fs.writeFile(testSnapshotPath, 'invalid json content')
    
    // Should execute normally when snapshot file is corrupted
    const result = await query({
      snapshot: testSnapshotPath,
      services: { util },
      query: {
        test: ['util', 'when', { test: true, then: 'success', or: 'failure' }]
      }
    })
    
    assert.strictEqual(result.test, 'success')
  })
  
  it('should work with select parameter when loading snapshots', async () => {
    // Create a snapshot first
    await query({
      given: { data: 'test' },
      services: { util },
      query: {
        result1: ['util', 'template', { processed: '$.given.data' }],
        result2: ['util', 'when', { test: true, then: 'done', or: 'failed' }],
        save: ['util', 'snapshot', { capture: '$', out: testSnapshotPath }]
      }
    })
    
    // Test loading with different select parameters
    const selected1 = await query({
      snapshot: testSnapshotPath,
      given: { data: 'test' },
      services: { util },
      query: {
        result1: ['util', 'template', { processed: '$.given.data' }],
        result2: ['util', 'when', { test: true, then: 'done', or: 'failed' }]
      },
      select: 'result1'
    })
    
    const selected2 = await query({
      snapshot: testSnapshotPath,
      given: { data: 'test' },
      services: { util },
      query: {
        result1: ['util', 'template', { processed: '$.given.data' }],
        result2: ['util', 'when', { test: true, then: 'done', or: 'failed' }]
      },
      select: 'result2'
    })
    
    // Both should work with loaded data
    assert.deepStrictEqual(selected1, { processed: 'test' })
    assert.strictEqual(selected2, 'done')
  })
  
  it('should inject snapshotRestoreTimestamp for skip logic', async () => {
    // Create initial snapshot
    await query({
      given: { value: 'initial' },
      services: { util },
      query: {
        data: ['util', 'template', { value: '$.given.value' }],
        save: ['util', 'snapshot', { capture: '$', out: testSnapshotPath }]
      }
    })
    
    // Test that snapshotRestoreTimestamp prevents duplicate snapshots
    // Note: The skip logic should prevent saving the same snapshot again
    const originalSnapshotData = JSON.parse(await fs.readFile(testSnapshotPath, 'utf8'))
    const originalTimestamp = originalSnapshotData.timestamp
    
    const result = await query({
      snapshot: testSnapshotPath,
      given: { value: 'initial' },
      services: { util },
      query: {
        data: ['util', 'template', { value: '$.given.value' }],
        // This should be skipped due to matching timestamp
        save: ['util', 'snapshot', { capture: '$', out: testSnapshotPath }]
      }
    })
    
    // Should have loaded data correctly
    assert.deepStrictEqual(result.data, { value: 'initial' })
    
    // Verify snapshot timestamp hasn't changed (indicating skip worked)
    const newSnapshotData = JSON.parse(await fs.readFile(testSnapshotPath, 'utf8'))
    assert.strictEqual(newSnapshotData.timestamp, originalTimestamp, 'Snapshot timestamp should be unchanged due to skip logic')
  })
})