# MicroQL

MicroQL is a declarative JSON-based query language for composing and orchestrating services: APIs, AI models, scrapers, databases, your CRM. You describe what each step needs; MicroQL works out the order, runs independent steps in parallel, retries and rate-limits the flaky ones, keeps failures from sinking the whole job, and remembers every result so an interrupted run picks up where it left off.

```javascript
import query from 'microql'
import {scraper, claude, hubspot} from './services/index.js'

// Find manufacturers in a business directory and put them in the CRM
const leads = await query({
  given: {directory: 'https://directory.example.com/members'},
  services: {scraper, claude, hubspot},
  phases: {
    members: ['[scraper]/listings', {url: '$given.directory', cache: true}],

    // every member is qualified in parallel; Claude calls are spaced out by the rate limit
    qualified: ['$members', '[util]/each', {
      service: ['POST [claude]/qualify', {
        company: '@',
        criteria: 'manufacturing, shipping, or industrial repair',
        cache: true
      }],
      // a member Claude can't qualify is logged and left out; the rest carry on
      catch: ['@err', '[util]/log', {to: 'failed/qualify.log'}],
      skip: ['error']
    }],

    contacts: ['$qualified', '[util]/filter', {service: ['[util]/exists', {value: '@.fit'}]}],
    created: ['$contacts', 'POST [hubspot]/companies']
  },
  settings: {rateLimit: {claude: 1000}, retry: 2},
  select: '$created'
})
```

## Versions

MicroQL 1.x versions should be considered unstable on a minor release basis.  We bumped to 1.x to mark a significant rewrite of the protocol, but we are still continuing to evolve the language as we build out the ecosystem and the cloud runtime support.

## Contents

