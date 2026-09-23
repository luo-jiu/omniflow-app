/** A launch intent from the captured tree selection; execution facts remain in main. */
export interface PluginCommandOpenRequest {
  id: string | number;
  commandId: string;
  nodeIds: number[];
}

export const PLUGIN_COMMAND_WORKSPACE_ID = 'omniflow.plugin-commands' as const;
