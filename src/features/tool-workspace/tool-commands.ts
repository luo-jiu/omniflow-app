import { HostCommandRegistry } from '@/features/extensions/host-command-registry';
import { toolRegistry } from './tool-registry';
import type { ToolWorkspaceToolId } from './types';

export const toolCommands = new HostCommandRegistry<{ open: (id: ToolWorkspaceToolId) => void }>();
toolCommands.registerBatch('omniflow', [{
  id: 'omniflow.tools.open', title: '打开工具', argumentSchema: 'id', exposure: 'host-only',
  isEnabled: (_context, id) => Boolean(toolRegistry.get(id ?? '')),
  run: (context, id) => { const tool = toolRegistry.get(id ?? ''); if (tool) context.open(tool.id); },
}]);
