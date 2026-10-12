import {
  normalizeFirstPartyControlRequest,
  normalizeFirstPartyControlResponse,
  normalizeFirstPartyRegistration,
  normalizeFirstPartyRegistrationToken,
  type FirstPartyControlRequest,
  type FirstPartyControlResponse,
  type FirstPartyRegistrationInput,
  type FirstPartyRegistrationToken,
} from '@/shared/computer-use/first-party-control-contract';

export interface FirstPartyControlsBridge {
  register(input: FirstPartyRegistrationInput): Promise<FirstPartyRegistrationToken>;
  unregister(token: FirstPartyRegistrationToken): Promise<unknown>;
  complete(response: FirstPartyControlResponse): Promise<unknown>;
  onRequest(listener: (request: FirstPartyControlRequest) => void): () => void;
}

function bridge(): FirstPartyControlsBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.electronComputerControls;
}

/** Renderer can register trusted local controls and answer main; it cannot initiate an operation. */
export const firstPartyControlsAPI: FirstPartyControlsBridge = {
  async register(input) {
    const current = bridge();
    if (!current) throw new Error('第一方控件桥不可用');
    return normalizeFirstPartyRegistrationToken(await current.register(normalizeFirstPartyRegistration(input)));
  },
  async unregister(token) {
    return bridge()?.unregister(normalizeFirstPartyRegistrationToken(token));
  },
  async complete(response) {
    return bridge()?.complete(normalizeFirstPartyControlResponse(response));
  },
  onRequest(listener) {
    return bridge()?.onRequest(input => {
      let request: FirstPartyControlRequest;
      try { request = normalizeFirstPartyControlRequest(input); } catch { return; }
      listener(request);
    }) || (() => undefined);
  },
};
