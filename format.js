/**
 * NexTrade — Formatting Utilities
 * Currency, number, date/time formatting for financial data
 * Self-invoking module pattern
 */

const Format = (() => {
  'use strict';

  // ============================================
  // CURRENCY FORMATTING
  // ============================================

  /**
   * Format number as USD currency
   * @param {number} amount - Amount to format
   * @param {boolean} showCents - Whether to show cents (default: true)
   * @returns {string} Formatted currency string
   */
  function currency(amount, showCents = true) {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return '$0.00';
    }

    const options = {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: showCents ? 2 : 0,
      maximumFractionDigits: showCents ? 2 : 0
    };

    try {
      return new Intl.NumberFormat('en-US', options).format(amount);
    } catch (error) {
      console.error('Currency formatting error:', error);
      return `$${amount.toFixed(showCents ? 2 : 0)}`;
    }
  }

  /**
   * Format number as compact currency (1.2K, 1.5M, etc.)
   * @param {number} amount - Amount to format
   * @returns {string} Compact currency string
   */
  function compactCurrency(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return '$0';
    }

    const absAmount = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';

    if (absAmount >= 1e9) {
      return `${sign}$${(absAmount / 1e9).toFixed(2)}B`;
    } else if (absAmount >= 1e6) {
      return `${sign}$${(absAmount / 1e6).toFixed(2)}M`;
    } else if (absAmount >= 1e3) {
      return `${sign}$${(absAmount / 1e3).toFixed(2)}K`;
    } else {
      return `${sign}$${absAmount.toFixed(2)}`;
    }
  }

  /**
   * Format crypto amount with appropriate decimals
   * @param {number} amount - Crypto amount
   * @param {string} symbol - Crypto symbol (BTC, ETH, etc.)
   * @returns {string} Formatted crypto amount
   */
  function crypto(amount, symbol) {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return `0 ${symbol}`;
    }

    let decimals = 8; // Default for most crypto

    // Adjust decimals based on amount
    if (Math.abs(amount) >= 1) {
      decimals = 4;
    } else if (Math.abs(amount) >= 0.01) {
      decimals = 6;
    }

    return `${amount.toFixed(decimals)} ${symbol}`;
  }

  // ============================================
  // PERCENTAGE FORMATTING
  // ============================================

  /**
   * Format number as percentage
   * @param {number} value - Value to format
   * @param {number} decimals - Number of decimal places (default: 2)
   * @param {boolean} showSign - Whether to show + sign for positive (default: true)
   * @returns {string} Formatted percentage
   */
  function percentage(value, decimals = 2, showSign = true) {
    if (value === null || value === undefined || isNaN(value)) {
      return '0.00%';
    }

    const sign = value > 0 && showSign ? '+' : '';
    return `${sign}${value.toFixed(decimals)}%`;
  }

  /**
   * Format APY with appropriate styling
   * @param {number} apy - APY value
   * @returns {string} Formatted APY string
   */
  function apy(apy) {
    if (apy === null || apy === undefined || isNaN(apy)) {
      return '0%';
    }
    return `${apy.toFixed(1)}%`;
  }

  // ============================================
  // NUMBER FORMATTING
  // ============================================

  /**
   * Format large numbers with separators
   * @param {number} num - Number to format
   * @param {number} decimals - Number of decimal places (default: 0)
   * @returns {string} Formatted number
   */
  function number(num, decimals = 0) {
    if (num === null || num === undefined || isNaN(num)) {
      return '0';
    }

    try {
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(num);
    } catch (error) {
      console.error('Number formatting error:', error);
      return num.toFixed(decimals);
    }
  }

  /**
   * Format number with compact notation (1.2K, 1.5M, etc.)
   * @param {number} num - Number to format
   * @returns {string} Compact number string
   */
  function compactNumber(num) {
    if (num === null || num === undefined || isNaN(num)) {
      return '0';
    }

    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';

    if (absNum >= 1e9) {
      return `${sign}${(absNum / 1e9).toFixed(1)}B`;
    } else if (absNum >= 1e6) {
      return `${sign}${(absNum / 1e6).toFixed(1)}M`;
    } else if (absNum >= 1e3) {
      return `${sign}${(absNum / 1e3).toFixed(1)}K`;
    } else {
      return `${sign}${absNum}`;
    }
  }

  // ============================================
  // DATE/TIME FORMATTING
  // ============================================

  /**
   * Format date as relative time (e.g., "2 hours ago")
   * @param {Date|string|number} date - Date to format
   * @returns {string} Relative time string
   */
  function relativeTime(date) {
    try {
      const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
      const now = Date.now();
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      const months = Math.floor(days / 30);
      const years = Math.floor(days / 365);

      if (seconds < 60) {
        return 'Just now';
      } else if (minutes < 60) {
        return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
      } else if (hours < 24) {
        return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
      } else if (days < 30) {
        return `${days} ${days === 1 ? 'day' : 'days'} ago`;
      } else if (months < 12) {
        return `${months} ${months === 1 ? 'month' : 'months'} ago`;
      } else {
        return `${years} ${years === 1 ? 'year' : 'years'} ago`;
      }
    } catch (error) {
      console.error('Relative time formatting error:', error);
      return 'Unknown';
    }
  }

  /**
   * Format date as short date (e.g., "Jan 15, 2024")
   * @param {Date|string|number} date - Date to format
   * @returns {string} Formatted date string
   */
  function shortDate(date) {
    try {
      const d = date instanceof Date ? date : new Date(date);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (error) {
      console.error('Short date formatting error:', error);
      return 'Invalid date';
    }
  }

  /**
   * Format date as long date (e.g., "January 15, 2024")
   * @param {Date|string|number} date - Date to format
   * @returns {string} Formatted date string
   */
  function longDate(date) {
    try {
      const d = date instanceof Date ? date : new Date(date);
      return d.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (error) {
      console.error('Long date formatting error:', error);
      return 'Invalid date';
    }
  }

  /**
   * Format date with time (e.g., "Jan 15, 2024 at 3:45 PM")
   * @param {Date|string|number} date - Date to format
   * @returns {string} Formatted date/time string
   */
  function dateTime(date) {
    try {
      const d = date instanceof Date ? date : new Date(date);
      const dateStr = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      const timeStr = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      return `${dateStr} at ${timeStr}`;
    } catch (error) {
      console.error('DateTime formatting error:', error);
      return 'Invalid date';
    }
  }

  /**
   * Format time only (e.g., "3:45 PM")
   * @param {Date|string|number} date - Date to format
   * @returns {string} Formatted time string
   */
  function time(date) {
    try {
      const d = date instanceof Date ? date : new Date(date);
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (error) {
      console.error('Time formatting error:', error);
      return 'Invalid time';
    }
  }

  /**
   * Format duration in days (e.g., "30 days", "90 days")
   * @param {number} days - Number of days
   * @returns {string} Formatted duration string
   */
  function duration(days) {
    if (days === null || days === undefined || isNaN(days)) {
      return '0 days';
    }

    if (days < 1) {
      const hours = Math.round(days * 24);
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    } else if (days >= 365) {
      const years = Math.floor(days / 365);
      return `${years} ${years === 1 ? 'year' : 'years'}`;
    } else if (days >= 30) {
      const months = Math.floor(days / 30);
      return `${months} ${months === 1 ? 'month' : 'months'}`;
    } else {
      return `${days} ${days === 1 ? 'day' : 'days'}`;
    }
  }

  /**
   * Calculate days remaining until date
   * @param {Date|string} date - Target date
   * @returns {number} Days remaining
   */
  function daysRemaining(date) {
    try {
      const target = date instanceof Date ? date : new Date(date);
      const now = new Date();
      const diff = target.getTime() - now.getTime();
      return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    } catch (error) {
      console.error('Days remaining calculation error:', error);
      return 0;
    }
  }

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  /**
   * Truncate text with ellipsis
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated text
   */
  function truncate(text, maxLength = 50) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Format wallet address with ellipsis in middle
   * @param {string} address - Wallet address
   * @param {number} startChars - Characters to show at start (default: 6)
   * @param {number} endChars - Characters to show at end (default: 4)
   * @returns {string} Formatted address
   */
  function address(address, startChars = 6, endChars = 4) {
    if (!address || address.length <= startChars + endChars) {
      return address || '';
    }
    return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
  }

  /**
   * Capitalize first letter of string
   * @param {string} str - String to capitalize
   * @returns {string} Capitalized string
   */
  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  /**
   * Format transaction status
   * @param {string} status - Status value
   * @returns {string} Formatted status
   */
  function status(status) {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  }

  // ============================================
  // EXPORT PUBLIC API
  // ============================================

  return {
    // Currency
    currency,
    compactCurrency,
    crypto,
    
    // Percentages
    percentage,
    apy,
    
    // Numbers
    number,
    compactNumber,
    
    // Dates & Time
    relativeTime,
    shortDate,
    longDate,
    dateTime,
    time,
    duration,
    daysRemaining,
    
    // Utilities
    truncate,
    address,
    capitalize,
    status
  };
})();

// ============================================
// EXPORT FOR OTHER MODULES
// ============================================

if (typeof window !== 'undefined') {
  window.Format = Format;
}