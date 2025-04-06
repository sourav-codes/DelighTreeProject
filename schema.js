const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid'); // at the top of your file
const {
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  GraphQLInt,
  GraphQLList,
  GraphQLID,
  GraphQLFloat,
  GraphQLInputObjectType,
  GraphQLNonNull,
} = require('graphql');

const Order = require('./models/Order');
const Product = require('./models/Product');
const redisClient = require('./redisClient');

// ---------- OrderType ----------
const OrderType = new GraphQLObjectType({
  name: 'Order',
  fields: () => ({
    _id: { type: GraphQLString },
    customerId: { type: GraphQLString },
    totalAmount: { type: GraphQLFloat },
    orderDate: { type: GraphQLString },
    status: { type: GraphQLString },
  }),
});

// ---------- Input ----------
const OrderProductInput = new GraphQLInputObjectType({
  name: 'OrderProductInput',
  fields: () => ({
    productId: { type: new GraphQLNonNull(GraphQLString) },
    quantity: { type: new GraphQLNonNull(GraphQLInt) },
  }),
});

// ---------- Customer Spending ----------
const CustomerSpendingType = new GraphQLObjectType({
  name: 'CustomerSpending',
  fields: () => ({
    customerId: { type: GraphQLString },
    totalSpent: { type: GraphQLFloat },
    averageOrderValue: { type: GraphQLFloat },
    lastOrderDate: { type: GraphQLString },
  }),
});

const getCustomerSpending = {
  type: CustomerSpendingType,
  args: { customerId: { type: GraphQLString } },
  async resolve(_, { customerId }) {
    try {
    
      const orders = await Order.aggregate([
        { $match: { customerId: customerId, status: 'completed' } },
        {
          $group: {
            _id: '$customerId',
            totalSpent: { $sum: '$totalAmount' },
            averageOrderValue: { $avg: '$totalAmount' },
            lastOrderDate: { $max: '$orderDate' },
          },
        },
      ]);
      return (
        orders[0] || { customerId, totalSpent: 0, averageOrderValue: 0, lastOrderDate: null }
      );
    } catch (error) {
      throw new Error(`Failed to fetch customer spending: ${error.message}`);
    }
  },
};

// ---------- Top Selling Products ----------
const TopProductType = new GraphQLObjectType({
  name: 'TopProduct',
  fields: () => ({
    productId: { type: GraphQLString },
    name: { type: GraphQLString },
    totalSold: { type: GraphQLInt },
  }),
});

const getTopSellingProducts = {
  type: new GraphQLList(TopProductType),
  args: { limit: { type: GraphQLInt, defaultValue: 10 } },
  async resolve(_, { limit }) {
    try {
      const result = await Order.aggregate([
        { $unwind: '$products' },
        {
          $group: {
            _id: '$products.productId',
            totalSold: { $sum: '$products.quantity' },
          },
        },
        { $sort: { totalSold: -1 } },
        { $limit: limit }, 
        {
          $lookup: {
            from: 'products', 
            localField: '_id', 
            foreignField: '_id', 
            as: 'productDetails',
          },
        },
        { $unwind: { path: '$productDetails', preserveNullAndEmptyArrays: true } }, 
        {
          $project: {
            productId: '$_id', 
            name: { $ifNull: ['$productDetails.name', 'Unknown Product'] },
            totalSold: 1, 
          },
        },
      ]);

      return result;
    } catch (error) {
      throw new Error(`Failed to fetch top selling products: ${error.message}`);
    }
  },
};

// ---------- Sales Analytics ----------
const CategoryBreakdownType = new GraphQLObjectType({
  name: 'CategoryBreakdown',
  fields: () => ({
    category: { type: GraphQLString },
    revenue: { type: GraphQLFloat },
  }),
});

const SalesAnalyticsType = new GraphQLObjectType({
  name: 'SalesAnalytics',
  fields: () => ({
    totalRevenue: { type: GraphQLFloat },
    completedOrders: { type: GraphQLInt },
    categoryBreakdown: { type: new GraphQLList(CategoryBreakdownType) },
  }),
});

