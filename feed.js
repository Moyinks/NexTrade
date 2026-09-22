/**
 * NexTrade — Activity Feed Component
 * Live activity feed for trading events
 * Self-invoking module pattern
 */

const Feed = (() => {
  'use strict';

  // ============================================
  // FEED ITEM CREATION
  // ============================================

  /**
   * Create activity feed item
   * @param {object} activity - Activity data
   * @returns {HTMLElement} Activity item element
   */
  function createActivityItem(activity) {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.style.cssText = `
      opacity: 0;
      transform: translateY(-10px);
      transition: all var(--transition-base);
    `;

    // Icon
    const icon = document.createElement('div');
    icon.className = 'activity-icon';

    const iconMap = {
      BUY: { icon: '📈', class: 'activity-icon-buy' },
      SELL: { icon: '📉', class: 'activity-icon-sell' },
      PROFIT: { icon: '💰', class: 'activity-icon-profit' },
      DEPOSIT: { icon: '💵', class: 'activity-icon-buy' },
      WITHDRAW: { icon: '💸', class: 'activity-icon-sell' }
    };

    const iconData = iconMap[activity.type] || { icon: '📊', class: '' };
    icon.innerHTML = iconData.icon;
    icon.classList.add(iconData.class);

    // Content
    const content = document.createElement('div');
    content.className = 'activity-content';

    const title = document.createElement('div');
    title.className = 'activity-title';
    title.textContent = activity.title || activity.type;

    const description = document.createElement('div');
    description.className = 'activity-description';
    description.textContent = activity.description || '';

    content.appendChild(title);
    content.appendChild(description);

    // Meta (amount and time)
    const meta = document.createElement('div');
    meta.className = 'activity-meta';

    if (activity.amount !== undefined && activity.amount !== null) {
      const amount = document.createElement('div');
      amount.className = 'activity-amount financial-data';
      
      const view =
        window.TransactionUI &&
        typeof TransactionUI.present === 'function'
          ? TransactionUI.present({
              ...activity,
              type: String(activity.type || '').toLowerCase(),
              status: activity.status || 'completed'
            })
          : null;

      const prefix = view
        ? view.amountPrefix
        : (
            activity.type === 'BUY' ||
            activity.type === 'DEPOSIT'
              ? '+'
              : ''
          );

      if (view) {
        amount.dataset.tone = view.tone;
      }

      amount.textContent =
        prefix + Format.currency(activity.amount);
      
      meta.appendChild(amount);
    }

    const time = document.createElement('div');
    time.className = 'activity-time';
    time.textContent = Format.relativeTime(activity.timestamp || activity.created_at || new Date());

    meta.appendChild(time);

    // Assemble
    item.appendChild(icon);
    item.appendChild(content);
    item.appendChild(meta);

    // Animate in
    requestAnimationFrame(() => {
      item.style.opacity = '1';
      item.style.transform = 'translateY(0)';
    });

    return item;
  }

  /**
   * Create empty state for feed
   * @returns {HTMLElement} Empty state element
   */
  function createEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.cssText = `
      padding: var(--space-8) var(--space-4);
      text-align: center;
    `;

    const icon = document.createElement('div');
    icon.style.cssText = `
      font-size: 48px;
      margin-bottom: var(--space-4);
      opacity: 0.3;
    `;
    icon.textContent = '📊';

    const title = document.createElement('div');
    title.className = 'empty-state-title';
    title.textContent = 'No Activity Yet';

    const description = document.createElement('div');
    description.className = 'empty-state-description';
    description.textContent = 'Trading activity will appear here once you start investing.';

    empty.appendChild(icon);
    empty.appendChild(title);
    empty.appendChild(description);

    return empty;
  }

  /**
   * Create loading skeleton for feed
   * @param {number} count - Number of skeleton items
   * @returns {HTMLElement} Container with skeleton items
   */
  function createLoadingSkeleton(count = 3) {
    const container = document.createElement('div');
    container.className = 'activity-feed-list';

    for (let i = 0; i < count; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'activity-item';
      skeleton.style.cssText = `
        display: flex;
        gap: var(--space-3);
        align-items: center;
      `;

      const iconSkeleton = document.createElement('div');
      iconSkeleton.className = 'skeleton';
      iconSkeleton.style.cssText = `
        width: 36px;
        height: 36px;
        border-radius: 50%;
      `;

      const contentSkeleton = document.createElement('div');
      contentSkeleton.style.cssText = `
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      `;

      const titleSkeleton = document.createElement('div');
      titleSkeleton.className = 'skeleton skeleton-text';
      titleSkeleton.style.width = '60%';

      const descSkeleton = document.createElement('div');
      descSkeleton.className = 'skeleton skeleton-text';
      descSkeleton.style.width = '80%';

      contentSkeleton.appendChild(titleSkeleton);
      contentSkeleton.appendChild(descSkeleton);

      const metaSkeleton = document.createElement('div');
      metaSkeleton.className = 'skeleton skeleton-text';
      metaSkeleton.style.cssText = `
        width: 60px;
        height: 16px;
      `;

      skeleton.appendChild(iconSkeleton);
      skeleton.appendChild(contentSkeleton);
      skeleton.appendChild(metaSkeleton);

      container.appendChild(skeleton);
    }

    return container;
  }

  // ============================================
  // FEED RENDERING
  // ============================================

  /**
   * Render activity feed
   * @param {HTMLElement} container - Container element
   * @param {array} activities - Array of activity objects
   */
  function render(container, activities) {
    if (!container) {
      console.error('Feed container not found');
      return;
    }

    // Clear container
    container.innerHTML = '';

    if (!activities || activities.length === 0) {
      container.appendChild(createEmptyState());
      return;
    }

    // Sort by timestamp (newest first)
    const sorted = [...activities].sort((a, b) => {
      const timeA = new Date(a.timestamp || a.created_at).getTime();
      const timeB = new Date(b.timestamp || b.created_at).getTime();
      return timeB - timeA;
    });

    // Render items
    sorted.forEach(activity => {
      const item = createActivityItem(activity);
      container.appendChild(item);
    });
  }

  /**
   * Add new activity item to feed (prepend)
   * @param {HTMLElement} container - Container element
   * @param {object} activity - Activity data
   */
  function addActivity(container, activity) {
    if (!container) {
      console.error('Feed container not found');
      return;
    }

    const item = createActivityItem(activity);

    // Remove empty state if present
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    // Prepend to feed
    container.insertBefore(item, container.firstChild);

    // Limit feed items (keep only last 50)
    const items = container.querySelectorAll('.activity-item');
    if (items.length > 50) {
      items[items.length - 1].remove();
    }
  }

  /**
   * Show loading state
   * @param {HTMLElement} container - Container element
   */
  function showLoading(container) {
    if (!container) {
      console.error('Feed container not found');
      return;
    }

    container.innerHTML = '';
    container.appendChild(createLoadingSkeleton());
  }

  /**
   * Update relative timestamps in feed
   * @param {HTMLElement} container - Container element
   */
  function updateTimestamps(container) {
    if (!container) {
      return;
    }

    const timeElements = container.querySelectorAll('.activity-time');
    
    timeElements.forEach(el => {
      const item = el.closest('.activity-item');
      if (item && item.dataset.timestamp) {
        el.textContent = Format.relativeTime(item.dataset.timestamp);
      }
    });
  }

  /**
   * Clear feed
   * @param {HTMLElement} container - Container element
   */
  function clear(container) {
    if (!container) {
      return;
    }

    container.innerHTML = '';
    container.appendChild(createEmptyState());
  }

  // ============================================
  // FEED AUTO-UPDATE
  // ============================================

  let updateInterval = null;

  /**
   * Start auto-updating timestamps every minute
   * @param {HTMLElement} container - Container element
   */
  function startAutoUpdate(container) {
    if (updateInterval) {
      stopAutoUpdate();
    }

    updateInterval = setInterval(() => {
      updateTimestamps(container);
    }, 60000); // Update every minute
  }

  /**
   * Stop auto-updating timestamps
   */
  function stopAutoUpdate() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  // ============================================
  // FEED SUBSCRIPTION
  // ============================================

  /**
   * Subscribe to activity feed updates from AppState
   * @param {HTMLElement} container - Container element
   * @returns {function} Unsubscribe function
   */
  function subscribe(container) {
    if (!container) {
      console.error('Feed container not found');
      return () => {};
    }

    // Initial render
    const activities = AppState.get('activityFeed');
    if (activities && activities.length > 0) {
      render(container, activities);
    } else {
      container.appendChild(createEmptyState());
    }

    // Subscribe to state changes
    const unsubscribe = AppState.subscribe((state) => {
      render(container, state.activityFeed);
    });

    // Start auto-updating timestamps
    startAutoUpdate(container);

    // Return cleanup function
    return () => {
      unsubscribe();
      stopAutoUpdate();
    };
  }

  // ============================================
  // EXPORT PUBLIC API
  // ============================================

  return {
    createActivityItem,
    createEmptyState,
    createLoadingSkeleton,
    render,
    addActivity,
    showLoading,
    updateTimestamps,
    clear,
    subscribe,
    startAutoUpdate,
    stopAutoUpdate
  };
})();

// ============================================
// EXPORT FOR OTHER MODULES
// ============================================

if (typeof window !== 'undefined') {
  window.Feed = Feed;
}