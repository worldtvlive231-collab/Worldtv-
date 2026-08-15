/**
 * World TV Dynamic Currency Converter
 * Automatically detects visitor location and converts GHS prices to local currency
 * Supports manual currency selection and localStorage persistence
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

  exchangeRates: {},
  lastUpdated: null,
  baseRate: 1,

  /**
   * Initialize the converter on page load
   */
  async init() {
    try {
      // Load cached rates
      await this.loadExchangeRates();

      // Detect user's currency based on country
      const userCurrency = await this.detectUserCurrency();

      // Restore saved currency preference or use detected
      const savedCurrency = localStorage.getItem('wtv_currency');
      const activeCurrency = savedCurrency || userCurrency || 'GHS';

      // Initialize all price elements
      this.updateAllPrices(activeCurrency);

      // Setup currency dropdown if it exists
      this.setupCurrencyDropdown(activeCurrency);

      // Refresh rates in background (every 30 minutes)
      setInterval(() => this.loadExchangeRates(), 30 * 60 * 1000);
    } catch (error) {
      console.error('Currency converter initialization error:', error);
      // Silently fail - prices stay in GHS
    }
  },

  /**
   * Load exchange rates from server
   */
  async loadExchangeRates() {
    try {
      const response = await fetch('/api/exchange-rates');
      const data = await response.json();

      if (data.ok && data.rates) {
        this.exchangeRates = data.rates;
        this.lastUpdated = data.lastUpdated;
        this.baseRate = data.rates.GHS || 1;

        // Update the last updated timestamp if element exists
        const updatedEl = document.getElementById('currency-last-updated');
        if (updatedEl && this.lastUpdated) {
          const date = new Date(this.lastUpdated);
          updatedEl.textContent = `Last updated: ${date.toLocaleString()}`;
        }
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
   * Convert GHS amount to target currency
   */
  convert(ghsAmount, targetCurrency) {
    if (!targetCurrency || targetCurrency === 'GHS') {
      return ghsAmount;
    }

    if (!this.exchangeRates[targetCurrency]) {
      return ghsAmount; // If rate not available, return original
    }

    const rate = this.exchangeRates[targetCurrency] / this.baseRate;
    return ghsAmount * rate;
  },

  /**
   * Format currency amount
   */
  format(amount, currency) {
    const currencyInfo = this.currencies[currency];
    if (!currencyInfo) return amount;

    const formatted = Number(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    return `${currencyInfo.symbol}${formatted}`;
  },

  /**
   * Update all prices on page for given currency
   */
  updateAllPrices(currency) {
    // Store preference
    localStorage.setItem('wtv_currency', currency);

    // Find all price elements with data-price-ghs attribute
    const priceElements = document.querySelectorAll('[data-price-ghs]');
    priceElements.forEach(el => {
      const ghsAmount = parseFloat(el.getAttribute('data-price-ghs'));

      // Always show GHS price
      let htmlContent = `<strong>${this.format(ghsAmount, 'GHS')}</strong>`;

      // Add converted price if different from GHS
      if (currency !== 'GHS') {
        const convertedAmount = this.convert(ghsAmount, currency);
        htmlContent += `<br><span class="currency-converted">≈ ${this.format(convertedAmount, currency)}</span>`;
      }

      el.innerHTML = htmlContent;
    });

    // Update dropdown if it exists
    const dropdown = document.getElementById('currency-dropdown');
    if (dropdown) {
      dropdown.value = currency;
    }
  },

  /**
   * Setup the currency dropdown selector
   */
  setupCurrencyDropdown(initialCurrency) {
    // Check if dropdown already exists
    let dropdown = document.getElementById('currency-dropdown');
    if (dropdown) {
      // Attach event listener if not already done
      if (!dropdown.dataset.initialized) {
        dropdown.addEventListener('change', (e) => {
          this.updateAllPrices(e.target.value);
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
    });

    container.appendChild(dropdown);
  },

  /**
   * Update prices when currency changes
   */
  onCurrencyChange(currency) {
    this.updateAllPrices(currency);
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

