const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  _id: String,
  customerId: String,
  products: [
    {
      productId: String,
      quantity: Number,
      priceAtPurchase: Number,
    },
  ],
  totalAmount: Number,
  orderDate: Date,
  status: String,
});

module.exports = mongoose.model('Order', OrderSchema);
