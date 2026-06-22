// config/db.js
// DM3A Grader — MongoDB Atlas connection
// Phase 1: Database setup
// Drop into: /server/config/db.js on Railway backend

const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // These options prevent deprecation warnings and
      // ensure stable connections under Railway's environment
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    // Exit process so Railway restarts the container cleanly
    process.exit(1);
  }
};

// Graceful shutdown — important for Railway deployments
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected. Attempting reconnect...');
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('MongoDB connection closed on app termination.');
  process.exit(0);
});

module.exports = connectDB;
