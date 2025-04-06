const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  _id: String,
  name: String,
  category: String,
  price: Number,
  stock: Number,
});

module.exports = mongoose.model('Product', ProductSchema);
