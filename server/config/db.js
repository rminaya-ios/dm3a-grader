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
    // FAIL OPEN: a DB connection failure must NOT take the whole backend down. Grading,
    // access codes (Redis), and redaction all work without Mongo; only DB-backed features
    // (admin stats, at-risk) degrade until it reconnects. Previously this did process.exit(1),
    // so a single DB/network blip (e.g. Railway egress moving outside the Atlas allow-list)
    // crash-looped the entire service. Log, keep serving, and retry in the background.
    console.error(`❌ MongoDB connection error (continuing WITHOUT DB, retrying in 15s): ${error.message}`);
    setTimeout(connectDB, 15000);
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
