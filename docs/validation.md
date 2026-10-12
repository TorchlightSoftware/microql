# MicroQL Validation System

MicroQL validates with [Zod](https://zod.dev/): a call's input fields before it runs (precheck), and its result after (postcheck). A Query's author writes checks in a terse JSON-based shorthand that MicroQL turns into zod; a service's author declares zod schemas directly.

## Table of Contents

- [Service Call Validations and Service Schema Validations](#service-call-validations-and-service-schema-validations)
- [Schema Syntax](#schema-syntax)
- [Error Messages](#error-messages)
- [Examples](#examples)

## Service Call Validations and Service Schema Validations

Validation in MicroQL can be defined in two places:

1. **Service Call Validations**: the Query's author adds `precheck` and `postcheck` to one service call, to enforce what that call should receive and return.
2. **Service Schema Validations**: the service's author declares zod schemas for an operation's input fields and its result, in lieu of imperative input checks: the `fromZod` types in its declaration ([Service Development Guide](service_guide.md#declarations)).

The shorthand below is for Service Call Validations and the trigger's schema; a raw zod schema is accepted anywhere shorthand is. There is no validation spanning a whole Query. The closest is the schema a Query may declare for its trigger payload (`trigger.schema`), which uses the same syntax; see [Runtime Integration](runtime-integration.md#trigger).

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
const userService = serviceFromTable({
  '/createUser': {
    input: {
      userData: [['type', {fromZod: z.object({name: z.string(), email: z.email(), age: z.number().positive()})}]]
    },
    output: [['type', {fromZod: z.object({id: z.number(), name: z.string(), email: z.email()})}]],
    call: async ({userData}) => ({id: 123, ...userData})
  }
})

```

## Schema Syntax

A Query's validators use a JSON-based syntax that gets transformed into Zod schemas. There are three main forms:

### 1. Array Syntax (Most Common)

```javascript
// Basic types
['string']
['number']
['boolean']
['date']

// With modifiers
['string', 'email']
['number', 'positive', 'int']
['string', {min: 5, max: 100}]

// Optional/nullable
['string', 'optional']
['number', 'nullable']

// Combining multiple modifiers (flat syntax)
['string', 'optional', 'nullable']
['number', 'positive', 'int', 'optional']

// A failure as data, as a catch receives it (see below)
['error']
```

**`error`** is a failure as data, a JSON-LD node of type Error: `{'@type': 'Error', name, message, ...}`, recognised by those three fields whatever else it has. It is what a `catch` receives as `@err`, and what stands in a list where a `catch` put a failure ([Runtime Integration § Errors as data](runtime-integration.md#errors-as-data)). It is the schema core exports as `errorSchema`, and it composes like any type: `['error', 'optional']`, `['union', ['error'], ['null']]`, `['array', ['error']]`. `util/each`'s `skip` takes these schemas to leave failures out of its results:

```javascript
['$given.urls', '[util]/each', {
  service: ['[scraper]/extract', {url: '@'}],
  catch: ['@err', '[util]/log', {to: 'failed/extract.log'}],
  skip: ['error']
}]
```

### 2. Object Syntax

Shorthand syntax for objects.  See longhand syntax below in Wrapper Types.

```javascript
{
  name: ['string'],
  age: ['number', 'positive'],
  email: ['string', 'email', 'optional']
}
```

### 3. Wrapper Types

Wrapper types handle complex data structures and can be combined with modifiers:

```javascript
// Arrays
['array', ['string']]                    // Array of strings
['array', ['number'], {min: 2, max: 10}] // Array with constraints
['array', ['string'], 'optional']       // Optional array of strings
['array', ['string'], 'nullable']       // Nullable array of strings
['array']                               // Array of any type (shorthand)

// Objects
['object', {name: ['string'], age: ['number']}] // Object with specific shape
{name: ['string'], age: ['number']}             // Same object, shorthand, if you don't need modifiers
['object', {name: ['string']}, 'optional']      // Optional object
['object', {name: ['string']}, 'nullable']      // Nullable object
['object']                                      // Any object (shorthand)

// Unions
['union', ['string'], ['number']]               // String or number
['union', ['string'], ['number'], 'optional']  // Optional union
['union', ['string'], ['number'], 'nullable']  // Nullable union

// Enums
['enum', ['red', 'green', 'blue']]             // Must be one of the values
['enum', ['red', 'blue', 'green'], 'optional'] // Optional enum

// Tuples
['tuple', ['string'], ['number']]              // Fixed-length typed array
['tuple', ['string'], ['number'], 'optional']  // Optional tuple

// Nullable/Optional wrappers (legacy - prefer flat syntax above)
['nullable', ['string']]
['optional', ['number']]
```

### 4. Direct Zod Schema Usage

For advanced cases not covered by the JSON syntax, you can use Zod schemas directly, whole or inside shorthand:

```javascript
import {z} from 'zod'

const CustomSchema = z.string().min(8).regex(/^[A-Z]/)

['[userService]/create', {username: '$given.username', precheck: {username: CustomSchema}}]
```

See the [Zod documentation](https://zod.dev/) for full schema capabilities.

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

**For comprehensive examples and test cases**, see `test/validation.test.js` which contains data-driven tests demonstrating all syntax patterns, modifier combinations, and edge cases.

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

## Conclusions

In general we try to map closely to the `zod` API and do minimal processing.  But in a few places we don't mind letting go of "syntax regularity" in order to support less verbosity and a more intuitive API.
