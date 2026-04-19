export type OverlaySpec = {
  requestId: string;
  type: string;
  props: unknown;
};

export type OverlayOpenPayload = {
  type: string;
  props: unknown;
};

export type OverlayResolvePayload = {
  requestId: string;
  result: unknown;
};

export type OverlayDismissFromRendererPayload = {
  requestId: string;
  reason?: string;
};

export type OverlayDismissFromMainPayload = {
  requestId: string;
};
