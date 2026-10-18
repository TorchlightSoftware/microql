/**
 * An acceptance test: a Query that crawls a museum's galleries and builds
 * catalogue entries, run offline against stub services. It exercises chains,
 * two levels of nested iteration with named bindings, call-level postcheck,
 * catch with log, throw and skip, per-call cache, rateLimit, select, and
 * resume.
 */
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {plan, defineService, Runtime} from '../index.js'
import {ownRun} from './test-services.js'

const GALLERY_PAGES = {
  'https://museum.example/sculpture': {
    images: [{src: 'img/thinker.png'}, {src: 'img/kiss.png'}],
    websites: [{href: 'https://foundry.example'}]
  },
  'https://museum.example/prints': {
    images: [],
    websites: [{href: 'https://press.example'}]
  }
}

// Stub services standing in for a crawler, an assistant model and a catalogue;
// each counts its calls.
const stubServices = () => {
  const calls = []
  const record = (key, value) => { calls.push(key); return value }

  // method syntax fills the field tagged target
  const onTarget = (call) => ({input: {on: ['any', 'optional', {tags: ['target']}]}, call})

  const crawler = defineService({
    async '/extract'({url, queries}) {
      if (queries.galleries) {
        return record('extract', {
          galleries: [
            {text: 'Sculpture', href: 'https://museum.example/sculpture', class: 'x'},
            {text: 'Prints', href: 'https://museum.example/prints', class: 'y'},
            {text: 'Gift shop', href: 'https://museum.example/shop', class: 'z'}
          ]
        })
      }
      return record('extract', GALLERY_PAGES[url])
    }
  })

  const assistant = defineService({
    '/filter': onTarget(async ({on}) => record('filter', on.filter(g => g.text !== 'Gift shop'))),
    '/classify': onTarget(async ({on}) =>
      record('classify', on.map(g => ({...g, period: g.text === 'Sculpture' ? 'modern' : 'early', medium: g.text})))),
    async '/readCaption'({imageUrl}) { return record('readCaption', {name: imageUrl.replace(/^img\/|\.png$/g, '')}) },
    '/readWebsite': onTarget(async ({on}) => record('readWebsite', {name: new URL(on).hostname, website: on}))
  })

  const catalogue = defineService({
    '/dedupe': onTarget(async ({on}) => record('dedupe', on)),
    async '/createEntry'({data, title, extra}) {
      return record('createEntry', {created: true, title: title.find(Boolean), medium: data.medium, collection: extra.collection})
    }
  })

  return {calls, services: {crawler, assistant, catalogue}}
}

// What the Query logs to a destination: its failures, which this runtime keeps.
const failureLog = []
const runtime = Object.assign(new Runtime(), {env: {log: (text, {to} = {}) => { if (to) failureLog.push({to, text}) }}})

// Logs a failure to a destination, keeping it as data in the failed item's place.
const logTo = (to) => ['@err', '[util]/log', {to}]