const getSalesAnalytics = {
  type: SalesAnalyticsType,
  args: {
    startDate: { type: GraphQLString },
    endDate: { type: GraphQLString },
  },
  async resolve(_, { startDate, endDate }) {
    try {
      const cacheKey = `sales:${startDate}:${endDate}`;
      const cached = await redisClient.get(cacheKey).catch(() => null);
      if (cached) return JSON.parse(cached);

      const analytics = await Order.aggregate([
        {
          $match: {
            status: 'completed',
            orderDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$totalAmount' },
            completedOrders: { $sum: 1 },
          },
        },
      ]);

      const categoryBreakdown = await Order.aggregate([
        {
          $match: {
            orderDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
            status: 'completed',
          },
        },
        { $unwind: '$products' },
        {
          $lookup: {
            from: 'products',
            localField: 'products.productId',
            foreignField: '_id',
            as: 'productDetails',
          },
        },
        { $unwind: { path: '$productDetails', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: '$productDetails.category',
            revenue: { $sum: { $multiply: ['$products.priceAtPurchase', '$products.quantity'] } },
          },
        },
        { $project: { category: '$_id', revenue: 1 } },
      ]);

      const result = {
        totalRevenue: analytics[0]?.totalRevenue || 0,
        completedOrders: analytics[0]?.completedOrders || 0,
        categoryBreakdown,
      };

      await redisClient.setEx(cacheKey, 300, JSON.stringify(result)).catch((err) => {
        console.error(`Redis cache error: ${err.message}`);
      });

      return result;
    } catch (error) {
      throw new Error(`Failed to fetch sales analytics: ${error.message}`);
    }
  },
};

// ---------- Paginated Orders ----------
const OrderListType = new GraphQLObjectType({
  name: 'OrderList',
  fields: () => ({
    orders: { type: new GraphQLList(OrderType) },
    totalCount: { type: GraphQLInt },
  }),
});

const getCustomerOrders = {
  type: OrderListType,
  args: {
    customerId: { type: GraphQLString },
    limit: { type: GraphQLInt, defaultValue: 10 },
    offset: { type: GraphQLInt, defaultValue: 0 },
  },
  async resolve(_, { customerId, limit, offset }) {
    try {
      const orders = await Order.find({ customerId })
        .skip(offset)
        .limit(limit)
        .sort({ orderDate: -1 });

      const totalCount = await Order.countDocuments({ customerId });

      return { orders, totalCount };
    } catch (error) {
      throw new Error(`Failed to fetch customer orders: ${error.message}`);
    }
  },
};

// ---------- Place Order ----------
const placeOrder = {
  type: OrderType,
  args: {
    customerId: { type: new GraphQLNonNull(GraphQLString) },
    products: { type: new GraphQLNonNull(new GraphQLList(OrderProductInput)) },
  },
  async resolve(_, { customerId, products }) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const productData = await Product.find({
        _id: { $in: products.map((p) => p.productId) },
      });

      const orderItems = [];
      let totalAmount = 0;

      for (const item of products) {
        if (item.quantity <= 0) {
          throw new Error('Quantity must be greater than 0');
        }

        const prod = productData.find((p) => p._id === item.productId);
        if (!prod) throw new Error(`Invalid product ID: ${item.productId}`);
        if (prod.stock < item.quantity) {
          throw new Error(`Insufficient stock for product ${prod._id}`);
        }

        const priceAtPurchase = prod.price;
        totalAmount += priceAtPurchase * item.quantity;

        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          priceAtPurchase,
        });

        prod.stock -= item.quantity;
        await prod.save({ session });
      }

      const newOrder = new Order({
        _id: uuidv4(),
        customerId,
        products: orderItems,
        totalAmount,
        orderDate: new Date(),
        status: 'completed',
      });

      await newOrder.save({ session });
      await session.commitTransaction();
      return newOrder;
    } catch (error) {
      await session.abortTransaction();
      throw new Error(`Failed to place order: ${error.message}`);
    } finally {
      session.endSession();
    }
  },
};

// ---------- Root Schema ----------
const RootQuery = new GraphQLObjectType({
  name: 'Query',
  fields: {
    getCustomerSpending,
    getTopSellingProducts,
    getSalesAnalytics,
    getCustomerOrders,
  },
});

const Mutation = new GraphQLObjectType({
  name: 'Mutation',
  fields: {
    placeOrder,
  },
});

module.exports = new GraphQLSchema({
  query: RootQuery,
  mutation: Mutation,
});