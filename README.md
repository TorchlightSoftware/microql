# MicroQL

MicroQL is a declarative JSON-based query language for composing and orchestrating services: APIs, AI models, scrapers, databases, your CRM. You describe what each step needs; MicroQL works out the order, runs independent steps in parallel, retries and rate-limits the flaky ones, keeps failures from sinking the whole job, and remembers every result so an interrupted run picks up where it left off.

```javascript
import query from 'microql'
import {scraper, claude, hubspot} from './services/index.js'

// Find manufacturers in the chamber of commerce directory and put them in the CRM
const leads = await query({
  given: {directory: 'https://chamber.example.org/member-directory'},
  services: {scraper, claude, hubspot},
  phases: {
    members: ['GET [scraper]/listings', {url: '$given.directory', cache: true}],

    // every member is qualified in parallel; Claude calls are spaced out by the rate limit
    qualified: ['$members', 'GET [util]/each', {
      service: ['POST [claude]/qualify', {
        company: '@',
        criteria: 'manufacturing, shipping, or industrial repair',
        cache: true,
        ignoreErrors: true
      }]
    }],

    contacts: ['$qualified', 'GET [util]/filter', {service: ['GET [util]/exists', {value: '@.fit'}]}],
    created: ['$contacts', 'POST [hubspot]/companies']
  },
  settings: {rateLimit: {claude: 1000}, retry: 2},
  select: '$created'
})
```

## Target Audience

If you're a programmer and you want to achieve the low risk/high productivity of something like Zapier or n8n, but without all the baggage that those services come with, use MicroQL.  You may 1) make yourself more productive, 2) enable a non-coder on the team to be able to compose queries, enabling a division of labor where you and other coders can focus on building out new services, or working on something else entirely.

## Installation

```bash
npm install microql
```

MicroQL needs Node.js 22 or later. It also runs on Cloudflare Workers; see [Runtime Integration](docs/runtime-integration.md).

## Core Concepts

### Phases

A Query's named nodes are **phases**. Each phase is a service call, or a chain of them. `$name` refers to a phase's result, and that reference is how MicroQL knows the order: a phase runs as soon as everything it references is ready, and phases that don't depend on each other run at the same time.

```javascript
phases: {
  post: ['GET [cms]/post', {slug: '$given.slug'}],

  // these three only need the post, so they're written in parallel
  linkedin: ['POST [claude]/write', {format: 'linkedin', source: '$post'}],
  thread: ['POST [claude]/write', {format: 'x-thread', source: '$post'}],
  newsletter: ['POST [claude]/write', {format: 'newsletter', source: '$post'}],

  // and this waits for all three
  scheduled: ['POST [buffer]/schedule', {posts: ['$linkedin', '$thread'], email: '$newsletter'}]
}
```

Circular references are caught before anything runs.

### Service Keys

A call is named by its **service key**, `METHOD [service]/resource`: `POST [claude]/write` calls the `/write` resource of the `claude` service with `POST`. Services are passed in through `services`; a key naming a service, resource or method that doesn't exist is an error before anything runs.

### References

| Form | Means |
|---|---|
| `$name.path` | A phase's result, or `$given` — the inputs you supply |
| `@` / `@.path` | The value flowing in: the previous call in a chain, the current item of an `each` |
| `@name.path` | The current item of the enclosing iteration named `name` by `as:` |
| `@err.path` | The error, inside an `onError` handler (`@@err` for the one outside it) |

Paths are `.field` and `[index]` segments: `$listings[0].images[1].src`. A path that names nothing gives `undefined`.

Every string beginning with `$` or `@` is a reference. A literal like `"$5.00"` is supplied through `given`. Mistakes — an unknown name, `@` where nothing flows in, the 0.x `$.name` form — are reported with the call's address before anything runs.

### Services

Services are just objects of async functions, one per resource. Each takes an object of named arguments and returns a promise. Wrapping an API, a model or a database takes a few lines:

