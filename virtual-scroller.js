class VirtualScroller {
  constructor(containerEl, items, itemHeight, renderItemFn) {
    this.container = containerEl;
    this.items = items;
    this.itemHeight = itemHeight;
    this.renderItem = renderItemFn;
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
    this.spacer.style.height = `${this.items.length * this.itemHeight}px`;
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
    const buffer = 5;
    const visibleCount = Math.ceil(this.container.clientHeight / this.itemHeight);
    const startIndex = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - buffer);
    const endIndex = Math.min(this.items.length, startIndex + visibleCount + buffer * 2);
    this.viewport.innerHTML = '';
    this.viewport.style.transform = `translateY(${startIndex * this.itemHeight}px)`;
    for (let i = startIndex; i < endIndex; i++) {
      const el = this.renderItem(this.items[i], i);
      el.style.marginBottom = '8px';
      this.viewport.appendChild(el);
    }
  }
  update(newItems) {
    this.items = newItems;
    this.spacer.style.height = `${this.items.length * this.itemHeight}px`;
    this.render();
  }
  destroy() {
    if (this.boundOnScroll) this.container.removeEventListener('scroll', this.boundOnScroll);
    if (this.container) this.container.innerHTML = '';
  }
}
if (typeof window !== 'undefined') window.VirtualScroller = VirtualScroller;