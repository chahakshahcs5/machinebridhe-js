import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { makeAuthHook } from '../apps/server/src/auth.js';
import {
  OAuthStore,
  getBaseUrl,
  getProtectedResourceMetadata,
  getAuthorizationServerMetadata,
  renderAuthorizeHtml,
  verifyPkce,
  base64UrlEncode,
} from '../apps/server/src/oauth.js';

describe('OAuth 2.1 & ChatGPT Discovery Implementation', () => {
  const testApiKey = 'mb-secret-key-chatgpt-test';

  describe('OAuthStore and PKCE helpers', () => {
    it('correctly creates and consumes one-time authorization codes', () => {
      const store = new OAuthStore(5000);
      const code = store.createCode({
        clientId: 'test-client',
        redirectUri: 'https://chatgpt.com/connector/oauth/callback',
      });

      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(10);

      const consumed = store.consumeCode(code);
      expect(consumed).toBeDefined();
      expect(consumed?.clientId).toBe('test-client');

      // Second consumption must fail (one-time use)
      expect(store.consumeCode(code)).toBeUndefined();
    });

    it('verifies PKCE with S256 method', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const hash = crypto.createHash('sha256').update(verifier).digest();
      const challenge = base64UrlEncode(hash);

      expect(verifyPkce(verifier, challenge, 'S256')).toBe(true);
      expect(verifyPkce('wrong-verifier', challenge, 'S256')).toBe(false);
    });

    it('verifies PKCE with plain method', () => {
      expect(verifyPkce('my-plain-secret', 'my-plain-secret', 'plain')).toBe(true);
      expect(verifyPkce('my-plain-secret', 'wrong', 'plain')).toBe(false);
    });
  });

  describe('OAuth HTTP Endpoints', () => {
    let app: ReturnType<typeof Fastify>;
    const oauthStore = new OAuthStore();
    const authenticatedSessions = new Set<string>();

    beforeAll(async () => {
      app = Fastify();
      app.addContentTypeParser(
        'application/x-www-form-urlencoded',
        { parseAs: 'string' },
        (_req: unknown, body: string, done: (err: Error | null, result?: unknown) => void) => {
          try {
            const params = new URLSearchParams(body);
            const parsed: Record<string, string> = {};
            for (const [k, v] of params.entries()) {
              parsed[k] = v;
            }
            done(null, parsed);
          } catch (err) {
            done(err as Error, undefined);
          }
        },
      );

      app.addHook(
        'onRequest',
        makeAuthHook(testApiKey, (id) => authenticatedSessions.has(id)),
      );

      // OAuth Discovery Endpoints
      const handleProtectedResource = async (req: FastifyRequest) =>
        getProtectedResourceMetadata(getBaseUrl(req));
      app.get('/.well-known/oauth-protected-resource', handleProtectedResource);
      app.get('/sse/.well-known/oauth-protected-resource', handleProtectedResource);

      const handleAuthServer = async (req: FastifyRequest) =>
        getAuthorizationServerMetadata(getBaseUrl(req));
      app.get('/.well-known/oauth-authorization-server', handleAuthServer);
      app.get('/.well-known/openid-configuration', handleAuthServer);

      // OAuth Authorize
      app.get('/oauth/authorize', async (req: FastifyRequest, reply: FastifyReply) => {
        const query = (req.query as Record<string, string>) || {};
        const { redirect_uri, state, code_challenge, code_challenge_method, apiKey: qKey } = query;
        if (!redirect_uri) return reply.code(400).send({ error: 'missing_redirect_uri' });

        if (qKey === testApiKey) {
          const code = oauthStore.createCode({
            redirectUri: redirect_uri,
            codeChallenge: code_challenge,
            codeChallengeMethod: code_challenge_method,
          });
          const target = new URL(redirect_uri);
          target.searchParams.set('code', code);
          if (state) target.searchParams.set('state', state);
          return reply.redirect(target.toString(), 302);
        }

        const html = renderAuthorizeHtml({
          redirectUri: redirect_uri,
          state,
          codeChallenge: code_challenge,
          codeChallengeMethod: code_challenge_method,
        });
        return reply.type('text/html').send(html);
      });

      app.post('/oauth/authorize', async (req: FastifyRequest, reply: FastifyReply) => {
        const body = (req.body as Record<string, string>) || {};
        const { redirect_uri, state, code_challenge, code_challenge_method, apiKey: subKey } = body;
        if (!redirect_uri) return reply.code(400).send({ error: 'missing_redirect_uri' });

        if (subKey !== testApiKey) {
          const html = renderAuthorizeHtml({
            redirectUri: redirect_uri,
            error: 'Invalid API key',
          });
          return reply.code(401).type('text/html').send(html);
        }

        const code = oauthStore.createCode({
          redirectUri: redirect_uri,
          codeChallenge: code_challenge,
          codeChallengeMethod: code_challenge_method,
        });
        const target = new URL(redirect_uri);
        target.searchParams.set('code', code);
        if (state) target.searchParams.set('state', state);
        return reply.redirect(target.toString(), 302);
      });

      // OAuth Token
      app.post('/oauth/token', async (req: FastifyRequest, reply: FastifyReply) => {
        const body = (req.body as Record<string, string>) || {};
        const { grant_type, code, redirect_uri, code_verifier } = body;

        if (grant_type !== 'authorization_code') {
          return reply.code(400).send({ error: 'unsupported_grant_type' });
        }
        if (!code) return reply.code(400).send({ error: 'invalid_request' });

        const codeData = oauthStore.consumeCode(code);
        if (!codeData) return reply.code(400).send({ error: 'invalid_grant' });

        if (redirect_uri && codeData.redirectUri !== redirect_uri) {
          return reply.code(400).send({ error: 'invalid_grant' });
        }

        if (codeData.codeChallenge) {
          if (
            !code_verifier ||
            !verifyPkce(code_verifier, codeData.codeChallenge, codeData.codeChallengeMethod)
          ) {
            return reply.code(400).send({ error: 'invalid_grant' });
          }
        }

        return reply.code(200).send({
          access_token: testApiKey,
          token_type: 'Bearer',
          expires_in: 31536000,
          scope: 'mcp',
        });
      });

      // Sample protected endpoint
      app.get('/tools', async () => ({ tools: ['terminal_execute', 'fs_read'] }));

      // Sample messages endpoint checking session
      app.post('/messages', async (req: FastifyRequest, reply: FastifyReply) => {
        const parsedUrl = new URL(req.url, 'http://localhost');
        const sessionId = parsedUrl.searchParams.get('sessionId');
        return reply.send({ ok: true, sessionId });
      });

      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns RFC 9728 protected resource metadata without requiring auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/.well-known/oauth-protected-resource',
        headers: { host: 'navigator-test.trycloudflare.com' },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.resource).toBe('http://navigator-test.trycloudflare.com/sse');
      expect(data.authorization_servers).toEqual(['http://navigator-test.trycloudflare.com']);
      expect(data.scopes_supported).toContain('mcp');
    });

    it('returns RFC 8414 authorization server metadata without requiring auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/.well-known/oauth-authorization-server',
        headers: { host: 'navigator-test.trycloudflare.com' },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.issuer).toBe('http://navigator-test.trycloudflare.com');
      expect(data.authorization_endpoint).toBe(
        'http://navigator-test.trycloudflare.com/oauth/authorize',
      );
      expect(data.token_endpoint).toBe('http://navigator-test.trycloudflare.com/oauth/token');
      expect(data.grant_types_supported).toContain('authorization_code');
      expect(data.code_challenge_methods_supported).toContain('S256');
    });

    it('renders HTML authorization page on GET /oauth/authorize', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/oauth/authorize?redirect_uri=https://chatgpt.com/connector/oauth/callback&state=xyz123',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Authorize Connector');
      expect(res.body).toContain('MACHINEBRIDGE_API_KEY');
    });

    it('auto-authorizes when API key is provided directly in GET query', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/oauth/authorize?redirect_uri=https://chatgpt.com/connector/oauth/callback&state=xyz123&apiKey=${testApiKey}`,
      });

      expect(res.statusCode).toBe(302);
      const location = res.headers.location;
      expect(location).toBeDefined();
      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://chatgpt.com');
      expect(redirectUrl.searchParams.get('state')).toBe('xyz123');
      expect(redirectUrl.searchParams.get('code')).toBeDefined();
    });

    it('completes full PKCE authorization code flow and exchanges for valid Bearer token', async () => {
      const verifier = 'E9Melhoa2OwvFrGMTJguCH5rtx64SOiqQN9_30m195U';
      const hash = crypto.createHash('sha256').update(verifier).digest();
      const challenge = base64UrlEncode(hash);
      const redirectUri = 'https://chatgpt.com/connector/oauth/callback';

      // 1. Submit valid API key via POST /oauth/authorize form
      const authRes = await app.inject({
        method: 'POST',
        url: '/oauth/authorize',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          redirect_uri: redirectUri,
          state: 'state-session-99',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          apiKey: testApiKey,
        }).toString(),
      });

      expect(authRes.statusCode).toBe(302);
      const redirectUrl = new URL(authRes.headers.location!);
      const code = redirectUrl.searchParams.get('code');
      expect(code).toBeTruthy();
      expect(redirectUrl.searchParams.get('state')).toBe('state-session-99');

      // 2. Exchange code with PKCE verifier via POST /oauth/token
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }).toString(),
      });

      expect(tokenRes.statusCode).toBe(200);
      const tokenData = JSON.parse(tokenRes.body);
      expect(tokenData.access_token).toBe(testApiKey);
      expect(tokenData.token_type).toBe('Bearer');

      // 3. Use issued access token to access protected endpoint
      const protectedRes = await app.inject({
        method: 'GET',
        url: '/tools',
        headers: { authorization: `Bearer ${tokenData.access_token}` },
      });
      expect(protectedRes.statusCode).toBe(200);
    });

    it('rejects token exchange if PKCE code_verifier does not match challenge', async () => {
      const challenge = base64UrlEncode(
        crypto.createHash('sha256').update('real-verifier').digest(),
      );
      const redirectUri = 'https://chatgpt.com/connector/oauth/callback';

      const authRes = await app.inject({
        method: 'POST',
        url: '/oauth/authorize',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          redirect_uri: redirectUri,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          apiKey: testApiKey,
        }).toString(),
      });

      const code = new URL(authRes.headers.location!).searchParams.get('code');

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: redirectUri,
          code_verifier: 'wrong-verifier',
        }).toString(),
      });

      expect(tokenRes.statusCode).toBe(400);
      expect(JSON.parse(tokenRes.body).error).toBe('invalid_grant');
    });

    it('allows /messages for authenticated sessions without needing headers', async () => {
      const authenticatedSessionId = 'sess-xyz-987';
      authenticatedSessions.add(authenticatedSessionId);

      const res = await app.inject({
        method: 'POST',
        url: `/messages?sessionId=${authenticatedSessionId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).sessionId).toBe(authenticatedSessionId);
    });

    it('blocks /messages for unknown session IDs without API key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/messages?sessionId=unauthenticated-session',
      });

      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toContain('resource_metadata=');
    });
  });
});
