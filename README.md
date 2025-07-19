# MicroQL

![Yo dawg, I heard you like JSON](/joke.jpg)

Sort of inspired by GraphQL.  But what if you have regular old JSON REST APIs which may be yours or third parties, and you want to compose them and return some kind of result?  This lets you do that, and also integrate other sync and async tasks declaratively.

I probably just reinvented prolog.  Oh well.


```js
query({
  debug: true,
  given: {car: 'Monkey'},
  services: {fieldAgent, truck},
  queries: {

    // result       service        action            args
    monkey:    ['fieldAgent', 'findAnimal',     {animal: '$.given.creatureType'}],
    caged:     ['fieldAgent', 'tranquilize',    {animal: '$.monkey'}],
    pet:       ['truck',      'bringHome',      {animal: '$.caged'}],
  },

}, (error, {pet}) => {
  // yay, we have a monkey as a pet
  expect(error).to.not.exist
  expect(pet).to.exist
  expect(pet).to.equal('Friendly Sleepy Monkey')
  done()
})
```

See the full test [here](test/series.js).

### What just happened?

1. We assume you want to aggregate results from multiple async services.
2. Any async service (API, network, DB, hard disk) can be represented as a function: `(action, args, next) =>`
3. Describe your inputs/outputs and MicroQL will infer the dependency graph and execute in maximum concurrency.
4. All results from a query will be accumulated on a single JS object root.

### How's it work?

Well, it's a combination of `async.auto` and `jsonpath`.  Async auto builds an execution graph for async tasks, but you have to describe the dependencies yourself.  But we make the assumption that you describe your inputs using `jsonpath`, so we can infer your dependencies for you.  The end result is a terse JSON DSL for running queries.
