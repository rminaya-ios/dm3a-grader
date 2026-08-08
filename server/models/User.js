// models/User.js
// DM3A Grader — instructor accounts.
//
// Replaces the single shared app password with per-instructor logins. A User owns
// Courses (models/Course.js) and, after the accounts migration, their historical
// Submissions / AtRiskFlags (scripts/migrateToAccounts.js).
//
// SECURITY: only a bcrypt hash of the password is ever stored — never the plain
// password, and never in a log line. Password-reset tokens are likewise stored as
// a SHA-256 hash, so a database leak can't be replayed to seize an account.

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    // Login identity. Lowercased + trimmed on write so "Ralph@X.com" and
    // "ralph@x.com" can never become two accounts.
    email: {
      type: String,
      required: true,
      unique: true, // also creates the lookup index
      trim: true,
      lowercase: true,
    },

    // bcrypt hash (cost 12). Never the plain password.
    passwordHash: {
      type: String,
      required: true,
    },

    // Display name, e.g. "Dr. Ralph Minaya". Cosmetic only.
    name: {
      type: String,
      default: '',
      trim: true,
    },

    // ── Password reset (routes/auth.js) ──────────────────────────────────────
    // SHA-256 of the token that was emailed; the raw token exists only in the
    // user's inbox. Cleared on use so a link is strictly single-use.
    resetTokenHash: {
      type: String,
      default: null,
      select: false, // never returned by a default query
    },
    resetTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true, // createdAt + updatedAt
  }
);

// Shape sent to the browser. Explicit allow-list rather than a delete-list, so a
// future sensitive field can't leak by being forgotten here.
userSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    email: this.email,
    name: this.name || '',
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
