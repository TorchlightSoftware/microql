# MicroQL Validation System

MicroQL has two primary validation points: a call's input fields before it runs (precheck), and its result after (postcheck). Checks are written in [zodly](https://www.npmjs.com/package/zodly), a terse shorthand for zod schemas, or as zod schemas directly.

## Table of Contents

- [Service Call Validations and Service Defined Validations](#service-call-validations-and-service-defined-validations)
- [Schema Syntax](#schema-syntax)
- [Error Messages](#error-messages)
- [Examples](#examples)

## Service Call Validations and Service Defined Validations

Validation in MicroQL can be defined in two places:

1. **Service Call Validations**: the Query's author adds `precheck` and `postcheck` to one service call, to enforce what that call should receive and return.
2. **Service Defined Validations**: the service's author declares types for a service call's input fields and its result, in lieu of imperative input checks: the zodly descriptors (or zod schemas) in its declaration ([Service Development Guide](service-guide.md#declarations)).

zodly is used for both.  Queries can also be started by a trigger (see [Runtime Integration](runtime-integration.md#trigger)), and the trigger's schema can also be defined in zodly.  A raw zod schema is accepted anywhere zodly is.

## Validation Execution Order

- **Precheck**: on the input fields, before the call: [Service Call Validations, Service Defined Validations]
- **Postcheck**: on the result, after the call: [Service Defined Validations, Service Call Validations]

Service Call Validations wrap Service Defined Validations, which wrap the call itself.

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

// Service definition, with its Service Defined Validations: the declared types
// of its input fields (precheck) and of its result (postcheck)
const userService = defineService({
  '/createUser': {
    input: {
      userData: {name: ['string'], email: ['string', 'email'], age: ['number', 'positive']}
    },
    output: {id: ['number'], name: ['string'], email: ['string', 'email']},
    call: async ({userData}) => ({id: 123, ...userData})
  }
})

```

## Schema Syntax

Schemas are written in [zodly](https://www.npmjs.com/package/zodly): zod schemas as plain data, `['string', 'email', 'optional']`, `{name: ['string']}`, `['array', [{id: ['string']}], {min: 1}]`. Its README has the whole syntax: types, modifiers (any zod method by name), boxed object schemas, and its error messages.

**`error`** is zodly's type for a failure as data, a JSON-LD node of type Error: `{'@type': 'Error', name, message, ...}`.  MicroQL ensures that all errors have this form and can therefore be detected by the type.  You can for instance catch errors, and then skip them:

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
// [<address> - <service key>] <Service Call Validation | Service Defined Validation> <precheck | postcheck> failed:
[$newUser.@1 - [userService]/createUser] Service Defined Validation precheck failed:
- userData.age: -25 => Too small: expected number to be >0
- userData.email: 'invalid-email' => Invalid email
```

The error names which validation failed. A schema that can't be parsed fails before anything runs, named the same way: `Service Call Validation precheck schema parse error`.

## Examples

Here are some examples.  You can find more in the [util service](../services/util.js).

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
