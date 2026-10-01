import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import {
  OAuthStore,
  getBaseUrl,
  getProtectedResourceMetadata,
  getAuthorizationServerMetadata,
  renderAuthorizeHtml,
  verifyPkce,
} from '../oauth.js';
import { verifyApiKey } from '@machinebridge/shared';

export function registerOAuthRoutes(
  app: FastifyInstance,
  options: {
    apiKey: string;
    oauthStore: OAuthStore;
  },
): void {
  const { apiKey, oauthStore } = options;

  const handleProtectedResource = async (request: FastifyRequest) => {
    const baseUrl = getBaseUrl(request);
    return getProtectedResourceMetadata(baseUrl);
  };
  app.get('/.well-known/oauth-protected-resource', handleProtectedResource);
  app.get('/.well-known/oauth-protected-resource/sse', handleProtectedResource);
  app.get('/.well-known/oauth-protected-resource*', handleProtectedResource);
  app.get('/sse/.well-known/oauth-protected-resource', handleProtectedResource);

  const handleAuthServerMetadata = async (request: FastifyRequest) => {
    const baseUrl = getBaseUrl(request);
    return getAuthorizationServerMetadata(baseUrl);
  };
  app.get('/.well-known/oauth-authorization-server', handleAuthServerMetadata);
  app.get('/.well-known/openid-configuration', handleAuthServerMetadata);

  app.get('/oauth/userinfo', async () => ({
    sub: 'machinebridge-user',
    name: 'MachineBridge User',
    email: 'user@machinebridge.local',
    email_verified: true,
  }));

  app.post('/oauth/register', async (request, reply) => {
    const body = (request.body as Record<string, unknown>) || {};
    const redirectUris = Array.isArray(body.redirect_uris)
      ? (body.redirect_uris as string[])
      : ['https://chatgpt.com/connector/oauth/callback'];
    const authMethod = (body.token_endpoint_auth_method as string) || 'client_secret_basic';
    const clientId = `client_${crypto.randomBytes(8).toString('hex')}`;
    const clientSecret = crypto.randomBytes(24).toString('hex');
    const now = Math.floor(Date.now() / 1000);

    return reply.code(201).send({
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: now,
      client_secret_expires_at: 0,
      client_name: (body.client_name as string) || 'ChatGPT Connector',
      redirect_uris: redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: authMethod,
      scope: 'mcp',
    });
  });

  app.get('/oauth/authorize', async (request, reply) => {
    const query = (request.query as Record<string, string>) || {};
    const {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      apiKey: queryApiKey,
    } = query;

    if (!redirect_uri) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', error_description: 'Missing redirect_uri' });
    }

    const baseUrl = getBaseUrl(request);

    if (queryApiKey && verifyApiKey(apiKey, queryApiKey)) {
      const code = oauthStore.createCode({
        clientId: client_id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
      });

      const target = new URL(redirect_uri);
      target.searchParams.set('code', code);
      if (state) target.searchParams.set('state', state);
      target.searchParams.set('iss', baseUrl);
      return reply.redirect(target.toString(), 302);
    }

    const html = renderAuthorizeHtml({
      clientId: client_id,
      redirectUri: redirect_uri,
      state,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
    });
    return reply.type('text/html').send(html);
  });

  app.post('/oauth/authorize', async (request, reply) => {
    const body = (request.body as Record<string, string>) || {};
    const {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      apiKey: submittedApiKey,
    } = body;

    if (!redirect_uri) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', error_description: 'Missing redirect_uri' });
    }

    if (!submittedApiKey || !verifyApiKey(apiKey, submittedApiKey)) {
      const html = renderAuthorizeHtml({
        clientId: client_id,
        redirectUri: redirect_uri,
        state,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
        error: 'Invalid API key. Please check your MACHINEBRIDGE_API_KEY.',
      });
      return reply.code(401).type('text/html').send(html);
    }

    const code = oauthStore.createCode({
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
    });

    const baseUrl = getBaseUrl(request);
    const target = new URL(redirect_uri);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);
    target.searchParams.set('iss', baseUrl);
    return reply.redirect(target.toString(), 302);
  });

  app.post('/oauth/token', async (request, reply) => {
    const body = (request.body as Record<string, string>) || {};
    const grantType = body.grant_type;
    const code = body.code;
    const redirectUri = body.redirect_uri;
    const codeVerifier = body.code_verifier;

    if (grantType !== 'authorization_code') {
      return reply.code(400).send({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code grant is supported',
      });
    }

    if (!code) {
      return reply.code(400).send({
        error: 'invalid_request',
        error_description: 'Missing authorization code',
      });
    }

    const codeData = oauthStore.consumeCode(code);
    if (!codeData) {
      return reply.code(400).send({
        error: 'invalid_grant',
        error_description: 'Authorization code is invalid or expired',
      });
    }

    if (redirectUri && codeData.redirectUri && redirectUri !== codeData.redirectUri) {
      return reply.code(400).send({
        error: 'invalid_grant',
        error_description: 'Redirect URI mismatch',
      });
    }

    if (codeData.codeChallenge) {
      if (!codeVerifier) {
        return reply.code(400).send({
          error: 'invalid_grant',
          error_description: 'Missing code_verifier for PKCE',
        });
      }
      const isValid = verifyPkce(
        codeVerifier,
        codeData.codeChallenge,
        codeData.codeChallengeMethod,
      );
      if (!isValid) {
        return reply.code(400).send({
          error: 'invalid_grant',
          error_description: 'PKCE verification failed',
        });
      }
    }

    return reply.code(200).send({
      access_token: apiKey,
      token_type: 'Bearer',
      expires_in: 31536000,
      scope: 'mcp',
    });
  });
}
