/**
 *  Created - 5/11/2017
 *  @author Paul Daniels
 */
const express = require('express');
const graphqlHTTP = require('express-graphql');
const morgan = require('morgan');
const {schema, root} = require('./o2cm/schema');


const app = express();

app.use(morgan('tiny'));

app.use('/graphql', graphqlHTTP({
  schema,
  rootValue: root,
  graphiql: true
}));

process.on('uncaughtException', function(e) {
  console.log('--- CAUGHT BY EVENT ---');
  console.log(e);
});

app.listen(4000, () => console.log('O2CM Server is go!'));