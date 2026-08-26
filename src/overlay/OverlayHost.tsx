import React, { useEffect, useState } from 'react';
import { overlayRegistry } from './registry';

type ActiveSpec = {
  requestId: string;
  type: string;
  props: unknown;
};

export const OverlayHost: React.FC = () => {
  const [current, setCurrent] = useState<ActiveSpec | null>(null);

  useEffect(() => {
    if (!window.electronOverlayHost) return;
    const offShow = window.electronOverlayHost.onShow((spec) => {
      setCurrent(spec);
    });
    const offDismiss = window.electronOverlayHost.onDismissFromMain((payload) => {
      setCurrent((prev) => (prev && prev.requestId === payload.requestId ? null : prev));
    });
    const offUpdate = window.electronOverlayHost.onUpdate((payload) => {
      setCurrent((prev) => (
        prev?.requestId === payload.requestId
          ? { ...prev, props: payload.props }
          : prev
      ));
    });
    window.electronOverlayHost.reportReady();
    return () => {
      offShow?.();
      offDismiss?.();
      offUpdate?.();
    };
  }, []);

  if (!current) {
    return null;
  }

  const entry = overlayRegistry[current.type];
  if (!entry) {
    window.electronOverlayHost?.resolve(current.requestId, {
      type: 'cancel',
      reason: `unknown overlay type: ${current.type}`,
    });
    return null;
  }

  const handleResolve = (result: unknown) => {
    const requestId = current.requestId;
    setCurrent(null);
    window.electronOverlayHost?.resolve(requestId, result);
  };

  const handleCancel = () => {
    const requestId = current.requestId;
    setCurrent(null);
    window.electronOverlayHost?.resolve(requestId, { type: 'cancel' });
  };

  const Component = entry.component;
  return (
    <Component
      props={current.props}
      onResolve={handleResolve}
      onCancel={handleCancel}
    />
  );
};
