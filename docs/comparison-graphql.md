# MicroQL vs GraphQL: Detailed Comparison

MicroQL and GraphQL solve different problems despite both being query languages. Understanding these differences helps you choose the right tool for your use case.

## Core Philosophy

**MicroQL**: Designed for **service orchestration** - composing and coordinating multiple service calls into workflows with automatic dependency resolution and parallel execution.

**GraphQL**: Designed for **data selection** - allowing clients to specify exactly which fields they want from a connected data graph.

## Architecture Comparison

### Execution Model

**MicroQL** uses **staged execution** with automatic parallelization:
- Analyzes dependencies at compile-time
- Creates execution stages where independent operations run in parallel  
- Three 10ms delays complete in ~12ms (proven by performance tests)
- 50 parallel operations with random delays complete in ~6ms

**GraphQL** uses **field-by-field resolution**:
- Resolvers execute in parent-child chains
- Parallelism requires manual optimization (DataLoader, etc.)
- Each field resolver decides how to fetch its data

### Dependency Resolution

**MicroQL**: **Automatic** - infers dependencies from `$` and `@` references
```javascript
phases: {
  profile: ['[users]/getProfile', {id: '$given.userId'}],
  auditLog: ['[audit]/log', {user: '$profile'}]  // Auto-detects dependency on profile
}
```

**GraphQL**: **Manual** - developers write resolver logic
```javascript
const resolvers = {
  Query: {
    auditLog: async (parent, args, context) => {
      const profile = await getProfile(args.userId)  // Manual orchestration
      return logAccess(profile)
    }
  }
}
```

## Query Language Comparison

### MicroQL: JSON-Based Service Calls

```javascript
// Service orchestration with dependency chains
const result = await query({
  given: {userId: 'user123'},
  services: {users, notifications, audit},
  phases: {
    // These run in parallel (no dependencies)
    user: ['[users]/getProfile', {id: '$given.userId'}],
    preferences: ['[users]/getPreferences', {id: '$given.userId'}],
    
    // This waits for user data (has dependency)
    notification: ['[notifications]/send', {
      to: '$user.email',
      name: '$user.name'
    }],
    
    // Sequential chain with @ context passing
    pipeline: [
      ['[data]/extract', {source: '$given.data'}],
      ['[data]/transform', {input: '@'}],        // @ = previous step result
      ['[data]/validate', {processed: '@'}]
    ]
  }
})
```

### GraphQL: Field Selection Language

```graphql
# Field selection from connected graph
query {
  user(id: "user123") {
    id
    name
    email
    posts {
      title
      comments {
        text
        author {
          name
        }
      }
    }
  }
}
```

## Service Definition Patterns

### MicroQL Services
Simple async functions focused on business logic:

```javascript
const userService = defineService({
  async '/getProfile'({id}) {
    return await db.users.findById(id)
  },
  
  // Optional: declare the input, as a validation contract
  '/updateProfile': {
    input: {
      id: [['type', ['string', 'uuid']]],
      updates: [['type', ['object', {name: ['string', 'optional'], email: ['string', 'email', 'optional']}]]]
    },
    call: async ({id, updates}) => db.users.update(id, updates)
  }
})
```

### GraphQL Resolvers
Functions that resolve fields with context awareness:

```javascript
const resolvers = {
  Query: {
    user: (parent, {id}, context, info) => {
      return context.dataSources.users.findById(id)
    }
  },
  
  User: {
    posts: (user, args, context) => {
      return context.dataSources.posts.findByUserId(user.id)
    }
  },
  
  Post: {
    author: (post, args, context) => {
      return context.dataSources.users.findById(post.authorId)
    }
  }
}
```

## Data Flow Patterns

### MicroQL: Orchestration Patterns

**Parallel Execution**: Independent queries run simultaneously
```javascript
phases: {
  user: ['[users]/get', {id: '$given.userId'}],
  orders: ['[orders]/getByUser', {userId: '$given.userId'}],
  preferences: ['[prefs]/get', {userId: '$given.userId'}]
  // All three execute in parallel
}
```

**Sequential Chains**: Multi-step workflows with context passing
```javascript
phases: {
  pipeline: [
    ['[parser]/parseCSV', {data: '$given.csvData'}],
    ['[validator]/check', {rows: '@'}],          // @ = parsed data
    ['[transformer]/enrich', {data: '@'}],       // @ = validated data
    ['[storage]/save', {records: '@'}]           // @ = enriched data
  ]
}
```

**Method Syntax**: Functional composition
```javascript
phases: {
  result: ['$given.data', '[transform]/filter', {service: ['[data]/isActive', {item: '@'}]}],
  upper: ['$result', '[transform]/map', {service: ['[string]/toUpperCase', {text: '@'}]}]
}
```

### GraphQL: Field Resolution Patterns

