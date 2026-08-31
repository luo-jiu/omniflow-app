import { saveEmbeddedBrowserCapturedResource } from '../resources/services/embedded-browser-resource.api';

/**
 * Normalized terminal state for the captured-resource local-save workflow.
 * Main remains the owner of dialogs, staging, filesystem writes and cleanup;
 * this renderer adapter only gives callers one stable result vocabulary.
 */
export type LocalSaveDeliveryTerminal = 'cancelled' | 'completed' | 'failed';

export type LocalSaveDeliveryPayload = {
  resourceId?: string;
  suggestedFileName?: string;
};

export type LocalSaveDeliveryResponse = {
  cancelled?: boolean;
  error?: string;
  ok: boolean;
  outputPath?: string;
  terminal: LocalSaveDeliveryTerminal;
};

export type LocalSaveDeliveryOperation = (
  tabId: string,
  payload: LocalSaveDeliveryPayload,
) => Promise<{
  cancelled?: boolean;
  error?: string;
  ok: boolean;
  outputPath?: string;
}>;

function resolveTerminal(result: {
  cancelled?: boolean;
  ok: boolean;
}): LocalSaveDeliveryTerminal {
  if (result.cancelled) return 'cancelled';
  return result.ok ? 'completed' : 'failed';
}

/** Renderer-facing adapter; all side effects remain in the injected API operation. */
export class LocalSaveDeliveryAdapter {
  private readonly save: LocalSaveDeliveryOperation;

  constructor(save: LocalSaveDeliveryOperation) {
    this.save = save;
  }

  async run(
    tabId: string,
    payload: LocalSaveDeliveryPayload,
  ): Promise<LocalSaveDeliveryResponse> {
    const result = await this.save(String(tabId || '').trim(), payload);
    return {
      ...result,
      terminal: resolveTerminal(result),
    };
  }
}

export const localSaveDeliveryAdapter = new LocalSaveDeliveryAdapter(
  saveEmbeddedBrowserCapturedResource,
);
