const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { ApolloServer } = require('apollo-server-express');
const schema = require('./schema'); // This should export typeDefs and resolvers
require('dotenv').config();

async function startServer() {
  const app = express();

  app.use(cors());
  // MongoDB connection
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('MongoDB Connected');

  // Setup Apollo Server
  const server = new ApolloServer({
    schema,
    introspection: true, // Allow introspection (important for playground)
    csrfPrevention: true,
  });

  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () =>
    console.log(`🚀 Apollo Server ready at http://localhost:${PORT}${server.graphqlPath}`)
  );
}

startServer().catch((err) => {
  console.error('Failed to start server', err);
});
