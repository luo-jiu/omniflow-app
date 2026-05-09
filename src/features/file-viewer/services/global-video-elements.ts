type GlobalVideoRecord = {
  element: HTMLVideoElement;
  mountToken: number;
};

type MountedGlobalVideoElement = {
  element: HTMLVideoElement;
  mountToken: number;
};

const videoRecords = new Map<string, GlobalVideoRecord>();
let parkingHost: HTMLDivElement | null = null;

function ensureParkingHost() {
  if (parkingHost && document.body.contains(parkingHost)) {
    return parkingHost;
  }
  const host = document.createElement('div');
  host.setAttribute('data-omniflow-video-parking-host', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-10000px',
    top: '-10000px',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(host);
  parkingHost = host;
  return host;
}

function prepareVideoElement(element: HTMLVideoElement) {
  element.className = 'video-element';
  element.preload = 'metadata';
  element.playsInline = true;
  element.controls = false;
  Object.assign(element.style, {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    background: '#000',
  });
}

function getOrCreateRecord(key: string): GlobalVideoRecord {
  const current = videoRecords.get(key);
  if (current) {
    prepareVideoElement(current.element);
    return current;
  }
  const element = document.createElement('video');
  prepareVideoElement(element);
  const record: GlobalVideoRecord = {
    element,
    mountToken: 0,
  };
  videoRecords.set(key, record);
  return record;
}

export function getGlobalVideoElement(key: string) {
  return getOrCreateRecord(key).element;
}

export function mountGlobalVideoElement(
  key: string,
  container: HTMLElement,
): MountedGlobalVideoElement {
  const record = getOrCreateRecord(key);
  record.mountToken += 1;
  prepareVideoElement(record.element);
  if (record.element.parentElement !== container) {
    container.appendChild(record.element);
  }
  return {
    element: record.element,
    mountToken: record.mountToken,
  };
}

export function parkGlobalVideoElement(key: string, mountToken?: number) {
  const record = videoRecords.get(key);
  if (!record || (mountToken !== undefined && mountToken !== record.mountToken)) {
    return;
  }
  ensureParkingHost().appendChild(record.element);
}

export function releaseGlobalVideoElement(key: string, mountToken?: number) {
  const record = videoRecords.get(key);
  if (!record || (mountToken !== undefined && mountToken !== record.mountToken)) {
    return;
  }
  record.element.pause();
  record.element.removeAttribute('src');
  record.element.load();
  record.element.remove();
  videoRecords.delete(key);
}