- [Target Audience](#target-audience)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
  - [Phases](#phases)
  - [Service Calls](#service-calls)
  - [Service Keys](#service-keys)
  - [References](#references)
  - [Services](#services)
  - [Chains](#chains)
  - [Iterating with each](#iterating-with-each)
  - [Method Syntax](#method-syntax)
- [Handling Failure](#handling-failure)
- [Built-in Utilities](#built-in-utilities)
- [Settings](#settings)
- [Runs and stored results](#runs-and-stored-results)
- [Running from the Command Line](#running-from-the-command-line)
- [Examples](#examples)
  - [Review monitoring](#review-monitoring)
  - [Content repurposing](#content-repurposing)
- [Documentation](#documentation)
- [Testing](#testing)
- [Generated docs](#generated-docs)
- [Questions](#questions)
  - [How is this different from GraphQL?](#how-is-this-different-from-graphql)
  - [Why isn't this library written in TypeScript?](#why-isnt-this-library-written-in-typescript)
  - [Is it fast?](#is-it-fast)
- [License](#license)

## Target Audience

If you're a programmer and you want to achieve the low risk/high productivity of something like Zapier or n8n, but without all the baggage that those services come with, use MicroQL.  You may 1) make yourself more productive, 2) enable a non-coder on the team to be able to compose queries, enabling a division of labor where you and other coders can focus on building out new services, or working on something else entirely.

## Installation

```bash
npm install microql
```

MicroQL needs Node.js 22 or later. `import query from 'microql'` gives you core with the node runtime wired in. Core alone, `microql/core`, has no environment dependencies and runs anywhere JavaScript does, Cloudflare Workers included, with a runtime you supply; see [Runtime Integration](docs/runtime-integration.md).

## Core Concepts

### Phases

At the top level, a Query has a set of named nodes called **phases**. Each phase begins with a chain of 1 or more service calls.  This chain will run sequentially.  Each call in a chain can access the results of the previous call through the special variable `@`.

Phases can also refer to each other's data by referring to the name of the $phase.  Phase references are how MicroQL knows the order to run them in: a phase runs as soon as everything it references is ready, and phases that don't depend on each other run at the same time.

```javascript
phases: {
  post: ['[cms]/post', {slug: '$given.slug'}],

  // these three only need the post, so they're written in parallel
  linkedin: ['POST [claude]/write', {format: 'linkedin', source: '$post'}],
  thread: ['POST [claude]/write', {format: 'x-thread', source: '$post'}],
  newsletter: ['POST [claude]/write', {format: 'newsletter', source: '$post'}],

  // and this waits for all three
  scheduled: ['POST [buffer]/schedule', {posts: ['$linkedin', '$thread'], email: '$newsletter'}]
}
```

Circular references are caught by the query planner and result in an error.

### Service Calls

The active parts of a Query are **service calls**. They are formed by a service key, naming what to call, then the fields to call it with.  By convention services typically accept a set of named arguments as their root:

```
['POST [claude]/write', {format: 'newsletter', source: '$post'}]
```

The above sends HTTP `POST` to the `/write` path on the `claude` service, feeding it the static string 'newsletter' and whatever the result of the `$post` phase is.  MicroQL first resolves references to their runtime values, then calls the service with those values.  This allows you to write queries declaratively (where do I need to get the data from?) without worrying about what order it will run in.

Service calls also have retry, timeout, rate limit, and cache settings which can be configured on a case by case basis or by query wide defaults.

Service calls may also receive other service calls: this allows services to perform flow control and higher order functions within a query.  See `[util]/each` which calls a service for each member of a list.

You can build your own services or generate them from well defined API specs: see [our service guide](docs/service-guide.md).

### Service Keys

A call is named by its **service key** in the form `METHOD [service]/resource`.  METHOD is optional.  Service keys allow us to describe RESTful routes, gRPC endpoints, SOAP, whatever you would like.  The service key omits the transport protocol and instead names the *identity* of the service you are talking to.  So service keys are *subjective* from the point of view of the execution context, whereas URIs are *absolute*.

This has several advantages:

1) We may use the same identifier whether a service is local or remote
2) Some tenants in a system may choose to self host, or run different network topologies
3) Perhaps we want to use a decentralized peer discovery protocol, or some other custom means of addressing

### References

References are used to pull in values from other parts of a query.  Phase references act as implied dependencies, ensuring that the source phase will run before the destination.

| Form | Means |
|---|---|
| `$name.path` | A phase's result, or `$given` — the inputs you supply |
| `@` / `@.path` | The value flowing in: the previous call in a chain, the current item of an `each` |
| `@name.path` | The current item of the enclosing iteration named `name` by `as:` |
| `@err.path` | The failure, inside a `catch` (`@@err` for the one outside it) |

Paths are `.field` and `[index]` segments such as: `$listings[0].images[1].src`. A path that names nothing gives `undefined`.

Every string beginning with `$` or `@` is a reference. A literal like `"$5.00"` can be supplied through `given`. Mistakes — an unknown name, `@` where nothing flows in, the 0.x `$.name` form — are reported with the call's address before anything runs.

### Services

A service is an API of some kind - like Google, Facebook, Square, Salesforce, etc.  It could be local or remote, and each service call can be sync or async.  See the [util.js](src/service/util.js) service for a built-in example of a service.  You will be using this service a lot for flow control within queries, like processing lists of things or creating conditional logic.  Also see the [microql-services](https://github.com/TorchlightSoftware/microql-services) project, where we are keeping a catalog of existing services.

A Query brings the services it calls, by the names its keys use, and their configuration, such as credentials, by the same names: `query({services: {github}, config: {github: {token}}, phases})`. Wrapping existing APIs to create a new service is easy, see our [service development guide](docs/service-guide.md) for more information.


### Chains

A chain runs its calls in order, each receiving the previous one's result as `@`. The first call of a chain receives nothing.

```javascript
summary: [
  ['[reviews]/google', {placeId: '$given.placeId'}],
  ['POST [claude]/summarize', {reviews: '@', focus: 'complaints'}],
  ['@', 'POST [slack]/post', {channel: '#customer-experience'}]
]
```

### Iterating with each

`[util]/each` runs a service for every item of a list, in parallel. A lone call receives the item as `@`; name the item with `as:` to reach it from a chain or a nested iteration:

```javascript
ocr: ['$listings', '[util]/flattenEach', {as: 'listing',
  service: ['@listing.images', '[util]/each', {as: 'image', service: [
    ['POST [claude]/ocr', {imageUrl: '@image.src', lookFor: ['name', 'phone', 'website']}],
    ['@', '[util]/merge', {with: {industry: '@listing.industry'}}]
  ]}]
}],
```

`[util]/flattenEach` concatenates the lists its calls return. Iteration names are used once per Query, so `@listing` always means the same thing.

### Method Syntax

The first argument may be written on the left: `['$members', '[util]/each', {...}]` is `['[util]/each', {on: '$members', ...}]`. Services opt in by tagging the field that comes first: `input: {on: ['array', {tags: ['target']}]}`.

## Handling Failure

Real pipelines fail: a page won't load, a model returns junk, an API rate-limits you. Every call takes these settings:

| Setting | Effect |
|---|---|
| `retry: 3` | Try again, up to 3 more times — including when the result fails its `postcheck` |
| `timeout: 30000` | Fail after 30s |
| `postcheck: {...}` | Treat a wrong-shaped success as a failure: a [Service Call Validation](docs/validation.md) |

A failure is thrown, and fails the call holding it, and the one holding that, up to the Run, until a **`catch`** handles it. A `catch` sits on a call that holds other calls (`each`, `filter`, `try`, ...) and handles a failure of any of them, from anywhere below: it receives the failure as `@err`, sees the failed item by the call's `as:` name, and what it returns takes the failed call's place. The holding call carries on with the rest. A `catch` that throws fails the holding call in turn.

```javascript
listings: ['$categories', '[util]/each', {as: 'category',
  service: ['[scraper]/extract', {
    url: '@category.href',
    postcheck: {images: ['array', ['object'], {min: 1}]}
  }],
  // log each page that failed, and leave it out; keep going with the rest
  catch: ['@err', '[util]/log', {to: 'failed/listings.log'}],
  skip: ['error']
}],
```

- **The failure is data**: `{'@type': 'Error', name, message, cause, address, key, queryHash, formHash, args}`, a JSON-LD node of type Error with the address and arguments of the call that raised it. It's plain JSON, so it is stored and resumed like any result, and the `error` [validation type](docs/validation.md) matches it.
- **`skip`** on `each` and `flattenEach` leaves out the results that fit a schema: `['error']`, `['null']`, or `['union', ['error'], ['null']]`.
- **To fail anyway**, rethrow: `catch: [['@err', '[util]/log', {to: 'failed.log'}], ['@', '[util]/throw']]`. Or fail with an error of your own, keeping the failure as its cause: `catch: ['[util]/throw', {on: 'Listings stopped', cause: '@err'}]`.
- **To catch a single call**, hold it in `[util]/try`: `['[util]/try', {service: ['[scraper]/extract', {...}], catch: [...]}]`.
- **Retries come first**: a `catch` sees only a failure that outlasted its retries. An aborted Run catches nothing.
- **`settings.catch`** handles each phase that fails: its result is the phase's, and the Run carries on.

An error names the call that raised it by its address: `[$listings.@1a1 - [scraper]/extract] Timed out after 30000ms.`. A `catch` is always lettered `e` (`$listings.@1e1`), so adding one moves no other address.

## Built-in Utilities

The `util` service is always available:

| Resource | Does |
|---|---|
| `/each` | Run a call for every item, all at once or one at a time (`sequential: true`); `skip` leaves out the results that fit a schema |
| `/flattenEach` | Run a call that returns a list for every item, and concatenate the lists; `skip` too |
| `/filter` | Keep the items a service is truthy for; `mode: 'remove'` removes them |
| `/try` | Run one call, so a `catch` can handle its failure |
| `/waitFor` | Run a call until it succeeds and its result fits `expect`: at most `tries` times (10), every `interval` ms (200); fails with `gave-up` |
| `/repeat` | Run a call `times` times (10), every `interval` ms, or until its result fits `until`; returns `{passes, stoppedBy}`, every pass's result and `'until'` or `'times'` |
| `/throw` | Fail with the error given (as data), or with an error saying what was given; `cause` attaches the error behind it |
| `/when` | `then` when `test` is truthy, otherwise `otherwise` |
| `/partitionErrors` | Split a list into `{successes, failures}` |
| `/concat`, `/pick`, `/merge`, `/template` | Shape data |
| `/eq`, `/gt`, `/lt`, `/exists`, `/length` | Tests |
| `/format` | A value as text |
| `/inspect`, `/log` | Write a value out, formatted with the Query's `inspect` settings or as plain text, to the console or to a destination (`to:`); both return it |

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

## Runs and stored results

A **Run** is one or more executions of a Query with one Run id, against its **Run State**, the store holding the result of every call it made. MicroQL writes each result there as it goes and reuses any result already there, so running again against the same Run State resumes where the last attempt stopped. A Run is only a concept: MicroQL keeps no record of Runs, and the Run State is their only trace.

Every Query runs in a **scope**, which its runtime gives it. Scoping is the runtime's: it decides what a scope is keyed by, a tenant, a Run, or both, and gives the Query its services, their environment, the Cache and the Run State through it. MicroQL's engine runs a Query in whatever scope it's given, and never knows how it's keyed. The node runtime's scopes are Runs: services, their config and the Cache are every Run's, and each Run has a Run State and service instances of its own.

What the node runtime (`import query from 'microql'`) does with results:

| Store | Where | Lasts | To clear it |
|---|---|---|---|
| Run State | in memory, for the `query()` call, unless you name the Run with `{runId}`; on disk with `new NodeRuntime({runStates: fileStores(dir)})` | the call; a named Run, as long as the process or `dir` exists | start a new Run, or `await runtime.runStates.clear({runId})` |
| Cache, for calls with `cache` set | the `.cache` directory under the current working directory | until its ttl passes; expired entries are swept when the store is first used | `rm -rf .cache`, or `await nodeRuntime.cache.clear()` |
| What `util/log` and `util/inspect` write `to:` a destination | appended to that file | until you delete it | delete the file |

`fileStores(dir)` keeps a directory per scope, named by the scope's hash, with one directory per call form and one JSON file per input, so a Run State on disk can be inspected by hand: the node runtime keeps one per Run. The Cache, `fileStores('.cache')`, keeps one for every Run's scope, `{}`. How core keys and reuses results is in [Runtime Integration § Storage](docs/runtime-integration.md#storage).

## Running from the Command Line

A Query is an ordinary module, so a script is all a command needs. Keep [Run States](#runs-and-stored-results) on disk and name the Run, and an interrupted run resumes without repeating finished work — the scrape you already paid for isn't paid for again:

```javascript
#!/usr/bin/env -S node --env-file=.env
// queries/lead-gen.js
import query, {NodeRuntime, fileStores} from 'microql'
import {scraper, claude, hubspot} from '../services/index.js'

const today = new Date().toISOString().split('T')[0]
const directory = process.argv[2] ?? 'https://directory.example.com/members'

const created = await query({
  runtime: new NodeRuntime({runStates: fileStores('runs')}),
  given: {directory},
  services: {scraper, claude, hubspot},
  phases: {/* as above */},
  select: '$created'
}, {runId: `lead-gen-${today}`})

console.log(`Created ${created.length} companies`)
process.exit(0) // HTTP clients may keep connections alive
```

Each Run has service instances of its own. `query()` releases those of a Run it named itself once it's done; those of a Run you name are kept for its later calls. A script that's done can just exit, as this one does: the process takes its services' browsers and connections with it. A long-running process, or a test, cleans them up instead with `await nodeRuntime.tearDown()`, which calls the `tearDown` of each service instance the runtime keeps.

```bash
chmod +x queries/lead-gen.js
./queries/lead-gen.js https://directory.example.com/members
```

Run it again the same day and every finished call is read back from `runs/`; start a new run by using a new directory. Failures a `catch` logs `to:` a file are there to inspect.

## Examples

### Review monitoring

Pull reviews from several sources at once, flag the unhappy ones, and open a ticket for each:

```javascript
await query({
  given: {business: {googlePlaceId: 'ChIJ...', yelpId: 'acme-bakery'}},
  services: {google, yelp, claude, zendesk, slack},
  phases: {
    google: ['[google]/reviews', {placeId: '$given.business.googlePlaceId', since: '7d'}],
    yelp: ['[yelp]/reviews', {businessId: '$given.business.yelpId', since: '7d'}],

    scored: [
      [['$google', '$yelp'], '[util]/concat'],
      ['@', '[util]/each', {service: ['POST [claude]/sentiment', {review: '@', cache: true}]}]
    ],
    unhappy: ['$scored', '[util]/filter', {service: ['[util]/lt', {l: '@.score', r: 3}]}],

    tickets: ['$unhappy', '[util]/each', {service: ['POST [zendesk]/ticket', {
      subject: '@.summary', body: '@.text', priority: 'high'
    }]}],
    digest: ['POST [slack]/post', {channel: '#reviews', scored: '$scored', tickets: '$tickets'}]
  }
})
```

### Content repurposing

Turn one blog post into a LinkedIn post, an X thread and a newsletter, posted in parallel, each checked before anything is scheduled:

```javascript
await query({
  given: {slug: 'why-we-switched-to-four-day-weeks'},
  services: {cms, claude, buffer, mailchimp},
  phases: {
    post: ['[cms]/post', {slug: '$given.slug'}],

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

- **[Service Development Guide](docs/service-guide.md)** - How to write and structure services
- **[Validation System](docs/validation.md)** - Type validation and contracts, written in [zodly](https://github.com/TorchlightSoftware/zodly)
- **[Runtime Integration](docs/runtime-integration.md)** - Building on MicroQL beyond a node script: core, runtimes and platforms, storage, planning, partial runs, progress updates and abort

## Testing

```bash
npm test
```

## Generated docs

[performance.md](performance.md) mixes prose with a generated section, marked `<!-- generated:name -->` … `<!-- /generated:name -->`; the script rewrites only the text between its markers. `function-names.md`, an index of every named function in core, is generated whole and kept out of git, since every edit to core moves its line numbers:

```bash
npm run docs:bench       # performance.md results: this checkout vs 0.6.6, about a minute
npm run docs:functions   # function-names.md: whenever you want the index
```

## Questions

### How is this different from GraphQL?

GraphQL is primarily developed for field extraction, whereas MicroQL was designed for service orchestration.  You can do service orchestration with GraphQL but it requires that you put a lot more leg work into resolvers and that you manually think about dependency resolution.  MicroQL infers dependency resolution and parallelism from the paths that are referenced.  MicroQL also doesn't invent a completely new syntax - it's mostly a subset of JSON and JSON pathing.  We found ways to do that without being pedantic and verbose.

The MicroQL codebase is also small, dependencies `zod`, `@noble/hashes` and `@tlsft/service-key`.

[See here for a more detailed comparison](docs/comparison-graphql.md).


### Why isn't this library written in TypeScript?

I think the problem that most people are trying to solve with TypeScript would be better solved with input validations.  That is: you can type for internal consistency all you like, but as soon as you incorporate something outside your domain, your static type analysis fails.  MicroQL is literally for composing things outside of your domain.

So MicroQL instead opts to give you great input/output validations with zod/zodly, and give you inference tools to understand how those types flow through your query.

Secondly, Javascript compilation layers became a Tower of Babel over ten years ago.  The main tool is literally called `babel`.  Maybe all you need is JSON.

### Is it fast?

It's faster than n8n, slower than native Javascript.  Performance optimization should be considered in its infancy - particularly I have not tried this with any long running processes to ensure that there are no memory leaks.  See [performance metrics](performance.md).

Since it's raw JS, you don't have to wait for any compile times, or set up the build chains required for transpiling.

## License

MIT

---

**MicroQL** - Microservice orchestration made simple.
