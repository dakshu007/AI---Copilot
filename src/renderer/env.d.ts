import type { CopilotApi } from '../preload/api';

declare global {
  interface Window {
    copilot: CopilotApi;
  }
}

export {};
