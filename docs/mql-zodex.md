# MicroQL schema syntax vs zodex

Every example in `docs/validation.md`, translated to the JSON that zodex 4 produces for the same zod schema. The translations follow zodex's serializer (`zodex/dist/zerialize.js`) and type definitions (`types.d.ts`). They're written by hand, not generated, so treat anything marked **verify** as unconfirmed.

How zodex spells the things our syntax has modifiers for:

| MicroQL | zodex |
|---|---|
| `'optional'` | `"isOptional": true` on the type |
| `'nullable'` | `"isNullable": true` on the type |
| `{min: 5}` on a number | `"min": 5, "minInclusive": true` |
| `'positive'` | `"min": 0` (exclusive, so no `minInclusive`) |
| `{min, max}` on a string | `"min"`, `"max"` |
| `{min, max}` on an array | `"minLength"`, `"maxLength"` |
| `'email'`, `'url'`, `'uuid'` | `"kind": "email"` / `"url"` / `"uuid"` |
| `{regex: /…/}` | `"regex": "…"` (a string), plus `"flags"` if any |
| `'int'` | `"format": "safeint"` (**verify**: zodex reads the number format from the schema's own definition, so an `.int()` check may be dropped) |
| `'finite'` | nothing: zod 4 numbers are always finite |
| shorthand object `{a: …}` | `{"type": "object", "properties": {"a": …}}` |
| `['enum', ['a', 'b']]` | `{"type": "enum", "values": {"a": "a", "b": "b"}}` |

## Array syntax

| MicroQL | zodex |
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

## Object syntax

```javascript
// MicroQL
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

## Wrapper types

| MicroQL | zodex |
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

## Direct zod schema

`z.string().min(8).regex(/^[A-Z]/)`:

```json
{"type": "string", "min": 8, "regex": "^[A-Z]"}
```

## Service Call and Service Schema Validations (the opening example)

```javascript
// MicroQL: the Query author's check on one call
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
// MicroQL: a call's own checks
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
// MicroQL
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
// MicroQL
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
// MicroQL
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
// MicroQL
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
// MicroQL
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
// MicroQL
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
// MicroQL: the Query author's checks on two calls
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
// MicroQL
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
// MicroQL
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
// MicroQL
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

**"Must be in the future" can't be expressed in a JSON document.** `new Date()` is evaluated once, when the document is written, and saved as a fixed epoch time. The MicroQL example has the same flaw: a service module evaluates `new Date()` once, at load.

## What the comparison shows

- **zodex is 2–4× longer**, mostly because of `"type"`, `"properties"` and `"element"` wrappers. The shorthand object and the positional `['array', ['string']]` are where our syntax saves the most.
- **Neither is lossless the other way.** Our syntax has no counterpart for zodex's `discriminatedUnion`, `record`, `literal`, defaults or descriptions. zodex has no clean `int` (**verify**) and turns regexes into strings.