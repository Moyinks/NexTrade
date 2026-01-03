/**
 * NexTrade — Card Component
 * Reusable card component for displaying content
 * Self-invoking module pattern
 */

const Card = (() => {
  'use strict';

  // ============================================
  // CARD CREATION
  // ============================================

  /**
   * Create a basic card element
   * @param {object} options - Card options
   * @returns {HTMLElement} Card element
   */
  function create(options = {}) {
    const defaults = {
      className: '',
      elevated: false,
      hoverable: false,
      clickable: false,
      onClick: null
    };

    const opts = { ...defaults, ...options };

    const card = document.createElement('div');
    card.className = 'card';

    if (opts.className) {
      card.className += ` ${opts.className}`;
    }

    if (opts.elevated) {
      card.classList.add('card-elevated');
    }

    if (opts.hoverable) {
      card.classList.add('card-hover');
    }

    if (opts.clickable) {
      card.style.cursor = 'pointer';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
    }

    if (opts.onClick && typeof opts.onClick === 'function') {
      card.addEventListener('click', opts.onClick);
      card.addEventListener('touchend', (e) => {
        e.preventDefault();
        opts.onClick(e);
      });
    }

    return card;
  }

  /**
   * Create card with header, body, and optional footer
   * @param {object} options - Card options
   * @returns {HTMLElement} Card element
   */
  function createWithContent(options = {}) {
    const defaults = {
      title: '',
      subtitle: '',
      body: '',
      footer: null,
      action: null,
      className: '',
      elevated: false,
      hoverable: false
    };

    const opts = { ...defaults, ...options };

    const card = create({
      className: opts.className,
      elevated: opts.elevated,
      hoverable: opts.hoverable
    });

    // Header
    if (opts.title || opts.subtitle || opts.action) {
      const header = document.createElement('div');
      header.className = 'card-header';

      const headerLeft = document.createElement('div');
      
      if (opts.title) {
        const title = document.createElement('h3');
        title.className = 'card-title';
        title.textContent = opts.title;
        headerLeft.appendChild(title);
      }

      if (opts.subtitle) {
        const subtitle = document.createElement('p');
        subtitle.className = 'card-subtitle';
        subtitle.textContent = opts.subtitle;
        headerLeft.appendChild(subtitle);
      }

      header.appendChild(headerLeft);

      if (opts.action) {
        header.appendChild(opts.action);
      }

      card.appendChild(header);
    }

    // Body
    if (opts.body) {
      const body = document.createElement('div');
      body.className = 'card-body';
      
      if (typeof opts.body === 'string') {
        body.innerHTML = opts.body;
      } else if (opts.body instanceof HTMLElement) {
        body.appendChild(opts.body);
      }

      card.appendChild(body);
    }

    // Footer
    if (opts.footer) {
      const footer = document.createElement('div');
      footer.className = 'card-footer';
      
      if (typeof opts.footer === 'string') {
        footer.innerHTML = opts.footer;
      } else if (opts.footer instanceof HTMLElement) {
        footer.appendChild(opts.footer);
      }

      card.appendChild(footer);
    }

    return card;
  }

  // ============================================
  // SPECIALIZED CARDS
  // ============================================

  /**
   * Create hero card for home page
   * @param {object} data - { label, value, change }
   * @returns {HTMLElement} Hero card element
   */
  function createHeroCard(data) {
    const card = document.createElement('div');
    card.className = 'hero-card';

    const label = document.createElement('div');
    label.className = 'hero-label';
    label.textContent = data.label || 'Total Net Equity';

    const value = document.createElement('div');
    value.className = 'hero-value financial-data';
    value.textContent = Format.currency(data.value || 0);

    card.appendChild(label);
    card.appendChild(value);

    if (data.change !== undefined && data.change !== null) {
      const change = document.createElement('div');
      change.className = 'hero-change financial-data';
      change.textContent = Format.percentage(data.change);
      card.appendChild(change);
    }

    return card;
  }

  /**
   * Create balance card for spot/vault display
   * @param {object} data - { label, value }
   * @returns {HTMLElement} Balance card element
   */
  function createBalanceCard(data) {
    const card = document.createElement('div');
    card.className = 'balance-card';

    const label = document.createElement('div');
    label.className = 'balance-label';
    label.textContent = data.label || 'Balance';

    const value = document.createElement('div');
    value.className = 'balance-value financial-data';
    value.textContent = Format.currency(data.value || 0);

    card.appendChild(label);
    card.appendChild(value);

    return card;
  }

  /**
   * Create stat card for displaying statistics
   * @param {object} data - { label, value, change, changeType }
   * @returns {HTMLElement} Stat card element
   */
  function createStatCard(data) {
    const card = document.createElement('div');
    card.className = 'stat-card';

    const label = document.createElement('div');
    label.className = 'stat-label';
    label.textContent = data.label || 'Statistic';

    const value = document.createElement('div');
    value.className = 'stat-value financial-data';
    value.textContent = data.value || '0';

    card.appendChild(label);
    card.appendChild(value);

    if (data.change !== undefined && data.change !== null) {
      const change = document.createElement('div');
      change.className = `stat-change ${data.changeType || 'stat-change-positive'}`;
      change.textContent = Format.percentage(data.change);
      card.appendChild(change);
    }

    return card;
  }

  /**
   * Create strategy card for vault page
   * @param {object} strategy - Strategy object
   * @param {function} onClick - Click handler
   * @returns {HTMLElement} Strategy card element
   */
  function createStrategyCard(strategy, onClick) {
    const card = create({
      className: 'strategy-card',
      hoverable: true,
      clickable: true,
      onClick: onClick
    });

    // Header
    const header = document.createElement('div');
    header.className = 'strategy-card-header';

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'strategy-icon-wrapper';

    const icon = document.createElement('div');
    icon.className = 'strategy-icon';
    icon.textContent = strategy.icon || '💼';

    const nameWrapper = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'strategy-name';
    name.textContent = strategy.name;
    nameWrapper.appendChild(name);

    iconWrapper.appendChild(icon);
    iconWrapper.appendChild(nameWrapper);

    const badge = document.createElement('span');
    badge.className = `badge badge-risk-${strategy.risk}`;
    badge.textContent = Format.capitalize(strategy.risk) + ' Risk';

    header.appendChild(iconWrapper);
    header.appendChild(badge);
    card.appendChild(header);

    // Stats
    const stats = document.createElement('div');
    stats.className = 'strategy-stats';

    const apyStat = createStrategyStat('Est. APY', Format.apy(strategy.apy), 'apy');
    const lockStat = createStrategyStat('Lock Period', Format.duration(strategy.lockPeriod));
    const minStat = createStrategyStat('Minimum', Format.currency(strategy.minInvestment, false));

    stats.appendChild(apyStat);
    stats.appendChild(lockStat);
    stats.appendChild(minStat);

    card.appendChild(stats);

    return card;
  }

  /**
   * Create strategy stat element
   * @param {string} label - Stat label
   * @param {string} value - Stat value
   * @param {string} className - Additional class name
   * @returns {HTMLElement} Stat element
   */
  function createStrategyStat(label, value, className = '') {
    const stat = document.createElement('div');
    stat.className = 'strategy-stat';

    const statLabel = document.createElement('div');
    statLabel.className = 'strategy-stat-label';
    statLabel.textContent = label;

    const statValue = document.createElement('div');
    statValue.className = `strategy-stat-value financial-data ${className}`;
    statValue.textContent = value;

    stat.appendChild(statLabel);
    stat.appendChild(statValue);

    return stat;
  }

  /**
   * Create investment card for active investments
   * @param {object} investment - Investment object
   * @returns {HTMLElement} Investment card element
   */
  function createInvestmentCard(investment) {
    const card = document.createElement('div');
    card.className = 'investment-card';

    // Header
    const header = document.createElement('div');
    header.className = 'investment-card-header';

    const name = document.createElement('div');
    name.className = 'investment-strategy-name';
    name.textContent = investment.strategy_name;

    const status = document.createElement('span');
    status.className = 'investment-status';
    status.textContent = Format.status(investment.status);

    header.appendChild(name);
    header.appendChild(status);
    card.appendChild(header);

    // Details
    const details = document.createElement('div');
    details.className = 'investment-details';

    const invested = createInvestmentDetail('Invested', Format.currency(investment.amount));
    const current = createInvestmentDetail('Current Value', Format.currency(investment.current_value || investment.amount));
    const profit = createInvestmentDetail('Profit/Loss', Format.currency((investment.current_value || investment.amount) - investment.amount));
    const unlocks = createInvestmentDetail('Unlocks In', Format.duration(Format.daysRemaining(investment.locked_until)));

    details.appendChild(invested);
    details.appendChild(current);
    details.appendChild(profit);
    details.appendChild(unlocks);

    card.appendChild(details);

    // Progress bar
    const progressWrapper = document.createElement('div');
    progressWrapper.className = 'investment-progress';

    const progressHeader = document.createElement('div');
    progressHeader.className = 'investment-progress-header';

    const progressLabel = document.createElement('span');
    progressLabel.textContent = 'Lock Period Progress';

    const progressPercent = document.createElement('span');
    const totalDays = Math.ceil((new Date(investment.locked_until) - new Date(investment.created_at)) / (1000 * 60 * 60 * 24));
    const remainingDays = Format.daysRemaining(investment.locked_until);
    const progressValue = Math.max(0, Math.min(100, ((totalDays - remainingDays) / totalDays) * 100));
    progressPercent.textContent = `${Math.round(progressValue)}%`;

    progressHeader.appendChild(progressLabel);
    progressHeader.appendChild(progressPercent);

    const progressBar = document.createElement('div');
    progressBar.className = 'progress';

    const progressFill = document.createElement('div');
    progressFill.className = 'progress-bar';
    progressFill.style.width = `${progressValue}%`;

    progressBar.appendChild(progressFill);

    progressWrapper.appendChild(progressHeader);
    progressWrapper.appendChild(progressBar);

    card.appendChild(progressWrapper);

    return card;
  }

  /**
   * Create investment detail element
   * @param {string} label - Detail label
   * @param {string} value - Detail value
   * @returns {HTMLElement} Detail element
   */
  function createInvestmentDetail(label, value) {
    const detail = document.createElement('div');
    detail.className = 'investment-detail';

    const detailLabel = document.createElement('div');
    detailLabel.className = 'investment-detail-label';
    detailLabel.textContent = label;

    const detailValue = document.createElement('div');
    detailValue.className = 'investment-detail-value financial-data';
    detailValue.textContent = value;

    detail.appendChild(detailLabel);
    detail.appendChild(detailValue);

    return detail;
  }

  /**
   * Create market item card
   * @param {object} coin - Coin data
   * @param {function} onClick - Click handler
   * @returns {HTMLElement} Market item element
   */
  function createMarketItem(coin, onClick) {
    const item = document.createElement('div');
    item.className = 'market-item';
    
    if (onClick) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', onClick);
      item.addEventListener('touchend', (e) => {
        e.preventDefault();
        onClick(e);
      });
    }

    // Icon
    const iconDiv = document.createElement('div');
    iconDiv.className = 'market-item-icon';
    iconDiv.textContent = coin.symbol.substring(0, 3);

    // Info
    const info = document.createElement('div');
    info.className = 'market-item-info';

    const name = document.createElement('div');
    name.className = 'market-item-name';
    name.textContent = coin.name;

    const symbol = document.createElement('div');
    symbol.className = 'market-item-symbol';
    symbol.textContent = coin.symbol;

    info.appendChild(name);
    info.appendChild(symbol);

    // Data
    const data = document.createElement('div');
    data.className = 'market-item-data';

    const price = document.createElement('div');
    price.className = 'market-item-price financial-data';
    price.textContent = Format.currency(coin.current_price);

    const change = document.createElement('div');
    const changeValue = coin.price_change_percentage_24h || 0;
    change.className = `market-item-change financial-data ${changeValue >= 0 ? 'positive' : 'negative'}`;
    change.textContent = Format.percentage(changeValue);

    data.appendChild(price);
    data.appendChild(change);

    item.appendChild(iconDiv);
    item.appendChild(info);
    item.appendChild(data);

    return item;
  }

  /**
   * Create skeleton loading card
   * @returns {HTMLElement} Skeleton card element
   */
  function createSkeleton() {
    const card = document.createElement('div');
    card.className = 'card';

    const skeletonTitle = document.createElement('div');
    skeletonTitle.className = 'skeleton skeleton-title';

    const skeletonText1 = document.createElement('div');
    skeletonText1.className = 'skeleton skeleton-text';

    const skeletonText2 = document.createElement('div');
    skeletonText2.className = 'skeleton skeleton-text';

    card.appendChild(skeletonTitle);
    card.appendChild(skeletonText1);
    card.appendChild(skeletonText2);

    return card;
  }

  // ============================================
  // EXPORT PUBLIC API
  // ============================================

  return {
    create,
    createWithContent,
    createHeroCard,
    createBalanceCard,
    createStatCard,
    createStrategyCard,
    createInvestmentCard,
    createMarketItem,
    createSkeleton
  };
})();

// ============================================
// EXPORT FOR OTHER MODULES
// ============================================

if (typeof window !== 'undefined') {
  window.Card = Card;
}