# Zodly syntax vs zodex

Zodly is a serialization format for zod.  It was designed to be ergonomic for authorship and readibility.  Here is a comparison with zodex, another serialization format for zod.

## Simple Type Declarations

The default (shorthand) notation for a type in `zodly` is to simply use its name inside an array.  Any additional array members are interpreted as modifiers.  An object can be passed as the last array member which allows any modifiers that themselves take parameters.

| zodly | zodex |
|---|---|
| `['string']` | `{"type": "string"}` |
| `['number']` | `{"type": "number"}` |
| `['boolean']` | `{"type": "boolean"}` |
| `['date']` | `{"type": "date"}` |
| `['string', 'email']` | `{"type": "string", "kind": "email"}` |
| `['number', 'positive', 'int']` | `{"type": "number", "min": 0, "format": "safeint"}` |
| `['string', {min: 5, max: 100}]` | `{"type": "string", "min": 5, "max": 100}` |
| `['string', 'optional']` | `{"type": "string", "isOptional": true}` |
| `['number', 'nullable']` | `{"type": "number", "isNullable": true}` |
| `['string', 'optional', 'nullable']` | `{"type": "string", "isOptional": true, "isNullable": true}` |
| `['number', 'positive', 'int', 'optional']` | `{"type": "number", "min": 0, "format": "safeint", "isOptional": true}` |
| `['error']` | an error in canonical object representation (below) |
| `['error', 'optional']` | the same, with `"isOptional": true` |

## Object Declarations

Anywhere a type is expected, object syntax is also permissible, and represents an object in the target document.  Since type refinements always occur as the second argument of an array, zodly can represent objects in direct form without a nested "properties".

```javascript
// zodly
{
  name: ['string'],
  age: ['number', 'positive'],
  email: ['string', 'email', 'optional']
}
```

```json
{
  "type": "object",
  "properties": {
    "name": {"type": "string"},
    "age": {"type": "number", "min": 0},
    "email": {"type": "string", "kind": "email", "isOptional": true}
  }
}
```

## Complex Declarations

For annotating more complex data types, every type is expressible in array notation, and can be nested in this way.

| zodly | zodex |
|---|---|
| `['array', ['string']]` | `{"type": "array", "element": {"type": "string"}}` |
| `['array', ['number'], {min: 2, max: 10}]` | `{"type": "array", "element": {"type": "number"}, "minLength": 2, "maxLength": 10}` |
| `['array', ['string'], 'optional']` | `{"type": "array", "element": {"type": "string"}, "isOptional": true}` |
| `['array', ['string'], 'nullable']` | `{"type": "array", "element": {"type": "string"}, "isNullable": true}` |
| `['array']` | `{"type": "array", "element": {"type": "any"}}` |
| `['object', {name: ['string'], age: ['number']}]` | `{"type": "object", "properties": {"name": {"type": "string"}, "age": {"type": "number"}}}` |
| `{name: ['string'], age: ['number']}` | same as above |
| `['object', {name: ['string']}, 'optional']` | `{"type": "object", "properties": {"name": {"type": "string"}}, "isOptional": true}` |
| `['object', {name: ['string']}, 'nullable']` | `{"type": "object", "properties": {"name": {"type": "string"}}, "isNullable": true}` |
| `['object']` | `{"type": "object", "properties": {}, "unknownKeys": "passthrough"}` (**verify**: depends on how our parser builds "any object") |
| `['union', ['string'], ['number']]` | `{"type": "union", "options": [{"type": "string"}, {"type": "number"}]}` |
| `['union', ['string'], ['number'], 'optional']` | `{"type": "union", "options": [{"type": "string"}, {"type": "number"}], "isOptional": true}` |
| `['union', ['string'], ['number'], 'nullable']` | `{"type": "union", "options": [{"type": "string"}, {"type": "number"}], "isNullable": true}` |
| `['enum', ['red', 'green', 'blue']]` | `{"type": "enum", "values": {"red": "red", "green": "green", "blue": "blue"}}` |
| `['enum', ['red', 'blue', 'green'], 'optional']` | `{"type": "enum", "values": {"red": "red", "blue": "blue", "green": "green"}, "isOptional": true}` |
| `['tuple', ['string'], ['number']]` | `{"type": "tuple", "items": [{"type": "string"}, {"type": "number"}]}` |
| `['tuple', ['string'], ['number'], 'optional']` | `{"type": "tuple", "items": [{"type": "string"}, {"type": "number"}], "isOptional": true}` |
| `['nullable', ['string']]` | `{"type": "string", "isNullable": true}` |
| `['optional', ['number']]` | `{"type": "number", "isOptional": true}` |

