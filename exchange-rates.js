// ============ EXCHANGE RATES CACHING ============
const exchangeRateCache = {
  rates: {},
  lastUpdated: null,
  cacheExpiry: 60 * 60 * 1000 // 1 hour cache
};

/**
 * Fetch exchange rates from external service (with fallback rates)
 */
async function fetchExchangeRates() {
  try {
    // Try to fetch from exchangerate-api.com (free tier available)
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/GHS', {
      timeout: 5000 // 5 second timeout
    });

    if (!response.ok) throw new Error(`API returned ${response.status}`);

    const data = await response.json();
    if (data.rates) {
      return data.rates;
    }
  } catch (error) {
    console.warn('External exchange rate API failed, using fallback rates:', error.message);
  }

  // Fallback rates (approximate, as of deployment date)
  return {
    'GHS': 1,
    'USD': 0.084,
    'GBP': 0.067,
    'NGN': 35.9,
    'CAD': 0.115,
    'ZAR': 1.55,
    'KES': 10.8,
    'UGX': 308,
    'EUR': 0.078,
    'AED': 0.31,
    'SAR': 0.315,
    'INR': 7.0,
    'JPY': 12.5,
    'CNY': 0.61
  };
}

/**
 * Get cached exchange rates, refreshing if expired
 */
async function getExchangeRates() {
  const now = Date.now();

  // Return cached rates if still valid
  if (
    exchangeRateCache.rates &&
    exchangeRateCache.lastUpdated &&
    now - exchangeRateCache.lastUpdated < exchangeRateCache.cacheExpiry
  ) {
    return {
      ok: true,
      rates: exchangeRateCache.rates,
      lastUpdated: exchangeRateCache.lastUpdated,
      cached: true
    };
  }

  // Fetch fresh rates
  try {
    const rates = await fetchExchangeRates();
    exchangeRateCache.rates = rates;
    exchangeRateCache.lastUpdated = now;

    return {
      ok: true,
      rates: rates,
      lastUpdated: now,
      cached: false
    };
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);

    // Return cached rates even if expired (graceful fallback)
    if (exchangeRateCache.rates && Object.keys(exchangeRateCache.rates).length > 0) {
      return {
        ok: true,
        rates: exchangeRateCache.rates,
        lastUpdated: exchangeRateCache.lastUpdated,
        cached: true,
        note: 'Using previously cached rates'
      };
    }

    // Last resort: return fallback rates
    const fallbackRates = {
      'GHS': 1,
      'USD': 0.084,
      'GBP': 0.067,
      'NGN': 35.9,
      'CAD': 0.115,
      'ZAR': 1.55,
      'KES': 10.8,
      'UGX': 308,
      'EUR': 0.078,
      'AED': 0.31,
      'SAR': 0.315,
      'INR': 7.0,
      'JPY': 12.5,
      'CNY': 0.61
    };

    exchangeRateCache.rates = fallbackRates;
    exchangeRateCache.lastUpdated = now;

    return {
      ok: true,
      rates: fallbackRates,
      lastUpdated: now,
      cached: true,
      note: 'Using fallback rates - service unavailable'
    };
  }
}

module.exports = { getExchangeRates };