const galleryCrawl = (services) => ({
  given: {
    baseUrl: 'https://museum.example/galleries',
    today: '2026-10-08'
  },
  services,
  runtime,
  select: '$entries',
  settings: {
    timeout: 40000,
    inspect: {depth: 4, maxArrayLength: 2},
    rateLimit: {assistant: 1}
  },
  phases: {
    galleries: [
      // 1. Read the gallery index; a failure is logged, and fails the Run
      ['[util]/try', {
        service: ['[crawler]/extract', {
          url: '$given.baseUrl',
          queries: {galleries: 'nav a'},
          postcheck: {galleries: ['array', ['object'], {min: 1}]},
          cache: true
        }],
        catch: [logTo('failed/galleries'), ['@', '[util]/throw']]
      }],
      ['@.galleries', '[util]/each', {service: ['@', '[util]/pick', {fields: ['text', 'href']}]}],
      // 2. Keep the galleries worth cataloguing, 3. classify them by period
      ['@', '[assistant]/filter', {criteria: 'collections of artworks'}],
      ['@', '[assistant]/classify', {periods: ['early', 'modern']}]
    ],

    // 4. Read each gallery page for its images and links
    // each gallery page yields one object, so there is nothing to flatten
    pages: ['$galleries', '[util]/each', {
      as: 'gallery',
      service: [
        ['[crawler]/extract', {
          url: '@gallery.href',
          queries: {images: 'main img', websites: 'main a'},
          // at least 1 image or website should be present
          postcheck: ['union', [{images: ['array', ['object'], {min: 1}]}], [{websites: ['array', ['object'], {min: 1}]}]],
          cache: true
        }],
        ['@', '[util]/merge', {with: {period: '@gallery.period', medium: '@gallery.medium'}}]
      ],
      catch: logTo('failed/pages'),
      skip: ['error']
    }],

    // read the captions of every image
    captions: ['$pages', '[util]/flattenEach', {
      as: 'page',
      service: ['@page.images', '[util]/each', {
        as: 'image',
        service: [
          ['[assistant]/readCaption', {
            imageUrl: '@image.src',
            lookFor: ['name', 'artist', 'year'],
            cache: true,
            postcheck: {name: ['string']}
          }],
          ['@', '[util]/merge', {with: {period: '@page.period', medium: '@page.medium'}}]
        ],
        catch: logTo('failed/captions'),
        skip: ['error']
      }]
    }],

    // read the websites the pages link to
    sites: ['$pages', '[util]/flattenEach', {
      as: 'site',
      service: ['@site.websites', '[util]/each', {
        as: 'website',
        service: [
          ['@website.href', '[assistant]/readWebsite', {
            lookFor: ['name', 'artist', 'year'],
            cache: true,
            postcheck: {name: ['string']}
          }],
          // add the gallery's classification back in
          ['@', '[util]/merge', {with: {period: '@site.period', medium: '@site.medium'}}]
        ],
        catch: logTo('failed/sites'),
        skip: ['error']
      }]
    }],

    entries: [
      // Merge what the captions and websites gave
      [['$captions', '$sites'], '[util]/concat'],
      ['@', '[catalogue]/dedupe'],
      // Create a catalogue entry for each
      ['@', '[util]/each', {
        service: ['[catalogue]/createEntry', {
          data: '@',
          precheck: {data: ['union', [{name: 'string'}], [{website: 'string'}]]},
          title: ['@.name', '@.website'],
          extra: {
            status: 'draft',
            'added-date': '$given.today',
            collection: 'permanent'
          }
        }],
        catch: logTo('failed/entries'),
        skip: ['error']
      }]
    ]
  }
})

const EXPECTED_ENTRIES = [
  {created: true, title: 'thinker', medium: 'Sculpture', collection: 'permanent'},
  {created: true, title: 'kiss', medium: 'Sculpture', collection: 'permanent'},
  {created: true, title: 'foundry.example', medium: 'Sculpture', collection: 'permanent'},
  {created: true, title: 'press.example', medium: 'Prints', collection: 'permanent'}
]

describe('gallery crawl acceptance (offline)', () => {
  it('compiles and plans without warnings or mismatches', async () => {
    const {services} = stubServices()
    const planned = plan(galleryCrawl(services))
    assert.deepEqual(planned.columns, [['galleries'], ['pages'], ['captions', 'sites'], ['entries']])
    assert.deepEqual(planned.warnings, [])
    // the stubs declare no output types, so a list typed any reaches each each: narrowing, not a mismatch
    assert.deepEqual(planned.errors.map(({address, code}) => ({address, code})), [
      {address: '$pages.@1.on', code: 'type-narrowing'},
      {address: '$captions.@1a1.on', code: 'type-narrowing'},
      {address: '$sites.@1a1.on', code: 'type-narrowing'},
      {address: '$entries.@3.on', code: 'type-narrowing'}
    ])
  })

  it('produces the catalogue entries', async () => {
    const {services} = stubServices()
    const entries = await query(galleryCrawl(services))
    assert.deepEqual(entries, EXPECTED_ENTRIES)
    assert.deepEqual(failureLog, [])
  })

  it('resumes from its Run State without calling any service again', async () => {
    const {services, calls} = stubServices()
    const run = ownRun()
    await query(galleryCrawl(services), {runId: run.id})
    const firstRun = calls.length

    const entries = await query(galleryCrawl(services), {runId: run.id})
    assert.deepEqual(entries, EXPECTED_ENTRIES)
    assert.equal(calls.length, firstRun)
  })
})
