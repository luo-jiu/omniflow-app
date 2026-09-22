import { createPluginClient } from '@omniflow/plugin-sdk';
import { runRenameTool } from './tool-runner.js';

const client = createPluginClient();
await client.ready();
await runRenameTool(client);