```javascript
const headers = {Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json'}

export const hubspot = {
  '/companies': {
    async GET({domain}) {
      const response = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${domain}?idProperty=domain`, {headers})
      return response.json()
    },
    async POST({on: companies}) {
      const response = await fetch('https://api.hubapi.com/crm/v3/objects/companies/batch/upsert', {
        method: 'POST',
        headers,
        body: JSON.stringify({inputs: companies.map(c => ({idProperty: 'domain', id: c.domain, properties: c}))})
      })
      return response.json()
    }
  }
}
hubspot['/companies'].POST._argtypes = {on: {argOrder: 0}}
```

A resource with several methods is an object with one function per method; a resource given as a plain function answers `GET`. See the [Service Development Guide](docs/service_guide.md).

### Chains

A chain runs its calls in order, each receiving the previous one's result as `@`. The first call of a chain receives nothing.

```javascript
summary: [
  ['GET [reviews]/google', {placeId: '$given.placeId'}],
  ['POST [claude]/summarize', {reviews: '@', focus: 'complaints'}],
  ['@', 'POST [slack]/post', {channel: '#customer-experience'}]
]
```

### Iterating with each

`GET [util]/each` runs a service for every item of a list, in parallel. A lone call receives the item as `@`; name the item with `as:` to reach it from a chain or a nested iteration:

```javascript
ocr: ['$listings', 'GET [util]/each', {as: 'listing', flatten: true,
  service: ['@listing.images', 'GET [util]/each', {as: 'image', service: [
    ['POST [claude]/ocr', {imageUrl: '@image.src', lookFor: ['name', 'phone', 'website']}],
    ['@', 'GET [util]/merge', {with: {industry: '@listing.industry'}}]
  ]}]
}],
```

`flatten: true` concatenates the results. Iteration names are used once per Query, so `@listing` always means the same thing.

### Method Syntax

The first argument may be written on the left: `['$members', 'GET [util]/each', {...}]` is `['GET [util]/each', {on: '$members', ...}]`. Services opt in by declaring which argument comes first: `{on: {argOrder: 0}}`.

## Handling Failure

Real pipelines fail: a page won't load, a model returns junk, an API rate-limits you. Every call takes these settings:

| Setting | Effect |
|---|---|
| `retry: 3` | Try again, up to 3 more times — including when the result fails its `postcheck` |
| `timeout: 30000` | Fail after 30s |
| `postcheck: {...}` | Treat a wrong-shaped success as a failure — see [Validation](docs/validation.md) |
| `onError: [...]` | Run a handler with the error as `@` (in a chain, `@err`) |
| `ignoreErrors: true` | Carry on: the call returns the handler's result, or `null` |

```javascript
listings: ['$categories', 'GET [util]/each', {as: 'category', flatten: true,
  service: ['GET [scraper]/extract', {
    url: '@category.href',
    postcheck: {images: ['array', ['object'], {min: 1}]},
    onError: ['@', 'GET [util]/recordFailure', {location: 'failed/listings'}],
    ignoreErrors: true
  }]
}],
// drop the pages that failed, keep going with the rest
found: ['$listings', 'GET [util]/removeErrors'],
```

An error names the call that raised it by its address: `[$listings.@1a1 - GET [scraper]/extract] Timed out after 30000ms`.

`settings.onError` is a handler for the Run as a whole.

## Built-in Utilities

The `util` service is always available:

| Resource | Does |
|---|---|
| `/each` | Run a service for every item; `flatten`, `skipInputErrors`, `skipOutputErrors` |
| `/filter` | Keep the items a service is truthy for; `mode: 'remove'` removes them |
| `/when` | `then` when `test` is truthy, otherwise `otherwise` |
| `/removeErrors`, `/removeNulls`, `/removeSuccesses`, `/partitionErrors` | Sort out the results of `ignoreErrors` |
| `/concat`, `/pick`, `/merge`, `/template` | Shape data |
| `/eq`, `/gt`, `/lt`, `/exists`, `/length` | Tests |
| `/print`, `/recordFailure` | Output and failure logs |

## Settings

```javascript
settings: {
  timeout: 30000,             // default for every call
  retry: 2,                   // default for every call
  rateLimit: {claude: 1000},  // at most one call per second to claude
  concurrency: 6,             // at most 6 calls in flight at once
  cache: {ttl: '30D'},        // how long cached results last (default 7D)
  debug: true                 // print every call, its arguments and its result
}
```

Per call, `cache: true` (or `cache: {ttl: '1D'}`) reuses the result across runs while the inputs match, so you pay for an expensive scrape or model call once.

`select` picks what the Query returns: `select: '$created'`, or `select: ['$created', '$found']`.

## Running from the Command Line

A Query is an ordinary module, so a script is all a command needs. Pass a Run State and an interrupted run resumes without repeating finished work — the scrape you already paid for isn't paid for again:

```javascript
#!/usr/bin/env -S node --env-file=.env
// queries/lead-gen.js
import query, {fileStore} from 'microql'
import {scraper, claude, hubspot} from '../services/index.js'

const today = new Date().toISOString().split('T')[0]
const directory = process.argv[2] ?? 'https://chamber.example.org/member-directory'

const created = await query({
  given: {directory},
  services: {scraper, claude, hubspot},
  phases: {/* as above */},
  select: '$created'
}, {runState: fileStore(`runs/lead-gen-${today}`)})

