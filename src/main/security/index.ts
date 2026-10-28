import { shell, type BrowserWindow, type Session } from 'electron';

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function isTrustedOrigin(url: string, devServerUrl?: string): boolean {
  if (!url) return false;
  if (url.startsWith('file://')) return true;
  if (devServerUrl) {
    try {
      return new URL(url).origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Session-wide hardening: strict CSP (production), deny every permission except microphone /
 * system-audio capture for our own pages, and refuse to load remote content.
 */
export function hardenSession(session: Session, options: { devServerUrl?: string }): void {
  if (!options.devServerUrl) {
    session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [PRODUCTION_CSP],
          'X-Content-Type-Options': ['nosniff'],
        },
      });
    });
  }

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = details.requestingUrl || webContents.getURL();
    const trusted = isTrustedOrigin(origin, options.devServerUrl);
    const allowed = permission === 'media' || permission === 'display-capture' || permission === 'clipboard-sanitized-write';
    callback(trusted && allowed);
  });

  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    const trusted = isTrustedOrigin(requestingOrigin, options.devServerUrl) || requestingOrigin === 'file:///';
    return trusted && (permission === 'media' || permission === 'clipboard-sanitized-write');
  });
}

/** Block navigation and new windows; open vetted https links in the user's browser. */
export function hardenWindow(window: BrowserWindow, options: { devServerUrl?: string }): void {
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedOrigin(url, options.devServerUrl)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
