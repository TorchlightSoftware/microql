# Creating seed data with MicroQL

Here's an example of using `MicroQL` together with `loopback-factory` to generate seed data with complex relationships.  All in a declarative JSON DSL.

```js
const query = require('microql')
const factory = Factory.service

// create a bunch of data, yo.
query({
  services: {factory},
  jobs: {

    account: ['factory', 'create', {args: ['Account']}],
    users: ['factory', 'createGroup', {args: ['Staff', [
      {email: 'rick@example.com', first_name: 'Rick', last_name: 'Master of the Universe'},
      {email: 'morty@example.com', first_name: 'Morty', last_name: 'Smith'},
      {email: 'summer@example.com', first_name: 'Summer', last_name: 'Smith'},
    ].map(r => _.merge(r, {account_id: '$.trumanAccount.id'}))
     .map(createPassword)
    ]}],

  },

}, done)
```