## Error Declaration

zod and zodex do not have any canonical way of expressing an error.

zodly's `error` is an error as data: a JSON-LD node of type `Error`, with an Error's `name` and `message`. Only those three are checked; any other field is allowed, so whoever produces errors can add fields of its own. By convention `cause` is the error behind it, in the same form.

```javascript
{'@type': 'Error', name: 'TypeError', message: 'not a number', cause: {'@type': 'Error', name: 'Error', message: 'bad input'}}
```

Using this form, you can make any Error recognizeable by zodly simply by adding `@type: 'Error` to it.

Since zod/zodex have no error type of their own, they would represent this as the underlying object schema:

```json
{
  "type": "object",
  "properties": {
    "@type": {"type": "literal", "values": ["Error"]},
    "name": {"type": "string"},
    "message": {"type": "string"}
  },
  "catchall": {"type": "unknown"}
}
```

Unlike JSON-LD, zodly does not support a list of types (`['Error', 'Thing']`). That's because this is not a serializable form in zodex, and we thought it safer to maintain compatibility than to chase after an edge case.  If you want this: tell us.

## Service Call and Service Schema Validations (from MicroQL)

```javascript
// zodly: the Query author's check on one call
precheck: {
  userData: {
    age: ['number', {min: 18, max: 65}]
  }
}
```

```json
{
  "type": "object",
  "properties": {
    "userData": {
      "type": "object",
      "properties": {
        "age": {"type": "number", "min": 18, "minInclusive": true, "max": 65, "maxInclusive": true}
      }
    }
  }
}
```

```javascript
// zodly: a call's own checks
['[userService]/createUser', {
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
}]
```

```json
{
  "precheck": {
    "type": "object",
    "properties": {
      "userData": {
        "type": "object",
        "properties": {
          "name": {"type": "string"},
          "email": {"type": "string", "kind": "email"},
          "age": {"type": "number", "min": 0}
        }
      }
    }
  },
  "postcheck": {
    "type": "object",
    "properties": {
      "id": {"type": "number"},
      "name": {"type": "string"},
      "email": {"type": "string", "kind": "email"}
    }
  }
}
```

## Service arguments convention

```javascript
// zodly
precheck: {on: ['array'], service: ['any']}
```

```json
{
  "type": "object",
  "properties": {
    "on": {"type": "array", "element": {"type": "any"}},
    "service": {"type": "any"}
  }
}
```

## Basic string validation

```javascript
// zodly
precheck: {
  to: ['string', 'email'],
  subject: ['string', {min: 1, max: 200}],
  body: ['string']
}
```

```json
{
  "type": "object",
  "properties": {
    "to": {"type": "string", "kind": "email"},
    "subject": {"type": "string", "min": 1, "max": 200},
    "body": {"type": "string"}
  }
}
```

## Number validation with constraints

```javascript
// zodly
precheck: {
  numerator: ['number'],
  denominator: ['number', {min: 0.0001}]
},
postcheck: ['number', 'finite']
```

```json
{
  "precheck": {
    "type": "object",
    "properties": {
      "numerator": {"type": "number"},
      "denominator": {"type": "number", "min": 0.0001, "minInclusive": true}
    }
  },
  "postcheck": {"type": "number"}
}
```

## Array validation

```javascript
// zodly
precheck: {
  items: ['array', ['string'], {min: 1, max: 100}],
  options: {
    parallel: ['boolean', 'optional'],
    timeout: ['number', 'positive', 'optional']
  }
}
```

```json
{
  "type": "object",
  "properties": {
    "items": {"type": "array", "element": {"type": "string"}, "minLength": 1, "maxLength": 100},
    "options": {
      "type": "object",
      "properties": {
        "parallel": {"type": "boolean", "isOptional": true},
        "timeout": {"type": "number", "min": 0, "isOptional": true}
      }
    }
  }
}
```

## Complex nested objects

```javascript
// zodly
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
```

```json
{
  "type": "object",
  "properties": {
    "order": {
      "type": "object",
      "properties": {
        "customer": {
          "type": "object",
          "properties": {
            "id": {"type": "string", "kind": "uuid"},
            "email": {"type": "string", "kind": "email"}
          }
        },
        "items": {
          "type": "array",
          "element": {
            "type": "object",
            "properties": {
              "productId": {"type": "string"},
              "quantity": {"type": "number", "min": 0, "format": "safeint"},
              "price": {"type": "number", "min": 0}
            }
          },
          "minLength": 1
        },
        "shipping": {
          "type": "object",
          "properties": {
            "address": {"type": "string"},
            "city": {"type": "string"},
            "postalCode": {"type": "string"},
            "country": {"type": "string"}
          }
        }
      }
    }
  }
}
```

