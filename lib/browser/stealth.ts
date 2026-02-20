import type { Page } from "playwright";

// --- Chrome launch args for stealth ---

export const STEALTH_CHROME_ARGS = [
	"--window-size=1920,1080",
	"--disable-infobars",
	"--disable-features=Translate,MediaRouter,AutomationControlled",
	"--enable-features=NetworkService,NetworkServiceInProcess",
];

// --- Realistic user-agent (update periodically to match current Chrome stable) ---

export const REALISTIC_USER_AGENT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// --- JavaScript patches injected before any page script runs ---

const STEALTH_INIT_SCRIPT = `
// 1. navigator.webdriver → undefined
Object.defineProperty(navigator, 'webdriver', {
  get: () => undefined,
  configurable: true,
});

// 1b. navigator.userAgent — remove "HeadlessChrome"
{
  const originalUA = navigator.userAgent;
  if (originalUA.includes('HeadlessChrome')) {
    const fixedUA = originalUA.replace('HeadlessChrome', 'Chrome');
    Object.defineProperty(navigator, 'userAgent', {
      get: () => fixedUA,
      configurable: true,
    });
  }
}

// 2. window.chrome object
if (!window.chrome) {
  window.chrome = {};
}
if (!window.chrome.runtime) {
  window.chrome.runtime = {};
}

// 3. navigator.plugins — headless has 0, real Chrome has ≥3
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const defs = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ];
    const arr = Object.create(PluginArray.prototype);
    for (let i = 0; i < defs.length; i++) {
      const p = Object.create(Plugin.prototype);
      Object.defineProperties(p, {
        name: { value: defs[i].name, enumerable: true },
        filename: { value: defs[i].filename, enumerable: true },
        description: { value: defs[i].description, enumerable: true },
        length: { value: 0, enumerable: true },
      });
      arr[i] = p;
    }
    Object.defineProperty(arr, 'length', { value: defs.length });
    arr.item = (i) => arr[i] || null;
    arr.namedItem = (name) => {
      for (let i = 0; i < defs.length; i++) {
        if (arr[i].name === name) return arr[i];
      }
      return null;
    };
    arr.refresh = () => {};
    return arr;
  },
  configurable: true,
});

// 4. navigator.languages
Object.defineProperty(navigator, 'languages', {
  get: () => ['en-US', 'en'],
  configurable: true,
});

// 5. Notification.permission
if (typeof Notification !== 'undefined') {
  Object.defineProperty(Notification, 'permission', {
    get: () => 'default',
    configurable: true,
  });
}

// 6. navigator.permissions.query — realistic response for notifications
if (navigator.permissions) {
  const originalQuery = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (params) => {
    if (params.name === 'notifications') {
      return Promise.resolve({ state: 'default', onchange: null });
    }
    return originalQuery(params);
  };
}

// 7. WebGL vendor/renderer — hide "Google SwiftShader"
(function() {
  const getParamProxy = new Proxy(WebGLRenderingContext.prototype.getParameter, {
    apply(target, thisArg, args) {
      const param = args[0];
      if (param === 0x9245) return 'Google Inc. (Intel)';          // UNMASKED_VENDOR_WEBGL
      if (param === 0x9246) return 'ANGLE (Intel, Mesa Intel(R) UHD Graphics, OpenGL 4.6)'; // UNMASKED_RENDERER_WEBGL
      return Reflect.apply(target, thisArg, args);
    },
  });
  WebGLRenderingContext.prototype.getParameter = getParamProxy;
  if (typeof WebGL2RenderingContext !== 'undefined') {
    WebGL2RenderingContext.prototype.getParameter = getParamProxy;
  }
})();

// 8. chrome.runtime stubs
if (window.chrome && window.chrome.runtime) {
  window.chrome.runtime.sendMessage = function() { return Promise.resolve(); };
  window.chrome.runtime.connect = function() {
    return {
      onMessage: { addListener: () => {} },
      onDisconnect: { addListener: () => {} },
      postMessage: () => {},
    };
  };
}

// 9. navigator.connection
if (!navigator.connection) {
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      effectiveType: '4g',
      rtt: 50,
      downlink: 10,
      saveData: false,
      onchange: null,
    }),
    configurable: true,
  });
}

// 10. navigator.hardwareConcurrency & deviceMemory
Object.defineProperty(navigator, 'hardwareConcurrency', {
  get: () => 8,
  configurable: true,
});
if (navigator.deviceMemory !== undefined && navigator.deviceMemory < 4) {
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
    configurable: true,
  });
}
`;

// Track which pages have had stealth applied to avoid double-applying
const stealthApplied = new WeakSet<Page>();

/**
 * Apply all stealth measures to a page. Must be called BEFORE page.goto().
 * Safe to call multiple times — skips if already applied.
 */
export async function applyStealthToPage(page: Page): Promise<void> {
	if (stealthApplied.has(page)) return;
	stealthApplied.add(page);

	// Init script runs before any page JS on every navigation (including iframes)
	await page.addInitScript(STEALTH_INIT_SCRIPT);

	// Override user-agent at the network level (affects HTTP request headers).
	// Session is kept alive — detaching would undo the override.
	try {
		const session = await page.context().newCDPSession(page);
		await session.send("Network.setUserAgentOverride", {
			userAgent: REALISTIC_USER_AGENT,
			acceptLanguage: "en-US,en;q=0.9",
			platform: "Linux x86_64",
		});
	} catch {
		// Page may have been closed
	}

	// Set realistic viewport
	await page.setViewportSize({ width: 1920, height: 1080 });
}
