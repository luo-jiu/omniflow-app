export type OverlaySpec = {
  requestId: string;
  type: string;
  props: unknown;
};

export type OverlayOpenPayload = {
  requestId?: string;
  type: string;
  props: unknown;
};

export type OverlayUpdatePayload = {
  requestId: string;
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
