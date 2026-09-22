import { createPluginClient, LIMITS } from '@omniflow/plugin-sdk';
import { runCsvTool } from './tool-runner.js';

const client = createPluginClient();
await client.ready();
await runCsvTool(client, LIMITS.readChunkBytes);
