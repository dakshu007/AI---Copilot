/** Abstraction over Electron `safeStorage` so storage code is testable in plain Node. */
export interface Cipher {
  /** True only when encryption is backed by the OS credential store (Keychain on macOS). */
  readonly available: boolean;
  readonly backend: string;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export const NO_CIPHER: Cipher = {
  available: false,
  backend: 'none',
  encrypt() {
    throw new Error('Secure storage is not available');
  },
  decrypt() {
    throw new Error('Secure storage is not available');
  },
};

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(data: Buffer): string;
  getSelectedStorageBackend?: () => string;
}

/**
 * Wrap Electron's safeStorage. On Linux, the `basic_text` backend uses a hard-coded key, so we
 * treat it as unavailable instead of pretending secrets are protected.
 */
export function createSafeStorageCipher(safeStorage: SafeStorageLike, platform: NodeJS.Platform): Cipher {
  let available = false;
  let backend: string = platform === 'darwin' ? 'macOS Keychain' : platform === 'win32' ? 'Windows DPAPI' : 'unknown';
  try {
    available = safeStorage.isEncryptionAvailable();
    if (platform === 'linux' && safeStorage.getSelectedStorageBackend) {
      backend = safeStorage.getSelectedStorageBackend();
      if (backend === 'basic_text' || backend === 'unknown') available = false;
    }
  } catch {
    available = false;
  }
  if (!available) return { ...NO_CIPHER, backend };
  return {
    available: true,
    backend,
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  };
}
