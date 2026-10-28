import type { Cipher } from '../../src/main/services/storage/cipher';

/** Reversible test cipher that makes "encrypted" bytes clearly different from plaintext. */
export const fakeCipher: Cipher = {
  available: true,
  backend: 'test-keychain',
  encrypt: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (data) => Buffer.from(data.map((b) => b ^ 0x5a)).toString('utf8'),
};
