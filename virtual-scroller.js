class VirtualScroller {
  // Gap applied below every rendered item (render() below). Exposed as a
  // static so callers computing the true stride (rendered card height +
  // this gap) reference the same number instead of assuming it matches a
  // separately hardcoded value.
  static ITEM_GAP_PX = 8;

  constructor(containerEl, items, itemHeight, renderItemFn, bottomClearance = 0, buffer = 5) {
    this.container = containerEl;
    this.items = items;
    this.itemHeight = itemHeight;
    this.renderItem = renderItemFn;
    // Extra px reserved at the end of the scrollable range (e.g. so the
    // last row clears a floating nav bar). Baked into the spacer's own
    // height because that's what actually determines how far this list
    // can scroll — the container's own CSS padding-bottom is NOT read
    // by this class and has no effect on the scrollable range.
    this.bottomClearance = bottomClearance;
    // Extra rows rendered above/below the visible viewport, so fast
    // scrolls don't reveal blank space for a frame before render() catches
    // up. Was hardcoded inside render() (unreachable from outside), so
    // CONFIG.VIRTUAL_SCROLL_BUFFER in wallet.js had no actual effect.
    this.buffer = buffer;
    this.scrollTop = 0;
    this.viewport = null;
    this.spacer = null;
    this.boundOnScroll = null;
    this.init();
  }
  init() {
    this.container.style.position = 'relative';
    this.container.style.overflow = 'auto';
    this.spacer = document.createElement('div');
    this.spacer.style.height = `${this.items.length * this.itemHeight + this.bottomClearance}px`;
    this.spacer.style.position = 'relative';
    this.container.appendChild(this.spacer);
    this.viewport = document.createElement('div');
    this.viewport.style.cssText = 'position:absolute; top:0; left:0; right:0;';
    this.spacer.appendChild(this.viewport);
    this.boundOnScroll = this.onScroll.bind(this);
    this.container.addEventListener('scroll', this.boundOnScroll);
    this.render();
  }
  onScroll() {
    this.scrollTop = this.container.scrollTop;
    requestAnimationFrame(() => this.render());
  }
  render() {
    const buffer = this.buffer;
    const visibleCount = Math.ceil(this.container.clientHeight / this.itemHeight);
    const startIndex = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - buffer);
    const endIndex = Math.min(this.items.length, startIndex + visibleCount + buffer * 2);
    this.viewport.innerHTML = '';
    this.viewport.style.transform = `translateY(${startIndex * this.itemHeight}px)`;
    for (let i = startIndex; i < endIndex; i++) {
      const el = this.renderItem(this.items[i], i);
      el.style.marginBottom = `${VirtualScroller.ITEM_GAP_PX}px`;
      this.viewport.appendChild(el);
    }
  }
  update(newItems) {
    this.items = newItems;
    this.spacer.style.height = `${this.items.length * this.itemHeight + this.bottomClearance}px`;
    this.render();
  }
  destroy() {
    if (this.boundOnScroll) this.container.removeEventListener('scroll', this.boundOnScroll);
    if (this.container) this.container.innerHTML = '';
  }
}
if (typeof window !== 'undefined') window.VirtualScroller = VirtualScroller;