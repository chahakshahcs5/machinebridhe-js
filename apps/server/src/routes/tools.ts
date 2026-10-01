import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { executeTool, MCP_TOOLS, type McpContext } from '../mcp/index.js';

export function registerToolsRoutes(app: FastifyInstance, ctx: McpContext): void {
  app.get('/tools', async () => ({ tools: MCP_TOOLS }));
  app.get('/v1/tools', async () => ({ tools: MCP_TOOLS }));

  const handleToolExecution = async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    const query = (request.query as Record<string, unknown>) || {};
    const body = (request.body as Record<string, unknown>) || {};
    const args = { ...query, ...body };

    const result = await executeTool(name, args, ctx);
    if (result.isError) {
      return reply.code(400).send(result);
    }
    return result;
  };

  app.get('/tools/:name', handleToolExecution);
  app.post('/tools/:name', handleToolExecution);
  app.get('/v1/tools/:name', handleToolExecution);
  app.post('/v1/tools/:name', handleToolExecution);
}
