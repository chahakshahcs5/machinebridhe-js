import crypto from 'node:crypto';
import { buildApp } from '../apps/server/src/main.js';
import { base64UrlEncode } from '../apps/server/src/oauth.js';

describe('ChatGPT & OpenAI MCP 2026-07-28 Stateless Protocol', () => {
  let serverCtx: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    serverCtx = await buildApp({
      MACHINEBRIDGE_API_KEY: 'test-openai-mcp-api-key',
      MACHINEBRIDGE_EXPOSE_TUNNEL: false,
    });
    await serverCtx.app.ready();
  });

  afterAll(async () => {
    serverCtx.ptyManager.closeAll();
    await serverCtx.app.close();
  });

  it('handles GET /.well-known/oauth-protected-resource', async () => {
    const res = await serverCtx.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.resource).toBeDefined();
    expect(body.authorization_servers).toBeInstanceOf(Array);
    expect(body.scopes_supported).toContain('mcp');
  });

  it('handles GET /.well-known/oauth-authorization-server', async () => {
    const res = await serverCtx.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token_endpoint).toContain('/oauth/token');
    expect(body.authorization_endpoint).toContain('/oauth/authorize');
    expect(body.registration_endpoint).toContain('/oauth/register');
  });

  it('handles GET /.well-known/openid-configuration', async () => {
    const res = await serverCtx.app.inject({
      method: 'GET',
      url: '/.well-known/openid-configuration',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token_endpoint).toContain('/oauth/token');
  });

  it('successfully responds to ChatGPT req-9 (POST /sse with server/discover)', async () => {
    const chatGptPayload = {
      jsonrpc: '2.0',
      id: 'openai-mcp-discover',
      method: 'server/discover',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'openai-mcp',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/clientCapabilities': {
            experimental: {
              'openai/visibility': {
                enabled: true,
              },
            },
            extensions: {
              'io.modelcontextprotocol/ui': {
                mimeTypes: ['text/html;profile=mcp-app'],
              },
            },
          },
        },
      },
    };

    const res = await serverCtx.app.inject({
      method: 'POST',
      url: '/sse',
      headers: {
        'user-agent': 'openai-mcp/1.0.0',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-method': 'server/discover',
        'mcp-protocol-version': '2026-07-28',
      },
      payload: chatGptPayload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['mcp-protocol-version']).toBe('2026-07-28');

    const body = JSON.parse(res.body);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe('openai-mcp-discover');
    expect(body.result).toBeDefined();
    expect(body.result.supportedVersions).toContain('2026-07-28');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('machinebridge-mcp');
  });

  it('successfully responds to MCP tools/list over stateless POST /sse', async () => {
    const res = await serverCtx.app.inject({
      method: 'POST',
      url: '/sse',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
      },
      payload: {
        jsonrpc: '2.0',
        id: 'tools-list-req-10',
        method: 'tools/list',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe('tools-list-req-10');
    expect(Array.isArray(body.result.tools)).toBe(true);

    const execTool = body.result.tools.find((t: { name: string }) => t.name === 'execute_command');
    expect(execTool).toBeDefined();
    expect(execTool.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['mcp'] }]);
  });

  it('returns OAuth challenge when tools/call is invoked without authorization', async () => {
    const res = await serverCtx.app.inject({
      method: 'POST',
      url: '/sse',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
      },
      payload: {
        jsonrpc: '2.0',
        id: 'tool-call-unauthed',
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: { command: 'whoami' },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result.isError).toBe(true);
    expect(body.result._meta['mcp/www_authenticate']).toBeDefined();
    expect(body.result._meta['mcp/www_authenticate'][0]).toContain('Bearer resource_metadata=');
  });

  it('handles batch JSON-RPC requests on /sse without headers-sent errors', async () => {
    const res = await serverCtx.app.inject({
      method: 'POST',
      url: '/sse',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
      },
      payload: [
        { jsonrpc: '2.0', id: 'batch-1', method: 'ping' },
        { jsonrpc: '2.0', id: 'batch-2', method: 'server/discover' },
      ],
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].id).toBe('batch-1');
    expect(body[1].id).toBe('batch-2');
  });

  it('completes the full end-to-end OAuth 2.1 flow and executes a tool with the issued bearer token', async () => {
    // 1. Dynamic Client Registration
    const regRes = await serverCtx.app.inject({
      method: 'POST',
      url: '/oauth/register',
      headers: { 'content-type': 'application/json' },
      payload: {
        client_name: 'ChatGPT-Local-Test',
        redirect_uris: ['https://chatgpt.com/connector/oauth/callback'],
      },
    });
    expect(regRes.statusCode).toBe(201);
    const clientData = JSON.parse(regRes.body);
    expect(clientData.client_id).toBeDefined();

    // 2. Client generates PKCE verifier & challenge
    const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-test-verifier';
    const hash = crypto.createHash('sha256').update(codeVerifier).digest();
    const codeChallenge = base64UrlEncode(hash);
    const state = 'oauth-state-abc-123';
    const redirectUri = 'https://chatgpt.com/connector/oauth/callback';

    // 3. User navigates to consent page (GET /oauth/authorize)
    const authPageRes = await serverCtx.app.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=${clientData.client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}`,
    });
    expect(authPageRes.statusCode).toBe(200);
    expect(authPageRes.headers['content-type']).toContain('text/html');
    expect(authPageRes.body).toContain('Authorize MachineBridge MCP');

    // 4. User submits authorization with their MachineBridge API key
    const authSubmitRes = await serverCtx.app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        apiKey: 'test-openai-mcp-api-key',
      }).toString(),
    });
    expect(authSubmitRes.statusCode).toBe(302);
    const redirectUrl = new URL(authSubmitRes.headers.location!);
    expect(redirectUrl.searchParams.get('state')).toBe(state);
    const authCode = redirectUrl.searchParams.get('code');
    expect(authCode).toBeDefined();

    // 5. Client exchanges authorization code and code_verifier for Access Token (POST /oauth/token)
    const tokenRes = await serverCtx.app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode!,
        redirect_uri: redirectUri,
        client_id: clientData.client_id,
        code_verifier: codeVerifier,
      }).toString(),
    });
    expect(tokenRes.statusCode).toBe(200);
    const tokenData = JSON.parse(tokenRes.body);
    expect(tokenData.access_token).toBeDefined();
    expect(tokenData.token_type).toBe('Bearer');

    // 6. Client calls protected MCP tool over /sse with the issued Bearer access token
    const toolCallRes = await serverCtx.app.inject({
      method: 'POST',
      url: '/sse',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        authorization: `Bearer ${tokenData.access_token}`,
      },
      payload: {
        jsonrpc: '2.0',
        id: 'tool-call-authed',
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: { command: 'echo "OAuth Success"' },
        },
      },
    });

    expect(toolCallRes.statusCode).toBe(200);
    const toolCallBody = JSON.parse(toolCallRes.body);
    expect(toolCallBody.result.isError).toBeFalsy();
    expect(toolCallBody.result.content).toBeDefined();
    expect(toolCallBody.result.content[0].text).toContain('OAuth Success');
  });
});
