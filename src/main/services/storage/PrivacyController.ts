import type { HistoryStore } from './HistoryStore';
import type { ProfileStore } from './ProfileStore';
import type { SecureSettingsService } from './SecureSettingsService';

/**
 * Central place for consent, retention and deletion. Deleting removes the underlying files,
 * not just the in-memory copies.
 */
export class PrivacyController {
  constructor(
    private readonly settings: SecureSettingsService,
    private readonly profiles: ProfileStore,
    private readonly history: HistoryStore,
  ) {}

  async deleteAllData(): Promise<void> {
    await this.history.deleteAll();
    await this.profiles.deleteProfile();
    await this.profiles.deleteJob();
    await this.settings.deleteAll();
  }

  async applyRetention(now = Date.now()): Promise<number> {
    const { privacy } = this.settings.get();
    return this.history.prune(privacy.retentionDays, now);
  }

  hasTranscriptionConsent(): boolean {
    return this.settings.get().privacy.consentTranscription;
  }

  hasLlmConsent(): boolean {
    return this.settings.get().privacy.consentLlm;
  }
}
