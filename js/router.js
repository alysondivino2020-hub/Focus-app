const validRoutes = new Set(['home','agenda','focus','profile']);

export class Router {
  constructor(onRoute) {
    this.onRoute = onRoute;
    this.current = 'home';
    this.bound = () => this.resolve();
  }

  start() {
    window.addEventListener('hashchange', this.bound);
    this.resolve();
  }

  stop() {
    window.removeEventListener('hashchange', this.bound);
  }

  resolve() {
    const route = location.hash.replace('#','').split('?')[0] || 'home';
    this.current = validRoutes.has(route) ? route : 'home';
    if (route !== this.current) history.replaceState(null, '', `#${this.current}`);
    this.updateNavigation();
    this.onRoute?.(this.current);
  }

  go(route) {
    location.hash = validRoutes.has(route) ? route : 'home';
  }

  updateNavigation() {
    document.querySelectorAll('[data-route]').forEach(element => {
      const active = element.dataset.route === this.current;
      element.classList.toggle('active', active);
      if (active) element.setAttribute('aria-current', 'page');
      else element.removeAttribute('aria-current');
    });
  }
}
