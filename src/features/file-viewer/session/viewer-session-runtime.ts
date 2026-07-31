import { registerAuthSessionRuntime } from '@/service/auth-session-release';
import { createViewerRuntimeSessionId } from './viewer-session-identity';
import { ViewerSessionRegistry } from './viewer-session-registry';

export const viewerSessionRegistry = new ViewerSessionRegistry();

class ViewerSessionRuntime {
  private active = false;
  private runtimeSessionId = createViewerRuntimeSessionId();

  start = () => {
    if (this.active) return;
    this.active = true;
    this.runtimeSessionId = createViewerRuntimeSessionId();
  };

  dispose = () => {
    viewerSessionRegistry.disposeSession();
    this.active = false;
    this.runtimeSessionId = createViewerRuntimeSessionId();
  };

  getRuntimeSessionId() {
    return this.runtimeSessionId;
  }
}

export const viewerSessionRuntime = new ViewerSessionRuntime();

registerAuthSessionRuntime(viewerSessionRuntime);
