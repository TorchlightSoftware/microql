# MicroQL Validation System

MicroQL provides a powerful validation system based on [Zod](https://zod.dev/) that allows you to validate service inputs (precheck) and outputs (postcheck) using JSON-based schema descriptors.

## Table of Contents

- [Service Call Validations and Service Schema Validations](#service-call-validations-and-service-schema-validations)
- [Schema Syntax](#schema-syntax)
- [Error Messages](#error-messages)
- [Examples](#examples)

## Service Call Validations and Service Schema Validations

Validation in MicroQL can be defined in two places:

1. **Service Call Validations**: the Query's author adds `precheck` and `postcheck` to one service call, to enforce what that call should receive and return.
2. **Service Schema Validations**: the service's author declares schemas for a resource's input fields and its result, in lieu of imperative input checks.

There is no validation spanning a whole Query. The closest is the schema a Query may declare for its trigger payload (`trigger.schema`), which uses the same syntax; see [Runtime Integration](runtime-integration.md#trigger).

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
    newUser: ['GET [userService]/createUser', {
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

// Service definition
const userService = {
  async '/createUser'(args) {
    return { id: 123, ...args.userData }
  }
}

// Service Schema Validation: precheck and postcheck
userService['/createUser']._validators = {
  precheck: {
    userData: {
      name: ['string'],
      email: ['string', 'email'],
      age: ['number', 'positive']
    }
  },
  postcheck: {
    id: ['number'],
    name: ['string'],
    email: ['string', 'email']
  }
}

```

## Schema Syntax

MicroQL validators use a JSON-based syntax that gets transformed into Zod schemas. There are three main forms:

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

For advanced cases not covered by the JSON syntax, you can use Zod schemas directly:

```javascript
import {z} from 'zod'

const CustomSchema = z.string().min(8).regex(/^[A-Z]/)

// Usage in service validators
userService['/create']._validators = {
  precheck: {
    username: CustomSchema
  }
}
```

See the [Zod documentation](https://zod.dev/) for full schema capabilities.

### Service Arguments Convention

Use 'any' for service arguments that accept other services (like `util.map`, `util.filter`):

```javascript
// Example from util.js
util['/each']._validators = {
  precheck: {
    on: ['array'],
    service: ['any'] // Service arguments are compiled by MicroQL - don't need special validation
  }
}
```

## Error Messages

Validation errors provide clear, detailed messages with full context:

```
// [<address> - <service key>] <Service Call Validation | Service Schema Validation> <precheck | postcheck> failed:
[$newUser.@1 - GET [userService]/createUser] Service Schema Validation precheck failed:
- userData.age: -25 => Too small: expected number to be >0
- userData.email: 'invalid-email' => Invalid email
```

The error names which validation failed. A schema that can't be parsed fails before anything runs, named the same way: `Service Call Validation precheck schema parse error`.

## Examples

Examples are mixed from Service Call Validations and Service Schema Validations. The syntax is the same for both, and for `precheck` and `postcheck`, so any of the examples here can be used anywhere a validator is expected.

**For comprehensive examples and test cases**, see `test/validation.test.js` which contains data-driven tests demonstrating all syntax patterns, modifier combinations, and edge cases.

### Basic String Validation

```javascript
// Service definition
emailService['/send']._validators = {
  precheck: {
    to: ['string', 'email'],
    subject: ['string', {min: 1, max: 200}],
    body: ['string']
  }
}
```

### Number Validation with Constraints

```javascript
// Service definition
calculator['/divide']._validators = {
  precheck: {
    numerator: ['number'],
    denominator: ['number', {min: 0.0001}] // Prevent division by zero
  },
  postcheck: ['number', 'finite']
}
```

### Array Validation

```javascript
// Service definition
dataProcessor['/batch']._validators = {
  precheck: {
    items: ['array', ['string'], {min: 1, max: 100}],
    options: {
      parallel: ['boolean', 'optional'],
      timeout: ['number', 'positive', 'optional']
    }
  }
}
```

### Complex Nested Objects

```javascript
// Service definition
orderService['/create']._validators = {
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
}
```

### Optional Fields

```javascript
// Service definition
profileService['/update']._validators = {
  precheck: {
    userId: ['string', 'uuid'],
    updates: {
      name: ['string', 'optional'],
      bio: ['string', {max: 500}, 'optional'],
      avatar: ['string', 'url', 'optional'],
      age: ['number', 'positive', 'optional']
    }
  }
}
```

### Using Validation in Chains

```javascript
const config = {
  services: { transformer },
  phases: {
    pipeline: [
      ['GET [transformer]/step1', {
        value: 10,
        precheck: { value: ['number', {min: 0, max: 100}] }
      }],
      ['GET [transformer]/step2', {
        value: '@',
        precheck: { value: ['number', {max: 200}] }
      }]
    ]
  }
}
```

### Regex Validation

```javascript
// Service definition
userService['/register']._validators = {
  precheck: {
    username: ['string', {regex: /^[a-zA-Z0-9_]{3,20}$/}],
    password: ['string', {min: 8, regex: /^(?=.*[A-Za-z])(?=.*\d)/}],
    phone: ['string', {regex: /^\+?[1-9]\d{1,14}$/}, 'optional']
  }
}
```

### Enum Validation

```javascript
// Service definition
settingsService['/update']._validators = {
  precheck: {
    theme: ['enum', ['light', 'dark', 'auto']],
    language: ['enum', ['en', 'es', 'fr', 'de']],
    notifications: {
      email: ['boolean'],
      push: ['boolean'],
      frequency: ['enum', ['instant', 'daily', 'weekly'], 'optional']
    }
  }
}
```

### Date Validation

```javascript
// Service definition
eventService['/schedule']._validators = {
  precheck: {
    title: ['string'],
    startDate: ['date', {min: new Date()}], // Must be in the future
    endDate: ['date'],
    recurring: ['enum', ['none', 'daily', 'weekly', 'monthly'], 'optional']
  }
}
```

## Conclusions

In general we try to map closely to the `zod` API and do minimal processing.  But in a few places we don't mind letting go of "syntax regularity" in order to support less verbosity and a more intuitive API.
