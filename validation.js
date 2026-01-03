/**
 * NexTrade — Validation Utilities
 * Input validation helpers for forms and user input
 * Self-invoking module pattern
 */

const Validation = (() => {
  'use strict';

  // ============================================
  // EMAIL VALIDATION
  // ============================================

  /**
   * Validate email address format
   * @param {string} email - Email address to validate
   * @returns {object} { isValid: boolean, error: string|null }
   */
  function email(email) {
    if (!email || typeof email !== 'string') {
      return { isValid: false, error: 'Email is required' };
    }

    const trimmed = email.trim();

    if (trimmed.length === 0) {
      return { isValid: false, error: 'Email is required' };
    }

    // RFC 5322 compliant email regex (simplified)
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    if (!emailRegex.test(trimmed)) {
      return { isValid: false, error: 'Invalid email format' };
    }

    if (trimmed.length > 254) {
      return { isValid: false, error: 'Email is too long' };
    }

    return { isValid: true, error: null };
  }

  // ============================================
  // PASSWORD VALIDATION
  // ============================================

  /**
   * Validate password strength
   * @param {string} password - Password to validate
   * @param {object} options - Validation options
   * @returns {object} { isValid: boolean, error: string|null, strength: string }
   */
  function password(password, options = {}) {
    const defaults = {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: false
    };

    const opts = { ...defaults, ...options };

    if (!password || typeof password !== 'string') {
      return { isValid: false, error: 'Password is required', strength: 'weak' };
    }

    if (password.length < opts.minLength) {
      return {
        isValid: false,
        error: `Password must be at least ${opts.minLength} characters`,
        strength: 'weak'
      };
    }

    if (opts.requireUppercase && !/[A-Z]/.test(password)) {
      return {
        isValid: false,
        error: 'Password must contain at least one uppercase letter',
        strength: 'weak'
      };
    }

    if (opts.requireLowercase && !/[a-z]/.test(password)) {
      return {
        isValid: false,
        error: 'Password must contain at least one lowercase letter',
        strength: 'weak'
      };
    }

    if (opts.requireNumber && !/\d/.test(password)) {
      return {
        isValid: false,
        error: 'Password must contain at least one number',
        strength: 'weak'
      };
    }

    if (opts.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return {
        isValid: false,
        error: 'Password must contain at least one special character',
        strength: 'weak'
      };
    }

    // Calculate password strength
    let strength = 'weak';
    let score = 0;

    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score++;

    if (score >= 5) {
      strength = 'strong';
    } else if (score >= 3) {
      strength = 'medium';
    }

    return { isValid: true, error: null, strength };
  }

  /**
   * Validate password confirmation matches
   * @param {string} password - Original password
   * @param {string} confirmPassword - Confirmation password
   * @returns {object} { isValid: boolean, error: string|null }
   */
  function passwordMatch(password, confirmPassword) {
    if (!confirmPassword) {
      return { isValid: false, error: 'Please confirm your password' };
    }

    if (password !== confirmPassword) {
      return { isValid: false, error: 'Passwords do not match' };
    }

    return { isValid: true, error: null };
  }

  // ============================================
  // AMOUNT VALIDATION
  // ============================================

  /**
   * Validate monetary amount
   * @param {string|number} amount - Amount to validate
   * @param {object} options - Validation options
   * @returns {object} { isValid: boolean, error: string|null, value: number }
   */
  function amount(amount, options = {}) {
    const defaults = {
      min: 0,
      max: Infinity,
      allowZero: false,
      decimalPlaces: 2
    };

    const opts = { ...defaults, ...options };

    if (amount === null || amount === undefined || amount === '') {
      return { isValid: false, error: 'Amount is required', value: 0 };
    }

    // Convert to number
    const numValue = typeof amount === 'string' ? parseFloat(amount) : amount;

    if (isNaN(numValue)) {
      return { isValid: false, error: 'Invalid amount', value: 0 };
    }

    if (!opts.allowZero && numValue === 0) {
      return { isValid: false, error: 'Amount must be greater than zero', value: 0 };
    }

    if (numValue < opts.min) {
      return {
        isValid: false,
        error: `Amount must be at least ${Format.currency(opts.min)}`,
        value: numValue
      };
    }

    if (numValue > opts.max) {
      return {
        isValid: false,
        error: `Amount cannot exceed ${Format.currency(opts.max)}`,
        value: numValue
      };
    }

    // Check decimal places
    const decimalPart = numValue.toString().split('.')[1];
    if (decimalPart && decimalPart.length > opts.decimalPlaces) {
      return {
        isValid: false,
        error: `Amount can have at most ${opts.decimalPlaces} decimal places`,
        value: numValue
      };
    }

    return { isValid: true, error: null, value: numValue };
  }

  /**
   * Validate investment amount against strategy requirements
   * @param {number} amount - Investment amount
   * @param {object} strategy - Strategy object with minInvestment
   * @param {number} availableBalance - User's available balance
   * @returns {object} { isValid: boolean, error: string|null }
   */
  function investmentAmount(amount, strategy, availableBalance) {
    if (!strategy) {
      return { isValid: false, error: 'Strategy not found' };
    }

    const amountValidation = Validation.amount(amount, {
      min: strategy.minInvestment,
      allowZero: false
    });

    if (!amountValidation.isValid) {
      return amountValidation;
    }

    if (amountValidation.value > availableBalance) {
      return {
        isValid: false,
        error: 'Insufficient balance'
      };
    }

    return { isValid: true, error: null };
  }

  // ============================================
  // STRING VALIDATION
  // ============================================

  /**
   * Validate required string field
   * @param {string} value - Value to validate
   * @param {string} fieldName - Field name for error message
   * @param {number} minLength - Minimum length (default: 1)
   * @param {number} maxLength - Maximum length (default: Infinity)
   * @returns {object} { isValid: boolean, error: string|null }
   */
  function required(value, fieldName = 'Field', minLength = 1, maxLength = Infinity) {
    if (!value || typeof value !== 'string') {
      return { isValid: false, error: `${fieldName} is required` };
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
      return { isValid: false, error: `${fieldName} is required` };
    }

    if (trimmed.length < minLength) {
      return {
        isValid: false,
        error: `${fieldName} must be at least ${minLength} characters`
      };
    }

    if (trimmed.length > maxLength) {
      return {
        isValid: false,
        error: `${fieldName} cannot exceed ${maxLength} characters`
      };
    }

    return { isValid: true, error: null };
  }

  /**
   * Validate alphanumeric string
   * @param {string} value - Value to validate
   * @param {string} fieldName - Field name for error message
   * @returns {object} { isValid: boolean, error: string|null }
   */
  function alphanumeric(value, fieldName = 'Field') {
    const reqValidation = required(value, fieldName);
    if (!reqValidation.isValid) {
      return reqValidation;
    }

    const alphanumericRegex = /^[a-zA-Z0-9]+$/;
    if (!alphanumericRegex.test(value.trim())) {
      return {
        isValid: false,
        error: `${fieldName} can only contain letters and numbers`
      };
    }

    return { isValid: true, error: null };
  }

  // ============================================
  // WALLET ADDRESS VALIDATION
  // ============================================

  /**
   * Validate cryptocurrency wallet address
   * @param {string} address - Wallet address
   * @param {string} type - Address type (USDT_TRC20, BTC, ETH)
   * @returns {object} { isValid: boolean, error: string|null }
   */
  function walletAddress(address, type = 'USDT_TRC20') {
    if (!address || typeof address !== 'string') {
      return { isValid: false, error: 'Wallet address is required' };
    }

    const trimmed = address.trim();

    switch (type) {
      case 'USDT_TRC20':
        // TRON addresses start with 'T' and are 34 characters
        if (!/^T[A-Za-z0-9]{33}$/.test(trimmed)) {
          return {
            isValid: false,
            error: 'Invalid USDT TRC20 address format'
          };
        }
        break;

      case 'BTC':
        // Bitcoin addresses (simplified validation)
        if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed) &&
            !/^bc1[a-z0-9]{39,59}$/.test(trimmed)) {
          return {
            isValid: false,
            error: 'Invalid Bitcoin address format'
          };
        }
        break;

      case 'ETH':
        // Ethereum addresses start with '0x' and are 42 characters
        if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
          return {
            isValid: false,
            error: 'Invalid Ethereum address format'
          };
        }
        break;

      default:
        return { isValid: false, error: 'Unsupported address type' };
    }

    return { isValid: true, error: null };
  }

  // ============================================
  // FORM VALIDATION
  // ============================================

  /**
   * Validate entire form object
   * @param {object} formData - Form data to validate
   * @param {object} rules - Validation rules
   * @returns {object} { isValid: boolean, errors: object }
   */
  function form(formData, rules) {
    const errors = {};
    let isValid = true;

    for (const field in rules) {
      const rule = rules[field];
      const value = formData[field];

      if (rule.type === 'email') {
        const result = email(value);
        if (!result.isValid) {
          errors[field] = result.error;
          isValid = false;
        }
      } else if (rule.type === 'password') {
        const result = password(value, rule.options);
        if (!result.isValid) {
          errors[field] = result.error;
          isValid = false;
        }
      } else if (rule.type === 'amount') {
        const result = amount(value, rule.options);
        if (!result.isValid) {
          errors[field] = result.error;
          isValid = false;
        }
      } else if (rule.type === 'required') {
        const result = required(value, rule.fieldName, rule.minLength, rule.maxLength);
        if (!result.isValid) {
          errors[field] = result.error;
          isValid = false;
        }
      } else if (rule.type === 'walletAddress') {
        const result = walletAddress(value, rule.addressType);
        if (!result.isValid) {
          errors[field] = result.error;
          isValid = false;
        }
      }
    }

    return { isValid, errors };
  }

  // ============================================
  // SANITIZATION
  // ============================================

  /**
   * Sanitize string input (remove potentially dangerous characters)
   * @param {string} input - Input string to sanitize
   * @returns {string} Sanitized string
   */
  function sanitize(input) {
    if (typeof input !== 'string') {
      return '';
    }

    return input
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();
  }

  /**
   * Sanitize numeric input
   * @param {string|number} input - Input to sanitize
   * @returns {number} Sanitized number or 0
   */
  function sanitizeNumber(input) {
    if (typeof input === 'number' && !isNaN(input)) {
      return input;
    }

    if (typeof input === 'string') {
      const cleaned = input.replace(/[^0-9.-]/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? 0 : num;
    }

    return 0;
  }

  // ============================================
  // EXPORT PUBLIC API
  // ============================================

  return {
    // Authentication
    email,
    password,
    passwordMatch,
    
    // Amounts
    amount,
    investmentAmount,
    
    // Strings
    required,
    alphanumeric,
    
    // Crypto
    walletAddress,
    
    // Forms
    form,
    
    // Sanitization
    sanitize,
    sanitizeNumber
  };
})();

// ============================================
// EXPORT FOR OTHER MODULES
// ============================================

if (typeof window !== 'undefined') {
  window.Validation = Validation;
}