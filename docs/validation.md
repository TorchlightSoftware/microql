# MicroQL Validation System

MicroQL validates with [Zod](https://zod.dev/): a call's input fields before it runs (precheck), and its result after (postcheck). Checks are written in [zodly](https://www.npmjs.com/package/zodly), a terse shorthand for zod schemas, or as zod schemas directly.

## Table of Contents

- [Service Call Validations and Service Schema Validations](#service-call-validations-and-service-schema-validations)
- [Schema Syntax](#schema-syntax)
- [Error Messages](#error-messages)
- [Examples](#examples)

## Service Call Validations and Service Schema Validations

Validation in MicroQL can be defined in two places:

1. **Service Call Validations**: the Query's author adds `precheck` and `postcheck` to one service call, to enforce what that call should receive and return.
2. **Service Schema Validations**: the service's author declares types for an operation's input fields and its result, in lieu of imperative input checks: the zodly descriptors (or zod schemas) in its declaration ([Service Development Guide](service-guide.md#declarations)).

zodly is used for both, and for the trigger's schema; a raw zod schema is accepted anywhere a descriptor is. There is no validation spanning a whole Query. The closest is the schema a Query may declare for its trigger payload (`trigger.schema`), which uses the same syntax; see [Runtime Integration](runtime-integration.md#trigger).

## Validation Execution Order

- **Precheck**: on the input fields, before the call: [Service Call Validations, Service Schema Validations]
- **Postcheck**: on the result, after the call: [Service Schema Validations, Service Call Validations]

Service Call Validations wrap Service Schema Validations, which wrap the call itself.

### Some Examples

```javascript
// A Query whose service call adds its own validation
const config = {
  services: { userService },
  phases: {
    newUser: ['[userService]/createUser', {
      userData: {
        name: 'John Doe',
        email: 'john@example.com',
        age: 25
      },

      // Service Call Validation for this call to `createUser`
      precheck: {
        userData: {
          age: ['number', {min: 18, max: 65}]
        }
      }
    }]
  }
}

// Service definition, with its Service Schema Validations: the declared types
// of its input fields (precheck) and of its result (postcheck)
const userService = defineService({
  '/createUser': {
    input: {
      userData: [['type', ['object', {name: ['string'], email: ['string', 'email'], age: ['number', 'positive']}]]]
    },
    output: [['type', ['object', {id: ['number'], name: ['string'], email: ['string', 'email']}]]],
    call: async ({userData}) => ({id: 123, ...userData})
  }
})

```

## Schema Syntax

Schemas are written in [zodly](https://www.npmjs.com/package/zodly): zod schemas as plain data, `['string', 'email', 'optional']`, `{name: ['string']}`, `['array', [{id: ['string']}], {min: 1}]`. Its README has the whole syntax: types, modifiers (any zod method by name), boxed object schemas, and its error messages. A zod schema is accepted anywhere a descriptor is, whole or inside one:

```javascript
import {z} from 'zod'

['[userService]/create', {username: '$given.username', precheck: {username: z.string().min(8).regex(/^[A-Z]/)}}]
```

**`error`** is zodly's type for a failure as data, a JSON-LD node of type Error: `{'@type': 'Error', name, message, ...}`, recognised by those three fields whatever else it has. It is what a `catch` receives as `@err`, and what stands in a list where a `catch` put a failure ([Runtime Integration § Errors as data](runtime-integration.md#errors-as-data)). Core exports it as `errorSchema`. `util/each`'s `skip` takes a schema like it to leave failures out of its results:

```javascript
['$given.urls', '[util]/each', {
  service: ['[scraper]/extract', {url: '@'}],
  catch: ['@err', '[util]/log', {to: 'failed/extract.log'}],
  skip: ['error']
}]
```

## Error Messages

Validation errors provide clear, detailed messages with full context:

```
// [<address> - <service key>] <Service Call Validation | Service Schema Validation> <precheck | postcheck> failed:
[$newUser.@1 - [userService]/createUser] Service Schema Validation precheck failed:
- userData.age: -25 => Too small: expected number to be >0
- userData.email: 'invalid-email' => Invalid email
```

The error names which validation failed. A schema that can't be parsed fails before anything runs, named the same way: `Service Call Validation precheck schema parse error`.

## Examples

Each example is a call's own checks. The syntax is the same for `precheck` and `postcheck`, and for the trigger's schema, so any of them can be used anywhere a validator is expected.

### Basic String Validation

```javascript
// A call's own checks
['[emailService]/send', {
  precheck: {
    to: ['string', 'email'],
    subject: ['string', {min: 1, max: 200}],
    body: ['string']
  }
}]
```

### Number Validation with Constraints

```javascript
// A call's own checks
['[calculator]/divide', {
  precheck: {
    numerator: ['number'],
    denominator: ['number', {min: 0.0001}] // Prevent division by zero
  },
  postcheck: ['number', 'finite']
}]
```

### Array Validation

```javascript
// A call's own checks
['[dataProcessor]/batch', {
  precheck: {
    items: ['array', ['string'], {min: 1, max: 100}],
    options: {
      parallel: ['boolean', 'optional'],
      timeout: ['number', 'positive', 'optional']
    }
  }
}]
```

### Complex Nested Objects

```javascript
// A call's own checks
['[orderService]/create', {
  precheck: {
    order: {
      customer: {
        id: ['string', 'uuid'],
        email: ['string', 'email']
      },
      items: ['array', [{
        productId: ['string'],
        quantity: ['number', 'positive', 'int'],
        price: ['number', 'positive']
      }], {min: 1}],
      shipping: {
        address: ['string'],
        city: ['string'],
        postalCode: ['string'],
        country: ['string']
      }
    }
  }
}]
```

### Optional Fields

```javascript
// A call's own checks
['[profileService]/update', {
  precheck: {
    userId: ['string', 'uuid'],
    updates: {
      name: ['string', 'optional'],
      bio: ['string', {max: 500}, 'optional'],
      avatar: ['string', 'url', 'optional'],
      age: ['number', 'positive', 'optional']
    }
  }
}]
```

### Using Validation in Chains

```javascript
const config = {
  services: { transformer },
  phases: {
    pipeline: [
      ['[transformer]/step1', {
        value: 10,
        precheck: { value: ['number', {min: 0, max: 100}] }
      }],
      ['[transformer]/step2', {
        value: '@',
        precheck: { value: ['number', {max: 200}] }
      }]
    ]
  }
}
```

### Regex Validation

```javascript
// A call's own checks
['[userService]/register', {
  precheck: {
    username: ['string', {regex: /^[a-zA-Z0-9_]{3,20}$/}],
    password: ['string', {min: 8, regex: /^(?=.*[A-Za-z])(?=.*\d)/}],
    phone: ['string', {regex: /^\+?[1-9]\d{1,14}$/}, 'optional']
  }
}]
```

### Enum Validation

```javascript
// A call's own checks
['[settingsService]/update', {
  precheck: {
    theme: ['enum', ['light', 'dark', 'auto']],
    language: ['enum', ['en', 'es', 'fr', 'de']],
    notifications: {
      email: ['boolean'],
      push: ['boolean'],
      frequency: ['enum', ['instant', 'daily', 'weekly'], 'optional']
    }
  }
}]
```

### Date Validation

```javascript
// A call's own checks
['[eventService]/schedule', {
  precheck: {
    title: ['string'],
    startDate: ['date', {min: new Date()}], // Must be in the future
    endDate: ['date'],
    recurring: ['enum', ['none', 'daily', 'weekly', 'monthly'], 'optional']
  }
}]
```