## Optional fields

```javascript
// zodly
precheck: {
  userId: ['string', 'uuid'],
  updates: {
    name: ['string', 'optional'],
    bio: ['string', {max: 500}, 'optional'],
    avatar: ['string', 'url', 'optional'],
    age: ['number', 'positive', 'optional']
  }
}
```

```json
{
  "type": "object",
  "properties": {
    "userId": {"type": "string", "kind": "uuid"},
    "updates": {
      "type": "object",
      "properties": {
        "name": {"type": "string", "isOptional": true},
        "bio": {"type": "string", "max": 500, "isOptional": true},
        "avatar": {"type": "string", "kind": "url", "isOptional": true},
        "age": {"type": "number", "min": 0, "isOptional": true}
      }
    }
  }
}
```

## Using validation in chains

```javascript
// zodly: the Query author's checks on two calls
['[transformer]/step1', {value: 10, precheck: {value: ['number', {min: 0, max: 100}]}}],
['[transformer]/step2', {value: '@', precheck: {value: ['number', {max: 200}]}}]
```

```json
[
  ["[transformer]/step1", {"value": 10, "precheck": {
    "type": "object",
    "properties": {"value": {"type": "number", "min": 0, "minInclusive": true, "max": 100, "maxInclusive": true}}
  }}],
  ["[transformer]/step2", {"value": "@", "precheck": {
    "type": "object",
    "properties": {"value": {"type": "number", "max": 200, "maxInclusive": true}}
  }}]
]
```

## Regex validation

```javascript
// zodly
precheck: {
  username: ['string', {regex: /^[a-zA-Z0-9_]{3,20}$/}],
  password: ['string', {min: 8, regex: /^(?=.*[A-Za-z])(?=.*\d)/}],
  phone: ['string', {regex: /^\+?[1-9]\d{1,14}$/}, 'optional']
}
```

```json
{
  "type": "object",
  "properties": {
    "username": {"type": "string", "regex": "^[a-zA-Z0-9_]{3,20}$"},
    "password": {"type": "string", "min": 8, "regex": "^(?=.*[A-Za-z])(?=.*\\d)"},
    "phone": {"type": "string", "regex": "^\\+?[1-9]\\d{1,14}$", "isOptional": true}
  }
}
```

In JSON, a regex is a string, so every backslash is doubled.

## Enum validation

```javascript
// zodly
precheck: {
  theme: ['enum', ['light', 'dark', 'auto']],
  language: ['enum', ['en', 'es', 'fr', 'de']],
  notifications: {
    email: ['boolean'],
    push: ['boolean'],
    frequency: ['enum', ['instant', 'daily', 'weekly'], 'optional']
  }
}
```

```json
{
  "type": "object",
  "properties": {
    "theme": {"type": "enum", "values": {"light": "light", "dark": "dark", "auto": "auto"}},
    "language": {"type": "enum", "values": {"en": "en", "es": "es", "fr": "fr", "de": "de"}},
    "notifications": {
      "type": "object",
      "properties": {
        "email": {"type": "boolean"},
        "push": {"type": "boolean"},
        "frequency": {"type": "enum", "values": {"instant": "instant", "daily": "daily", "weekly": "weekly"}, "isOptional": true}
      }
    }
  }
}
```

## Date validation

```javascript
// zodly
precheck: {
  title: ['string'],
  startDate: ['date', {min: new Date()}], // must be in the future
  endDate: ['date'],
  recurring: ['enum', ['none', 'daily', 'weekly', 'monthly'], 'optional']
}
```

```json
{
  "type": "object",
  "properties": {
    "title": {"type": "string"},
    "startDate": {"type": "date", "min": 1791590400000},
    "endDate": {"type": "date"},
    "recurring": {"type": "enum", "values": {"none": "none", "daily": "daily", "weekly": "weekly", "monthly": "monthly"}, "isOptional": true}
  }
}
```

**"Must be in the future" can't be expressed in a JSON document.** `new Date()` is evaluated once, when the document is written, and saved as a fixed epoch time. The zodly example has the same flaw: a service module evaluates `new Date()` once, at load.

## What the comparison shows

- **zodex is 2–4× longer**, mostly because of `"type"`, `"properties"` and `"element"` wrappers. The shorthand object and the positional `['array', ['string']]` are where our syntax saves the most.
- **Neither is lossless the other way.** Our syntax has no counterpart for zodex's `discriminatedUnion`, `record`, `literal`, defaults or descriptions. zodex has no clean `int` (**verify**), turns regexes into strings, and has no name for `error`.
