// utils/apiCost.js
// DM3A Grader — Anthropic API cost estimator
//
// "Estimated cost" ONLY. The Anthropic Console remains the billing source of
// truth. This estimate exists for attribution (who/what/when), not invoicing.
//
// Per-million-token rates are CONFIGURABLE via environment variables so prices
// can change without a code deploy. Defaults match current Sonnet 4.6 standard
// pricing.

/**
 * estimateCostUSD
 * @param {Object} tokens
 * @param {number} tokens.inputTokens
 * @param {number} tokens.outputTokens
 * @param {number} tokens.cacheCreationTokens
 * @param {number} tokens.cacheReadTokens
 * @returns {number} estimated cost in USD
 */
function estimateCostUSD({
  inputTokens = 0,
  outputTokens = 0,
  cacheCreationTokens = 0,
  cacheReadTokens = 0,
} = {}) {
  const p = {
    in:  Number(process.env.ANTHROPIC_PRICE_INPUT_PER_MTOK  ?? 3.00),
    out: Number(process.env.ANTHROPIC_PRICE_OUTPUT_PER_MTOK ?? 15.00),
    cw:  Number(process.env.ANTHROPIC_PRICE_CACHE_WRITE_PER_MTOK ?? 3.75),
    cr:  Number(process.env.ANTHROPIC_PRICE_CACHE_READ_PER_MTOK  ?? 0.30),
  };
  return (
    (inputTokens         / 1_000_000) * p.in  +
    (outputTokens        / 1_000_000) * p.out +
    (cacheCreationTokens / 1_000_000) * p.cw  +
    (cacheReadTokens     / 1_000_000) * p.cr
  );
}

/**
 * extractUsage
 * Normalizes the `usage` object from an Anthropic Messages API response into
 * our internal shape. Cache fields default to 0 when prompt caching is off.
 * Safe on a missing/partial response — returns all zeros.
 * @param {Object} response - Anthropic SDK response (has `.usage`)
 */
function extractUsage(response) {
  const u = (response && response.usage) || {};
  return {
    inputTokens:         u.input_tokens || 0,
    outputTokens:        u.output_tokens || 0,
    cacheCreationTokens: u.cache_creation_input_tokens || 0,
    cacheReadTokens:     u.cache_read_input_tokens || 0,
  };
}

module.exports = { estimateCostUSD, extractUsage };
