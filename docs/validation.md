# MicroQL Validation System

MicroQL provides a powerful validation system based on [Zod](https://zod.dev/) that allows you to validate service inputs (precheck) and outputs (postcheck) using JSON-based schema descriptors.

## Table of Contents

- [User and Service Validations](#user-and-service-validations)
- [Schema Syntax](#schema-syntax)
- [Error Messages](#error-messages)
- [Examples](#examples)

## User and Service Validations

Validation in MicroQL can be defined at two levels:

1. **User-level validation**: Query writers can add validations to enforce their expectations
2. **Service-level validation**: Service writers can add validations in leiu of imperative conditional input validation

## Validation Execution Order

- **Precheck**: On `args` before execution: [User Validations, Service Validations]
- **Postcheck**: On `results` after execution: [Service Validations, User Validations]

Basically user validations "wrap" service validations which "wrap" the service in question.

### Some Examples

```javascript
// Query with user-level validation
const config = {
  services: { userService },
  queries: {
    newUser: ['userService:createUser', {
      userData: {
        name: 'John Doe',
        email: 'john@example.com',
        age: 25
      },

      // Validation for `createUser`
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
  async createUser(args) {
    return { id: 123, ...args.userData }
  }
}

// Service-level validation - precheck and postcheck
userService.createUser._validators = {
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
['number', 'positive', 'integer']
['string', {min: 5, max: 100}]

// Optional/nullable
['string', 'optional']
['number', 'nullable']
```

### 2. Object Syntax

```javascript
{
  name: ['string'],
  age: ['number', 'positive'],
  email: ['string', 'email', 'optional']
}
```

### 3. Wrapper Types

```javascript
// Arrays
['array', ['string']]        // Array of strings
['array', ['number'], {min: 2, max: 10}]  // Array of numbers with constraints
['array']                    // Array of any type (shorthand for ['array', ['any']])

// Objects
['object', {name: ['string'], age: ['number']}]  // Object with specific shape
['object']                   // Any object (shorthand for ['object', {}])

// Unions
['union', [['string'], ['number']]]

// Nullable wrapper
['nullable', ['string']]

// Optional wrapper
['optional', ['number']]

// Enums
['enum', ['red', 'green', 'blue']]  // Must be one of the specified values

// Tuples
['tuple', [['string'], ['number']]]  // Fixed-length array with typed elements
```

### Natural Syntax Shortcuts

The validation system supports convenient shortcuts:

```javascript
// These are equivalent:
['array']           ↔ ['array', ['any']]
['object']          ↔ ['object', {}]
['nullable']        ↔ ['nullable', ['any']]
['optional']        ↔ ['optional', ['any']]
```

### Service Arguments Convention

Use 'any' for service arguments that accept other services (like `util.map`, `util.filter`):

```javascript
// Example from util.js
util.map._validators = {
  precheck: {
    on: ['array'],
    service: ['any'] // Service arguments are compiled by MicroQL - don't need special validation
  }
}
```

## Error Messages

Validation errors provide clear, detailed messages with full context:

```
// [<queryName> - <serviceName>:<action>]
[newUser - userService:createUser] precheck validation failed:
- userData.age: Too small: expected number to be >=18
- userData.email: Invalid email
```

MicroQL also adds the properties `queryName`, `serviceName`, and `action` to all error messages for programmatic decision making.

## Examples

Examples are mixed from User and Service validations.  The format is the same, `User` / `Service` and `precheck` / `postcheck`.  So any of the examples here can be used anywhere a validator is expected.

### Basic String Validation

```javascript
// Service definition
emailService.send._validators = {
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
calculator.divide._validators = {
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
dataProcessor.batch._validators = {
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
orderService.create._validators = {
  precheck: {
    order: {
      customer: {
        id: ['string', 'uuid'],
        email: ['string', 'email']
      },
      items: ['array', [{
        productId: ['string'],
        quantity: ['number', 'positive', 'integer'],
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
profileService.update._validators = {
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
  queries: {
    pipeline: [
      ['transformer:step1', {
        value: 10,
        precheck: { value: ['number', {min: 0, max: 100}] }
      }],
      ['transformer:step2', {
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
userService.register._validators = {
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
settingsService.update._validators = {
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
eventService.schedule._validators = {
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
