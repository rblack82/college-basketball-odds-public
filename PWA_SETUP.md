# Rick's Picks iPhone Home Screen installation

The same GitHub Pages site serves both browser and installed Home Screen users. The existing dashboard, data collection, and PIN backend remain unchanged.

On an iPhone, open https://rblack82.github.io/college-basketball-odds-public/ in Safari, use Share → Add to Home Screen, enable Open as Web App if shown, then tap Add.

The manifest provides standalone display and a branded SVG icon. The browser site remains fully functional. An Apple-touch PNG icon may be added later for consistent Home Screen icon rendering on all iOS versions. No service worker is registered intentionally: the dashboard requires fresh live odds, so we avoid caching data or showing stale betting lines.

This is a Home Screen web app, not an App Store app. An internet connection is required for the dashboard.
