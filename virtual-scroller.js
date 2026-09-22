class VirtualScroller {
  static ITEM_GAP_PX = 8;

  constructor(containerEl, items, itemHeight, renderItemFn, bottomClearance = 0, buffer = 5) {
    this.container = containerEl;
    this.items = items;
    this.itemHeight = itemHeight;
    this.renderItem = renderItemFn;
    this.bottomClearance = bottomClearance;
    this.buffer = buffer;
    this.scrollTop = 0;
    this.viewport = null;
    this.spacer = null;
    this.boundOnScroll = null;
    this.renderFrame = null;
    this.lastStartIndex = -1;
    this.lastEndIndex = -1;
    this.init();
  }

  init() {
    this.container.classList.add('virtual-scroller');

    this.spacer = document.createElement('div');
    this.spacer.className = 'virtual-scroller__spacer';
    this.spacer.style.height = `${this.items.length * this.itemHeight + this.bottomClearance}px`;

    this.viewport = document.createElement('div');
    this.viewport.className = 'virtual-scroller__viewport';

    this.spacer.appendChild(this.viewport);
    this.container.appendChild(this.spacer);

    this.boundOnScroll = this.onScroll.bind(this);
    this.container.addEventListener('scroll', this.boundOnScroll, { passive: true });

    this.render(true);
  }

  onScroll() {
    this.scrollTop = this.container.scrollTop;
    if (this.renderFrame) return;

    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  render(force = false) {
    const visibleCount = Math.ceil(this.container.clientHeight / this.itemHeight);
    const startIndex = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - this.buffer);
    const endIndex = Math.min(this.items.length, startIndex + visibleCount + this.buffer * 2);

    if (!force && startIndex === this.lastStartIndex && endIndex === this.lastEndIndex) {
      return;
    }

    this.lastStartIndex = startIndex;
    this.lastEndIndex = endIndex;

    this.viewport.replaceChildren();
    this.viewport.style.transform = `translateY(${startIndex * this.itemHeight}px)`;

    const fragment = document.createDocumentFragment();

    for (let index = startIndex; index < endIndex; index += 1) {
      const item = this.renderItem(this.items[index], index);
      item.classList.add('virtual-scroller__item');
      fragment.appendChild(item);
    }

    this.viewport.appendChild(fragment);
  }

  update(newItems) {
    const previousScrollTop = this.container.scrollTop;

    this.items = newItems;
    this.spacer.style.height = `${this.items.length * this.itemHeight + this.bottomClearance}px`;

    const maxScrollTop = Math.max(
      0,
      this.items.length * this.itemHeight + this.bottomClearance - this.container.clientHeight
    );

    this.scrollTop = Math.min(previousScrollTop, maxScrollTop);
    this.container.scrollTop = this.scrollTop;
    this.lastStartIndex = -1;
    this.lastEndIndex = -1;
    this.render(true);
  }

  destroy() {
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }

    if (this.boundOnScroll && this.container) {
      this.container.removeEventListener('scroll', this.boundOnScroll);
    }

    if (this.container) {
      this.container.replaceChildren();
      this.container.classList.remove('virtual-scroller');
    }
  }
}

if (typeof window !== 'undefined') window.VirtualScroller = VirtualScroller;