**Nested Selection**: Parent-child field resolution
```graphql
query {
  user(id: "123") {     # Root resolver
    name                # Field resolver (may use default)
    posts {             # Field resolver gets user as parent
      title             # Field resolver gets post as parent
      comments {        # Field resolver gets post as parent
        text            # Field resolver gets comment as parent
      }
    }
  }
}
```

## Error Handling Philosophy

### MicroQL: Built-in Resilience

```javascript
phases: {
  user: ['[util]/try', {
    service: ['[users]/getUser', {
      id: '$given.userId',
      retry: 3,                                 // Built-in retry
      timeout: 5000                             // Built-in timeout
    }],
    catch: ['[fallback]/getDefaultUser']        // its result stands in for the user
  }],
  // each order that fails is logged and left out; the rest carry on
  orders: ['$given.orderIds', '[util]/each', {
    service: ['[orders]/get', {id: '@'}],
    catch: ['@err', '[util]/log', {to: 'failed/orders.log'}],
    skip: ['error']
  }]
}

// A phase that fails anyway is handled here, and the Run carries on
settings: {
  catch: ['@err', '[logger]/logError']
}
```

### GraphQL: Manual Error Handling

```javascript
const resolvers = {
  Query: {
    user: async (parent, {id}) => {
      try {
        const user = await userService.getById(id)
        if (!user) {
          throw new GraphQLError('User not found', {
            extensions: { code: 'USER_NOT_FOUND' }
          })
        }
        return user
      } catch (error) {
        // Handle specific errors, log, transform, etc.
        throw new GraphQLError('Failed to fetch user')
      }
    }
  }
}
```

## Performance Characteristics

### MicroQL Performance

**Automatic Parallelization**:
- 3 independent 10ms operations complete in ~12ms  
- 50 parallel operations complete in ~6ms
- Compile-time dependency analysis creates optimal execution plan

**Minimal Overhead**:
- Small codebase (~1000 lines)
- Minimal dependencies (zod, @noble/hashes, @tlsft/service-key)
- Direct function calls to services

### GraphQL Performance

**Manual Optimization Required**:
- N+1 query problems common without DataLoader
- Resolver-level parallelism needs careful design
- Query complexity analysis needed for DoS protection

**Rich Ecosystem**:
- Many optimization tools available
- Sophisticated caching strategies
- Advanced query analysis tools

## When to Choose Each

### Choose MicroQL When:

1. **Service Orchestration**: Composing multiple APIs/microservices
2. **Workflow Automation**: Multi-step data processing pipelines  
3. **Team Productivity**: Enable non-technical team members to compose queries
4. **Performance Critical**: Need automatic parallelization without manual optimization
5. **Operational Resilience**: Want built-in retry, timeout, error recovery
6. **Simple Architecture**: Prefer minimal dependencies and straightforward patterns

**Example Use Cases**:
- Data ETL pipelines
- API orchestration layers  
- Business workflow automation
- Microservice coordination
- Integration platforms

### Choose GraphQL When:

1. **Client-Driven APIs**: Clients need flexible field selection
2. **Graph-Like Data**: Natural parent-child relationships in your data
3. **Fine-Grained Control**: Need precise control over field resolution
4. **Rich Tooling**: Want the extensive GraphQL ecosystem
5. **Industry Standards**: Need widely-adopted API patterns
6. **Complex Schemas**: Managing large, interconnected data graphs

**Example Use Cases**:
- Frontend APIs with flexible data requirements
- Mobile apps with bandwidth constraints
- Complex data relationships
- Multi-client APIs
- Real-time subscriptions

## Code Complexity Comparison

### Simple User Profile Query

**MicroQL**:
```javascript
// 8 lines - automatic dependency resolution
const result = await query({
  given: {userId: 'user123'},
  services: {users, audit},
  phases: {
    profile: ['[users]/getProfile', {id: '$given.userId'}],
    logged: ['[audit]/log', {action: 'profile_access', user: '$profile'}]
  }
})
```

**GraphQL**:
```javascript
// 25+ lines - manual resolver implementation
const typeDefs = `
  type Query {
    profile(id: ID!): User
  }
  type User {
    id: ID!
    name: String!
    email: String!
  }
`

const resolvers = {
  Query: {
    profile: async (parent, {id}, context) => {
      const user = await context.dataSources.users.findById(id)
      await context.dataSources.audit.log({
        action: 'profile_access',
        userId: id
      })
      return user
    }
  }
}

const server = new ApolloServer({typeDefs, resolvers})
const result = await server.executeOperation({
  query: 'query { profile(id: "user123") { id name email } }'
})
```

## Summary

**MicroQL** excels at **service orchestration** with automatic dependency resolution, built-in parallelization, and operational resilience. It's ideal for teams building workflow automation, API composition, and data processing pipelines.

**GraphQL** excels at **flexible data access** with client-driven field selection and rich ecosystem tooling. It's ideal for teams building client-facing APIs with complex data relationships.

The choice depends on whether you're primarily **composing services** (MicroQL) or **selecting data** (GraphQL).