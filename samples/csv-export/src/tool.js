import { createPluginClient, LIMITS } from '@omniflow/plugin-sdk';
import { runCsvExport } from './tool-runner.js';

const client = createPluginClient();
await client.ready();
await runCsvExport(client, LIMITS.readChunkBytes);
