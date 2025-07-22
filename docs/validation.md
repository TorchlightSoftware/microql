# MicroQL Validation System

MicroQL provides a powerful validation system based on [Zod](https://zod.dev/) that allows you to validate service inputs (precheck) and outputs (postcheck) using JSON-based schema descriptors.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Schema Syntax](#schema-syntax)
- [Service-Level Validation](#service-level-validation)
- [User-Level Validation](#user-level-validation)
- [Precheck vs Postcheck](#precheck-vs-postcheck)
- [Error Messages](#error-messages)
- [Examples](#examples)

## Basic Usage

Validation in MicroQL can be defined at two levels:

1. **Service-level validation**: Defined on service methods to enforce contracts
2. **User-level validation**: Defined in queries to add additional constraints

### Quick Example

```javascript
// Service with validation
const userService = {
  async createUser(args) {
    // Create user logic
    return { id: 123, ...args.userData }
  }
}

// Add service-level validation
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

// Query with additional user-level validation
const config = {
  services: { userService },
  queries: {
    newUser: ['userService', 'createUser', {
      userData: {
        name: 'John Doe',
        email: 'john@example.com',
        age: 25
      },
      // Additional validation at query level
      precheck: {
        userData: {
          age: ['number', {min: 18, max: 65}]
        }
      }
    }]
  }
}
```

## Schema Syntax

MicroQL uses a JSON-based syntax that gets transformed into Zod schemas. There are three main forms:

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

### 3. Wrapper Functions

```javascript
// Arrays
['array', ['string']]
['array', ['number'], {min: 2, max: 10}]

// Unions
['union', [['string'], ['number']]]

// Nullable wrapper
['nullable', ['string']]

// Optional wrapper
['optional', ['number']]
```

## Service-Level Validation

Define validation on service methods using the `_validators` property:

```javascript
const myService = {
  async processData(args) {
    // Service logic
    return result
  }
}

myService.processData._validators = {
  precheck: {
    input: ['string', {min: 1}],
    options: {
      format: ['string', 'optional'],
      limit: ['number', 'positive', 'optional']
    }
  },
  postcheck: {
    result: ['string'],
    count: ['number', 'positive']
  }
}
```

## User-Level Validation

Add validation constraints at the query level:

```javascript
const config = {
  services: { myService },
  queries: {
    process: ['myService', 'processData', {
      input: 'hello world',
      options: { format: 'uppercase', limit: 100 },
      // Additional validation
      precheck: {
        options: {
          limit: ['number', {max: 50}] // More restrictive than service
        }
      }
    }]
  }
}
```

## Precheck vs Postcheck

- **Precheck**: Validates service arguments before execution
- **Postcheck**: Validates service results after execution

Both service-level and user-level validations are combined, with user-level validations adding to (not replacing) service-level validations.

## Error Messages

Validation errors provide clear, detailed messages:

```
Precheck validation failed:
- userData.age: Too small: expected number to be >=18
- userData.email: Invalid email
```

## Examples

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
      ['transformer', 'step1', {
        value: 10,
        precheck: { value: ['number', {min: 0, max: 100}] }
      }],
      ['transformer', 'step2', {
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

## Available Validators

### String Validators
- `email` - Valid email address
- `url` - Valid URL
- `uuid` - Valid UUID
- `min: n` - Minimum length
- `max: n` - Maximum length
- `length: n` - Exact length
- `regex: /pattern/` - Match regular expression

### Number Validators
- `positive` - Greater than 0
- `negative` - Less than 0
- `integer` / `int` - Integer value
- `finite` - Finite number (not Infinity)
- `min: n` - Minimum value
- `max: n` - Maximum value

### Array Validators
- `min: n` - Minimum length
- `max: n` - Maximum length
- `length: n` - Exact length

### Common Modifiers
- `optional` - Value can be undefined
- `nullable` - Value can be null
- `default: value` - Default value if undefined

### Special Types
- `enum` - Enumerated values
- `date` - Date objects with optional min/max constraints
- `any` - Any value (no validation)
- `unknown` - Unknown value (safer than any)
