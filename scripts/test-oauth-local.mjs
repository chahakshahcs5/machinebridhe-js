#!/usr/bin/env node

/**
 * MachineBridge Local OAuth 2.1 Flow Verification Script
 *
 * Tests the complete OAuth 2.1 + PKCE authentication and authorization flow locally:
 * 1. Health & Server check
 * 2. OAuth Resource & Auth Server Metadata Discovery
 * 3. Dynamic Client Registration (RFC 7591)
 * 4. PKCE S256 Challenge Generation (RFC 7636)
 * 5. Authorization Consent & Code Grant (RFC 6749)
 * 6. Token Exchange for Bearer Access Token
 * 7. Authorized MCP Tool Execution with Bearer Token
 */

import crypto from 'node:crypto';

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {
    // optional .env
  }
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const API_KEY = process.env.MACHINEBRIDGE_API_KEY || 'machinebridge-dev-key';

function base64UrlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

console.log('='.repeat(65));
console.log(' MachineBridge OAuth 2.1 Local Flow Verification');
console.log('='.repeat(65));
console.log(`Target Base URL: ${BASE_URL}`);
console.log(`Using API Key:  ${API_KEY.slice(0, 4)}***${API_KEY.slice(-3)}\n`);

async function run() {
  // Step 0: Check server health
  process.stdout.write('[1/7] Checking server readiness... ');
  try {
    const healthRes = await fetch(`${BASE_URL}/health`);
    if (!healthRes.ok) {
      throw new Error(`Server returned status ${healthRes.status}`);
    }
    const healthData = await healthRes.json();
    console.log(`OK (service: ${healthData.service || 'ready'})`);
  } catch (err) {
    console.log('FAILED');
    console.error(`\nError connecting to ${BASE_URL}: ${err.message}`);
    console.error('Please ensure the server is running with `pnpm dev` in another terminal.\n');
    process.exit(1);
  }

  // Step 1: Discover OAuth Protected Resource Metadata
  process.stdout.write('[2/7] Fetching OAuth Protected Resource Metadata... ');
  const resMetaRes = await fetch(`${BASE_URL}/.well-known/oauth-protected-resource`);
  if (!resMetaRes.ok) {
    throw new Error(`Protected resource discovery failed: ${resMetaRes.status}`);
  }
  const resMeta = await resMetaRes.json();
  console.log(`OK (scopes: ${resMeta.scopes_supported?.join(', ')})`);

  // Step 2: Discover Authorization Server Metadata
  process.stdout.write('[3/7] Fetching OAuth Authorization Server Metadata... ');
  const authMetaRes = await fetch(`${BASE_URL}/.well-known/oauth-authorization-server`);
  if (!authMetaRes.ok) {
    throw new Error(`Auth server discovery failed: ${authMetaRes.status}`);
  }
  const authMeta = await authMetaRes.json();
  console.log(`OK (token endpoint: ${authMeta.token_endpoint})`);

  // Step 3: Dynamic Client Registration
  process.stdout.write('[4/7] Registering OAuth client dynamically... ');
  const regRes = await fetch(`${BASE_URL}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Local-Test-Client',
      redirect_uris: ['https://chatgpt.com/connector/oauth/callback'],
    }),
  });
  if (!regRes.ok) {
    throw new Error(`Client registration failed: ${regRes.status}`);
  }
  const clientData = await regRes.json();
  console.log(`OK (client_id: ${clientData.client_id})`);

  // Step 4: Generate PKCE Verifier & Challenge
  process.stdout.write('[5/7] Generating PKCE S256 challenge... ');
  const codeVerifier = crypto.randomBytes(32).toString('hex');
  const codeChallenge = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = 'https://chatgpt.com/connector/oauth/callback';
  console.log(`OK`);
  console.log(`      Code Verifier:  ${codeVerifier.slice(0, 16)}...`);
  console.log(`      Code Challenge: ${codeChallenge}`);

  // Step 5: Authorize and retrieve one-time Authorization Code
  process.stdout.write('[6/7] Authorizing connection & exchanging code for token... ');
  const authRes = await fetch(`${BASE_URL}/oauth/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
    body: new URLSearchParams({
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      apiKey: API_KEY,
    }).toString(),
  });

  const redirectLocation = authRes.headers.get('location');
  if (!redirectLocation) {
    throw new Error(`Expected redirect from /oauth/authorize, got status ${authRes.status}`);
  }
  const redirectUrl = new URL(redirectLocation);
  const code = redirectUrl.searchParams.get('code');
  if (!code) {
    throw new Error(`Redirect did not include authorization code: ${redirectLocation}`);
  }

  // Token Exchange
  const tokenRes = await fetch(`${BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientData.client_id,
      code_verifier: codeVerifier,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${errorBody}`);
  }
  const tokenData = await tokenRes.json();
  console.log(`OK`);
  console.log(`      Token Type:   ${tokenData.token_type}`);
  console.log(
    `      Access Token: ${tokenData.access_token.slice(0, 6)}... (valid for ${tokenData.expires_in}s)`,
  );

  // Step 6: Call MCP Tool with the Bearer Access Token
  process.stdout.write('[7/7] Executing protected MCP tool via Bearer token... ');
  const mcpRes = await fetch(`${BASE_URL}/sse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      Authorization: `Bearer ${tokenData.access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'local-oauth-test',
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: { command: 'echo "MachineBridge OAuth Verified!"' },
      },
    }),
  });

  if (!mcpRes.ok) {
    throw new Error(`MCP tool call failed: ${mcpRes.status}`);
  }
  const mcpBody = await mcpRes.json();
  if (mcpBody.result?.isError) {
    throw new Error(`Tool execution error: ${JSON.stringify(mcpBody.result)}`);
  }

  const outputText = mcpBody.result?.content?.[0]?.text || '';
  console.log(`SUCCESS!`);
  console.log(`\nTool Output:`);
  console.log(`> ${outputText.trim()}`);
  console.log('\n' + '='.repeat(65));
  console.log(' All OAuth 2.1 & MCP Authentication checks passed successfully!');
  console.log('='.repeat(65) + '\n');
}

run().catch((err) => {
  console.error(`\nFAILED with error:`, err);
  process.exit(1);
});
