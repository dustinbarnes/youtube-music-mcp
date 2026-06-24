import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initDatabase } from './cache/index.js';
import { getAuthClient } from './auth/index.js';
import { registerTools } from './tools/index.js';

if (!process.env['GOOGLE_CLIENT_ID'] || !process.env['GOOGLE_CLIENT_SECRET']) {
  process.stderr.write(
    'Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in the environment.\n',
  );
  process.exit(1);
}

(async () => {
  initDatabase();

  const auth = await getAuthClient();

  const server = new McpServer({
    name: 'youtube-music-mcp',
    version: '0.1.0',
  });

  registerTools(server, auth);

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
