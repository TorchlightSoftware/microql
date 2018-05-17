const {expect} = require('chai')

const query = require('..')

const fieldAgent = (action, {animal}, next) => {
  if (action === 'findAnimal') return next(null, animal)
  if (action === 'tranquilize') return next(null, `Sleepy ${animal}`)
}

const truck = (action, {animal}, next) => {
  if (action === 'bringHome') return next(null, `Friendly ${animal}`)
}

describe('query', () => {
  it('should run jobs in series', (done) => {
    query({
      input: {creatureType: 'Monkey'},
      services: {fieldAgent, truck},
      jobs: {

        // result       service        action            args
        monkey:    ['fieldAgent', 'findAnimal',     {animal: '$.input.creatureType'}],
        caged:     ['fieldAgent', 'tranquilize',    {animal: '$.monkey'}],
        pet:       ['truck',      'bringHome',      {animal: '$.caged'}],
      },

    }, (error, {pet}) => {
      // yay, we have a monkey as a pet
      expect(error).to.not.exist
      expect(pet).to.exist
      expect(pet).to.equal('Friendly Sleepy Monkey')
      done()
    })
  })
})
