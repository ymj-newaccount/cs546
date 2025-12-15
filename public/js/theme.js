// public/js/theme.js
(() => {
  const STORAGE_KEY = 'theme'; // 'light' | 'dark'
  const root = document.documentElement;

  function applyTheme(theme) {
    const t = theme === 'dark' ? 'dark' : 'light';

    // Use attribute for maximum CSS compatibility
    root.setAttribute('data-theme', t);

    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch (e) {
      // localStorage can fail in some privacy modes; ignore safely
    }

    // Debug (remove if you want)
    console.log('[theme] applied:', t);
  }

  function getInitialTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {
      // ignore
    }

    const prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    return prefersDark ? 'dark' : 'light';
  }

  function init() {
    const toggle = document.getElementById('theme-toggle');

    if (!toggle) {
      console.warn('[theme] #theme-toggle not found on this page');
      // Still apply a theme so CSS works even without a visible toggle
      applyTheme(getInitialTheme());
      return;
    }

    const initial = getInitialTheme();
    applyTheme(initial);
    toggle.checked = initial === 'dark';

    toggle.addEventListener('change', () => {
      applyTheme(toggle.checked ? 'dark' : 'light');
    });

    console.log('[theme] initialized, toggle found');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
