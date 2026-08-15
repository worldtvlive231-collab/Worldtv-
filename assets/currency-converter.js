/**
 * World TV Dynamic Currency Converter
 * Automatically detects visitor location and converts GHS prices to local currency
 * Supports manual currency selection and localStorage persistence
 * IMPORTANT: Uses real exchange rate calculations: convertedAmount = ghsAmount * rate
 */

const CurrencyConverter = {
  // Currency codes and their symbols
  currencies: {
    'GHS': { symbol: 'GH₵', name: 'Ghanaian Cedi', flag: '🇬🇭' },
    'USD': { symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
    'GBP': { symbol: '£', name: 'British Pound', flag: '🇬🇧' },
    'NGN': { symbol: '₦', name: 'Nigerian Naira', flag: '🇳🇬' },
    'CAD': { symbol: '$', name: 'Canadian Dollar', flag: '🇨🇦' },
    'ZAR': { symbol: 'R', name: 'South African Rand', flag: '🇿🇦' },
    'KES': { symbol: 'KSh', name: 'Kenyan Shilling', flag: '🇰🇪' },
    'UGX': { symbol: 'USh', name: 'Ugandan Shilling', flag: '🇺🇬' },
    'EUR': { symbol: '€', name: 'Euro', flag: '🇪🇺' },
    'AED': { symbol: 'د.إ', name: 'UAE Dirham', flag: '🇦🇪' },
    'SAR': { symbol: '﷼', name: 'Saudi Riyal', flag: '🇸🇦' },
    'INR': { symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳' },
    'JPY': { symbol: '¥', name: 'Japanese Yen', flag: '🇯🇵' },
    'CNY': { symbol: '¥', name: 'Chinese Yuan', flag: '🇨🇳' }
  },

  // Country to currency mapping
  countryToCurrency: {
    'Ghana': 'GHS',
    'United States': 'USD',
    'United Kingdom': 'GBP',
    'Nigeria': 'NGN',
    'Canada': 'CAD',
    'South Africa': 'ZAR',
    'Kenya': 'KES',
    'Uganda': 'UGX',
    'Austria': 'EUR', 'Belgium': 'EUR', 'Cyprus': 'EUR', 'Estonia': 'EUR',
    'Finland': 'EUR', 'France': 'EUR', 'Germany': 'EUR', 'Greece': 'EUR',
    'Ireland': 'EUR', 'Italy': 'EUR', 'Latvia': 'EUR', 'Lithuania': 'EUR',
    'Luxembourg': 'EUR', 'Malta': 'EUR', 'Netherlands': 'EUR', 'Portugal': 'EUR',
    'Slovakia': 'EUR', 'Slovenia': 'EUR', 'Spain': 'EUR',
    'United Arab Emirates': 'AED',
    'Saudi Arabia': 'SAR',
    'India': 'INR',
    'Japan': 'JPY',
    'China': 'CNY'
  },

  // API response rates: directly from /api/exchange-rates
  // Example: { GHS: 1, USD: 0.0914, GBP: 0.0726, ... }
  // Meaning: 1 GHS = 0.0914 USD, 1 GHS = 0.0726 GBP, etc.
  exchangeRates: {},
  lastUpdated: null,

  // Base subscription price in GHS (used for top-right display)
  basePriceGHS: 299,

  /**
   * Initialize the converter on page load
   */
  async init() {
    try {
      // Load exchange rates from server
      await this.loadExchangeRates();

      // Detect user's currency based on country
      const userCurrency = await this.detectUserCurrency();

      // Restore saved currency preference or use detected
      const savedCurrency = localStorage.getItem('wtv_currency');
      const activeCurrency = savedCurrency || userCurrency || 'GHS';

      // Update all prices on the page
      this.updateAllPrices(activeCurrency);

      // Setup currency dropdown in page if it exists
      this.setupCurrencyDropdown(activeCurrency);

      // Setup top-right currency bar in header
      this.setupTopRightCurrencyBar(activeCurrency);

      // Refresh rates in background (every 30 minutes)
      setInterval(() => this.loadExchangeRates(), 30 * 60 * 1000);
    } catch (error) {
      console.error('Currency converter initialization error:', error);
      // Silently fail - prices stay in GHS
    }
  },

  /**
   * Load exchange rates from server API
   */
  async loadExchangeRates() {
    try {
      const response = await fetch('/api/exchange-rates');
      const data = await response.json();

       if (data.rates) {
        // Store rates: { GHS: 1, USD: 0.0914, GBP: 0.0726, ... }
        // These are direct 1 GHS -> X Currency rates
        this.exchangeRates = data.rates;
        this.lastUpdated = data.lastUpdated;

        console.log('Exchange rates loaded:', this.exchangeRates);

        // Update all prices since rates changed
        const currentCurrency = localStorage.getItem('wtv_currency') || 'GHS';
        this.updateAllPrices(currentCurrency);
        this.updateTopRightCurrencyBar(currentCurrency);
      }
    } catch (error) {
      console.error('Failed to load exchange rates:', error);
    }
  },

  /**
   * Detect user's currency based on their country from analytics
   */
  async detectUserCurrency() {
    try {
      const response = await fetch('/api/visitor-country');
      const data = await response.json();

      if (data.country) {
        return this.countryToCurrency[data.country] || 'GHS';
      }
    } catch (error) {
      console.error('Failed to detect user country:', error);
    }

    return 'GHS'; // Fallback
  },

  /**
   * Convert GHS amount to target currency using REAL calculation
   * FORMULA: convertedAmount = ghsAmount * exchangeRate
   * Example: 299 GHS * 0.0914 USD/GHS = 27.34 USD
   */
  convert(ghsAmount, targetCurrency) {
    // If GHS or no rate available, return original amount
    if (!targetCurrency || targetCurrency === 'GHS') {
      return ghsAmount;
    }

    // Get the exchange rate for this currency
    // Rate is: 1 GHS = X targetCurrency (e.g., 1 GHS = 0.0914 USD)
    const rate = this.exchangeRates[targetCurrency];
    
    if (!rate) {
      console.warn(`No exchange rate found for ${targetCurrency}`);
      return ghsAmount; // Fallback to GHS amount
    }

    // REAL CALCULATION: multiply GHS amount by the rate
    const converted = ghsAmount * rate;
    return converted;
  },

  /**
   * Format currency amount with proper symbol and decimals
   * Uses Intl.NumberFormat for proper localization
   */
  format(amount, currency) {
    const currencyInfo = this.currencies[currency];
    if (!currencyInfo) return String(amount);

    // Use Intl.NumberFormat for proper formatting
    const formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true
    });

    const formatted = formatter.format(amount);
    return `${currencyInfo.symbol}${formatted}`;
  },

  /**
   * Get exchange rate display (1 GHS = X Currency)
   */
  getExchangeRateDisplay(targetCurrency) {
    if (targetCurrency === 'GHS') {
      return 'Base currency';
    }

    const rate = this.exchangeRates[targetCurrency];
    if (!rate) return '—';

    const currencyInfo = this.currencies[targetCurrency];
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 5,
      maximumFractionDigits: 5
    }).format(rate);

    return `1 GHS = ${currencyInfo.symbol}${formatted}`;
  },

  /**
   * Update all prices on page for given currency
   */
  updateAllPrices(currency) {
    // Store user preference
    localStorage.setItem('wtv_currency', currency);

    // Find all price elements with data-price-ghs attribute
    const priceElements = document.querySelectorAll('[data-price-ghs]');
    priceElements.forEach(el => {
      const ghsAmount = parseFloat(el.getAttribute('data-price-ghs'));
      if (isNaN(ghsAmount)) return;

      // Always show GHS price
      let htmlContent = `<strong>${this.format(ghsAmount, 'GHS')}</strong>`;

      // Add converted price if different from GHS
      if (currency !== 'GHS') {
        // REAL CONVERSION: multiply GHS by the rate
        const convertedAmount = this.convert(ghsAmount, currency);
        const currencyInfo = this.currencies[currency];
        const displayName = currency === 'USD' ? 'USD' : 
                          currency === 'GBP' ? 'GBP' :
                          currency === 'EUR' ? 'EUR' : currency;
        htmlContent += `<br><span class="currency-converted">≈ ${this.format(convertedAmount, currency)} ${displayName}</span>`;
      }

      el.innerHTML = htmlContent;
    });
  },

  /**
   * Setup the currency dropdown selector in page
   */
  setupCurrencyDropdown(initialCurrency) {
    // Check if dropdown already exists
    let dropdown = document.getElementById('currency-dropdown');
    if (dropdown) {
      // Attach event listener if not already done
      if (!dropdown.dataset.initialized) {
        dropdown.addEventListener('change', (e) => {
          this.updateAllPrices(e.target.value);
          this.updateTopRightCurrencyBar(e.target.value);
        });
        dropdown.dataset.initialized = 'true';
      }
      dropdown.value = initialCurrency;
      return;
    }

    // Create dropdown if no existing one found
    const container = document.getElementById('currency-selector');
    if (!container) return;

    dropdown = document.createElement('select');
    dropdown.id = 'currency-dropdown';
    dropdown.style.cssText = `
      padding: 8px 12px;
      border: 1px solid #d8ccb2;
      border-radius: 8px;
      background: #fff;
      font-weight: 700;
      cursor: pointer;
      font-size: 14px;
      min-width: 150px;
    `;

    // Add options
    Object.keys(this.currencies).forEach(code => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = `${this.currencies[code].flag} ${code}`;
      dropdown.appendChild(option);
    });

    dropdown.value = initialCurrency;

    dropdown.addEventListener('change', (e) => {
      this.updateAllPrices(e.target.value);
      this.updateTopRightCurrencyBar(e.target.value);
    });

    container.appendChild(dropdown);
  },

  /**
   * Setup the top-right currency bar in the header
   */
  setupTopRightCurrencyBar(initialCurrency) {
    // Find or create the currency bar in header
    let currencyBar = document.getElementById('top-right-currency-bar');

    if (!currencyBar) {
      // Create the currency bar
      currencyBar = document.createElement('div');
      currencyBar.id = 'top-right-currency-bar';
      currencyBar.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        font-weight: 700;
        font-size: 13px;
        line-height: 1.4;
      `;

      // Try to insert in header nav (top-right area)
      const nav = document.querySelector('nav') || document.querySelector('.nav') || document.querySelector('header');
      if (nav) {
        nav.style.display = 'flex';
        nav.style.justifyContent = 'space-between';
        nav.style.alignItems = 'center';
        nav.appendChild(currencyBar);
      } else {
        // Fallback: append to body if no header found
        document.body.appendChild(currencyBar);
      }
    }

    this.updateTopRightCurrencyBar(initialCurrency);
  },

  /**
   * Update the top-right currency bar content
   */
  updateTopRightCurrencyBar(currency) {
    const bar = document.getElementById('top-right-currency-bar');
    if (!bar) return;

    // Get converted amount
    const convertedAmount = this.convert(this.basePriceGHS, currency);
    const currencyInfo = this.currencies[currency];
    const rateDisplay = this.getExchangeRateDisplay(currency);

    // Format the converted amount
    const formattedAmount = this.format(convertedAmount, currency);

    // Create the display
    const currencyFlag = currencyInfo.flag;
    const currencyCode = currency;
    const amountDisplay = formattedAmount;

    bar.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px; font-weight: 800; font-size: 14px;">
        <span>${currencyFlag}</span>
        <span>${currencyCode}</span>
      </div>
      <div style="text-align: right; font-size: 12px; color: #716958;">
        <div>${amountDisplay}</div>
        <div style="font-size: 11px; margin-top: 2px;">${rateDisplay}</div>
      </div>
    `;

    // Make sure bar is visible
    bar.style.display = 'flex';
  }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    CurrencyConverter.init();
  });
} else {
  CurrencyConverter.init();
}

