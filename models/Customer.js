const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
_id: String,
  name: String,
  email: String,
  age: Number,
  location: String,
  gender: String,
});

module.exports = mongoose.model('Customer', CustomerSchema);
