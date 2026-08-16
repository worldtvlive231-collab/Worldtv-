/**
 * World TV Dynamic Currency Converter
 * Base currency: GHS
 * Features:
 * - Real exchange-rate calculations
 * - Automatic country -> currency detection
 * - Manual currency selection with localStorage persistence
 * - Updates all elements with data-price-ghs
 * - Top-right currency display with exchange rate
 * - Safe failure: never shows a fake converted amount
 */

const CurrencyConverter = {
  currencies: {
    GHS: { symbol: 'GH₵', name: 'Ghanaian Cedi', flag: '🇬🇭' },
    USD: { symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
    GBP: { symbol: '£', name: 'British Pound', flag: '🇬🇧' },
    EUR: { symbol: '€', name: 'Euro', flag: '🇪🇺' },
    NGN: { symbol: '₦', name: 'Nigerian Naira', flag: '🇳🇬' },
    CAD: { symbol: 'C$', name: 'Canadian Dollar', flag: '🇨🇦' },
    AUD: { symbol: 'A$', name: 'Australian Dollar', flag: '🇦🇺' },
    ZAR: { symbol: 'R', name: 'South African Rand', flag: '🇿🇦' },
    KES: { symbol: 'KSh', name: 'Kenyan Shilling', flag: '🇰🇪' },
    UGX: { symbol: 'USh', name: 'Ugandan Shilling', flag: '🇺🇬' },
    XOF: { symbol: 'CFA', name: 'West African CFA Franc', flag: '🌍' },
    XAF: { symbol: 'FCFA', name: 'Central African CFA Franc', flag: '🌍' },
    AED: { symbol: 'د.إ', name: 'UAE Dirham', flag: '🇦🇪' },
    SAR: { symbol: '﷼', name: 'Saudi Riyal', flag: '🇸🇦' },
    INR: { symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳' },
    JPY: { symbol: '¥', name: 'Japanese Yen', flag: '🇯🇵' },
    CNY: { symbol: '¥', name: 'Chinese Yuan', flag: '🇨🇳' }
  },

  countryToCurrency: {
    Ghana: 'GHS',
    'United States': 'USD',
    'United Kingdom': 'GBP',
    Nigeria: 'NGN',
    Canada: 'CAD',
    Australia: 'AUD',
    'South Africa': 'ZAR',
    Kenya: 'KES',
    Uganda: 'UGX',
    'United Arab Emirates': 'AED',
    'Saudi Arabia': 'SAR',
    India: 'INR',
    Japan: 'JPY',
    China: 'CNY',

    Austria: 'EUR',
    Belgium: 'EUR',
    Croatia: 'EUR',
    Cyprus: 'EUR',
    Estonia: 'EUR',
    Finland: 'EUR',
    France: 'EUR',
    Germany: 'EUR',
    Greece: 'EUR',
    Ireland: 'EUR',
    Italy: 'EUR',
    Latvia: 'EUR',
    Lithuania: 'EUR',
    Luxembourg: 'EUR',
    Malta: 'EUR',
    Netherlands: 'EUR',
    Portugal: 'EUR',
    Slovakia: 'EUR',
    Slovenia: 'EUR',
    Spain: 'EUR'
  },

  exchangeRates: { GHS: 1 },
  lastUpdated: null,
 activeCurrency:'USD',
  basePriceGHS: 299,

  async init() {
    try {
      await this.loadExchangeRates();

      const detectedCurrency = await this.detectUserCurrency();
      const manuallySelected = localStorage.getItem('wtv_currency_manual');

      this.activeCurrency =
        this.isSupportedCurrency(manuallySelected) ? manuallySelected :
        this.isSupportedCurrency(detectedCurrency) ? detectedCurrency :
        'USD';

      this.setupCurrencyDropdown(this.activeCurrency);
      this.setupTopRightCurrencyBar(this.activeCurrency);
      this.updateAllPrices(this.activeCurrency);

      setInterval(async () => {
        await this.loadExchangeRates();
        this.updateAllPrices(this.activeCurrency);
        this.updateTopRightCurrencyBar(this.activeCurrency);
      }, 30 * 60 * 1000);
    } catch (error) {
      console.error('Currency converter initialization error:', error);
      this.activeCurrency = 'USD';
      this.setupCurrencyDropdown('USD');
      this.setupTopRightCurrencyBar('USD');
      this.updateAllPrices('USD');
    }
  },

  isSupportedCurrency(currency) {
    return Boolean(currency && this.currencies[currency]);
  },

  async loadExchangeRates() {
    try {
      const response = await fetch('/api/exchange-rates', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`Exchange-rate API returned HTTP ${response.status}`);
      }

      const data = await response.json();

      const rawRates = data.rates || (data.data && data.data.rates);

      if (!rawRates || typeof rawRates !== 'object') {
        throw new Error('No rates object found in /api/exchange-rates response');
      }

      const normalizedRates = { GHS: 1 };

      for (const [code, value] of Object.entries(rawRates)) {
        const numericRate = Number(value);
        if (Number.isFinite(numericRate) && numericRate > 0) {
          normalizedRates[String(code).toUpperCase()] = numericRate;
        }
      }

      this.exchangeRates = normalizedRates;
      this.lastUpdated =
        data.lastUpdated ||
        data.updated_at ||
        data.time_last_update_utc ||
        (data.data && data.data.lastUpdated) ||
        null;

      console.log('World TV exchange rates loaded:', this.exchangeRates);
      console.log('USD rate for 1 GHS:', this.exchangeRates.USD);
    } catch (error) {
      console.error('Failed to load exchange rates:', error);
    }
  },

  async detectUserCurrency() {
    try {
      const response = await fetch('/api/visitor-country', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`Visitor-country API returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const country = data.country || (data.data && data.data.country);

      if (country && this.countryToCurrency[country]) {
        return this.countryToCurrency[country];
      }
    } catch (error) {
      console.warn('Could not detect visitor currency:', error);
    }

    return 'USD';
  },

  convert(ghsAmount, targetCurrency) {
    const amount = Number(ghsAmount);

    if (!Number.isFinite(amount)) {
      return null;
    }

    if (!targetCurrency || targetCurrency === 'GHS') {
      return amount;
    }

    const rate = Number(this.exchangeRates[targetCurrency]);

    if (!Number.isFinite(rate) || rate <= 0) {
      console.warn(`No valid exchange rate for ${targetCurrency}`);
      return null;
    }

    return amount * rate;
  },

  format(amount, currency) {
    const info = this.currencies[currency];

    if (!info || !Number.isFinite(Number(amount))) {
      return '—';
    }

    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true
    }).format(Number(amount));

    return `${info.symbol}${formatted}`;
  },

  getExchangeRateDisplay(currency) {
    if (currency === 'GHS') {
      return 'Base currency';
    }

    const rate = Number(this.exchangeRates[currency]);

    if (!Number.isFinite(rate) || rate <= 0) {
      return 'Rate unavailable';
    }

    const info = this.currencies[currency];
    const formattedRate = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 5,
      maximumFractionDigits: 5
    }).format(rate);

    return `1 GHS = ${info.symbol}${formattedRate}`;
  },

  updateAllPrices(currency) {
    if (!this.isSupportedCurrency(currency)) {
      currency = 'GHS';
    }

    this.activeCurrency = currency;

    document.querySelectorAll('[data-price-ghs]').forEach((element) => {
      const ghsAmount = Number(element.getAttribute('data-price-ghs'));

      if (!Number.isFinite(ghsAmount)) {
        return;
      }

      let html = `<strong>${this.format(ghsAmount, 'GHS')}</strong>`;

      if (currency !== 'GHS') {
        const convertedAmount = this.convert(ghsAmount, currency);

        if (convertedAmount === null) {
          html += '<br><span class="currency-converted">Conversion unavailable</span>';
        } else {
          html += `<br><span class="currency-converted">≈ ${this.format(convertedAmount, currency)} ${currency}</span>`;
        }
      }

      element.innerHTML = html;
    });
  },

  setupCurrencyDropdown(initialCurrency) {
    let dropdown = document.getElementById('currency-dropdown');

    if (!dropdown) {
      const container = document.getElementById('currency-selector');
      if (!container) return;

      dropdown = document.createElement('select');
      dropdown.id = 'currency-dropdown';
      dropdown.setAttribute('aria-label', 'Select your currency');
      dropdown.style.cssText = `
        padding: 8px 12px;
        border: 1px solid #d8ccb2;
        border-radius: 8px;
        background: #fff;
        font-weight: 700;
        cursor: pointer;
        font-size: 14px;
        min-width: 150px;
        max-width: 100%;
      `;

      for (const [code, info] of Object.entries(this.currencies)) {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = `${info.flag} ${code} — ${info.name}`;
        dropdown.appendChild(option);
      }

      container.appendChild(dropdown);
    }

    if (!dropdown.dataset.currencyConverterInitialized) {
      dropdown.addEventListener('change', (event) => {
        const currency = event.target.value;

        localStorage.setItem('wtv_currency_manual', currency);

        this.activeCurrency = currency;
        this.updateAllPrices(currency);
        this.updateTopRightCurrencyBar(currency);
      });

      dropdown.dataset.currencyConverterInitialized = 'true';
    }

    dropdown.value = initialCurrency;
  },

  setupTopRightCurrencyBar(initialCurrency) {
    let bar = document.getElementById('top-right-currency-bar');

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'top-right-currency-bar';
      bar.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        font-weight: 700;
        font-size: 13px;
        line-height: 1.3;
        white-space: nowrap;
      `;

      const target =
        document.querySelector('[data-currency-bar-container]') ||
        document.querySelector('.nav-actions') ||
        document.querySelector('nav') ||
        document.querySelector('header');

      if (target) {
        target.appendChild(bar);
      } else {
        bar.style.position = 'fixed';
        bar.style.top = '10px';
        bar.style.right = '10px';
        bar.style.zIndex = '9999';
        bar.style.background = '#fff';
        bar.style.padding = '8px 10px';
        bar.style.borderRadius = '10px';
        document.body.appendChild(bar);
      }
    }

    this.updateTopRightCurrencyBar(initialCurrency);
  },

  updateTopRightCurrencyBar(currency) {
    const bar = document.getElementById('top-right-currency-bar');
    if (!bar) return;

    if (!this.isSupportedCurrency(currency)) {
      currency = 'GHS';
    }

    const info = this.currencies[currency];
    const convertedAmount = this.convert(this.basePriceGHS, currency);

    const amountText =
      convertedAmount === null
        ? 'Conversion unavailable'
        : this.format(convertedAmount, currency);

    const rateText = this.getExchangeRateDisplay(currency);

    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;font-weight:800;font-size:14px;">
        <span>${info.flag}</span>
        <span>${currency}</span>
      </div>
      <div style="text-align:right;font-size:12px;color:#716958;">
        <div>${amountText}</div>
        <div style="font-size:11px;margin-top:2px;">${rateText}</div>
      </div>
    `;

    bar.style.display = 'flex';
  },

  clearManualCurrencyPreference() {
    localStorage.removeItem('wtv_currency_manual');
  }
};

window.CurrencyConverter = CurrencyConverter;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => CurrencyConverter.init());
} else {
  CurrencyConverter.init();
}
// trigger Railway redeploy
