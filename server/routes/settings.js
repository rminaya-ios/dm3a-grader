// routes/settings.js
// DM3A Hub — the signed-in instructor's Settings document. Mounted at
// /api/my/settings. Shared by every tool; edited from the hub's Settings tile.
//
//   GET  /    the caller's settings (created with defaults on first read)
//   PUT  /    replace any of: bands, bbPoints, latePolicy (validated)
//
// Always scoped to the caller (lib/owner.js); there is no way to name another
// owner's settings, so there is nothing to leak.

const express = require('express');
const Settings = require('../models/Settings.js');
const { requireAuth } = require('../lib/auth.js');
const { ownerFilter } = require('../lib/owner.js');
const { validateSettings } = require('../lib/settingsRules.js');

const router = express.Router();
router.use(requireAuth);

async function loadOrCreate(req) {
  const filter = ownerFilter(req, 'ownerId');
  // Upsert so two first-loads at once can't both insert (ownerId is unique).
  return Settings.findOneAndUpdate(filter, { $setOnInsert: filter }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

router.get('/', async (req, res) => {
  try {
    const doc = await loadOrCreate(req);
    return res.json({ settings: doc.toPublic() });
  } catch (err) {
    console.error('[settings] get error:', err.message);
    return res.status(500).json({ error: 'Could not load settings.' });
  }
});

router.put('/', async (req, res) => {
  try {
    const check = validateSettings(req.body);
    if (!check.ok) return res.status(400).json({ error: check.error });
    await loadOrCreate(req);
    const doc = await Settings.findOneAndUpdate(ownerFilter(req, 'ownerId'), { $set: check.value }, { new: true, runValidators: true });
    return res.json({ settings: doc.toPublic() });
  } catch (err) {
    console.error('[settings] put error:', err.message);
    return res.status(500).json({ error: 'Could not save settings.' });
  }
});

module.exports = router;