console.log(`Created ${created.length} companies`)
process.exit(0) // HTTP clients may keep connections alive
```

```bash
chmod +x queries/lead-gen.js
./queries/lead-gen.js https://www.example-chamber.org/directory
```

Run it again the same day and every finished call is read back from `runs/`; start a new run by using a new directory. Failures recorded with `util/recordFailure` land in JSON files you can inspect and replay.

## Examples

### Review monitoring

Pull reviews from several sources at once, flag the unhappy ones, and open a ticket for each:

```javascript
await query({
  given: {business: {googlePlaceId: 'ChIJ...', yelpId: 'acme-bakery'}},
  services: {google, yelp, claude, zendesk, slack},
  phases: {
    google: ['GET [google]/reviews', {placeId: '$given.business.googlePlaceId', since: '7d'}],
    yelp: ['GET [yelp]/reviews', {businessId: '$given.business.yelpId', since: '7d'}],

    scored: [
      [['$google', '$yelp'], 'GET [util]/concat'],
      ['@', 'GET [util]/each', {service: ['POST [claude]/sentiment', {review: '@', cache: true}]}]
    ],
    unhappy: ['$scored', 'GET [util]/filter', {service: ['GET [util]/lt', {l: '@.score', r: 3}]}],

    tickets: ['$unhappy', 'GET [util]/each', {service: ['POST [zendesk]/ticket', {
      subject: '@.summary', body: '@.text', priority: 'high'
    }]}],
    digest: ['POST [slack]/post', {channel: '#reviews', scored: '$scored', tickets: '$tickets'}]
  }
})
```

### Content repurposing

Turn one blog post into a LinkedIn post, an X thread and a newsletter, written in parallel, each checked before anything is scheduled:

```javascript
await query({
  given: {slug: 'why-we-switched-to-four-day-weeks'},
  services: {cms, claude, buffer, mailchimp},
  phases: {
    post: ['GET [cms]/post', {slug: '$given.slug'}],

    linkedin: ['POST [claude]/write', {
      format: 'linkedin', voice: 'warm, plain-spoken', source: '$post',
      postcheck: {text: ['string', {max: 3000}]}, retry: 2
    }],
    thread: ['POST [claude]/write', {
      format: 'x-thread', source: '$post',
      postcheck: {posts: ['array', ['string', {max: 280}], {max: 8}]}, retry: 2
    }],
    newsletter: ['POST [claude]/write', {format: 'newsletter', source: '$post'}],

    social: ['POST [buffer]/schedule', {posts: ['$linkedin', '$thread'], at: 'next weekday 9am'}],
    email: ['POST [mailchimp]/draftCampaign', {content: '$newsletter', list: 'subscribers'}]
  }
})
```

A draft that fails its `postcheck` — a thread entry over 280 characters — is rewritten, up to twice. If it still fails, the Run stops before anything is scheduled, with the call's address in the error; run it again with the same Run State (see [Running from the Command Line](#running-from-the-command-line)) and only that draft is rewritten, while the post and the drafts that passed are read back.

## Documentation

- **[Service Development Guide](docs/service_guide.md)** - How to write and structure services
- **[Validation System](docs/validation.md)** - Type validation and contracts
- **[Runtime Integration](docs/runtime-integration.md)** - Embedding MicroQL in your own platform: planning, partial runs, progress updates, storage and Workers

## Testing

```bash
npm test
```

## Generated docs

[performance.md](performance.md) and [function-names.md](function-names.md) mix prose with generated sections, marked `<!-- generated:name -->` … `<!-- /generated:name -->`. The scripts rewrite only the text between their markers:

```bash
npm run docs:bench       # performance.md results: this checkout vs 0.6.6, about a minute
npm run docs:functions   # function-names.md tables: after changing core
```

## Questions

### How is this different from GraphQL?

GraphQL is primarily developed for field extraction, whereas MicroQL was designed for service orchestration.  You can do service orchestration with GraphQL but it requires that you put a lot more leg work into resolvers and that you manually think about dependency resolution.  MicroQL infers dependency resolution and parallelism from the paths that are referenced.  MicroQL also doesn't invent a completely new syntax - it's mostly a subset of JSON.  We found ways to do that without being pedantic and verbose.

The MicroQL codebase is also small, dependencies `zod`, `@noble/hashes` and `@tlsft/service-key`.

[See here for a more detailed comparison](docs/comparison-graphql.md).


### Why isn't this library written in TypeScript?

I think the problem that most people are trying to solve with TypeScript would be better solved with input validations.  That is: you can type for internal consistency all you like, but as soon as you incorporate something outside your domain, your static type analysis fails.  MicroQL is literally for composing things outside of your domain.

Secondly, Javascript compilation layers became a Tower of Babel over ten years ago.  Your main tool is literally called `babel`.  Do you really need all that?  Maybe all you need is JSON.  Try it out.

### Is it fast?

It's faster than n8n, slower than native Javascript.  Performance optimization should be considered in its infancy - particularly I have not tried this with any long running processes to ensure that there are no memory leaks.

## License

MIT

---

**MicroQL** - Microservice orchestration made simple.
