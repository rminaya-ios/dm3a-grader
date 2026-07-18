// models/RosterVault.js
// DM3A Grader — Blind Grading Mode, roster mapping vault (spec §2.3, option 1)
//
// Stores the instructor's alias→name mapping as an OPAQUE, client-side-encrypted
// blob. The server never receives the passphrase and CANNOT decrypt this — it is
// pure ciphertext at rest, keyed by an opaque courseId. This exists only to give
// instructors multi-device access to their own encrypted mapping.

const mongoose = require('mongoose');

const rosterVaultSchema = new mongoose.Schema(
  {
    // Opaque course identifier (e.g. courseCode or a client-generated id).
    // There is no Course collection in this app; the vault is keyed by this string.
    courseId: {
      type: String,
      required: true,
      unique: true, // also creates the lookup index
      trim: true,
    },

    // Client-side-encrypted blob, stored verbatim. Shape (before base64/JSON):
    //   { salt, iv, ciphertext, kdf: 'argon2id'|'pbkdf2', kdfParams }
    // Accepted as an object or a base64 string; the server treats it as opaque.
    blob: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timestamps: true,   // createdAt + updatedAt (updatedAt = last vault sync)
    minimize: false,    // keep empty sub-objects if any
  }
);

module.exports = mongoose.model('RosterVault', rosterVaultSchema);
