import { createPluginClient, LIMITS } from '@omniflow/plugin-sdk';
import { runJsonTransform } from './tool-runner.js';
const client = createPluginClient();
await client.ready();
await runJsonTransform(client, LIMITS.readChunkBytes);
