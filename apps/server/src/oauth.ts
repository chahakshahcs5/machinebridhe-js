import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export interface AuthCodeData {
  code: string;
  clientId?: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  scope?: string;
  createdAt: number;
}

export class OAuthStore {
  private codes = new Map<string, AuthCodeData>();
  private readonly ttlMs: number;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  createCode(data: Omit<AuthCodeData, 'code' | 'createdAt'>): string {
    this.cleanExpired();
    const code = crypto.randomBytes(24).toString('hex');
    this.codes.set(code, {
      ...data,
      code,
      createdAt: Date.now(),
    });
    return code;
  }

  consumeCode(code: string): AuthCodeData | undefined {
    this.cleanExpired();
    const data = this.codes.get(code);
    if (!data) return undefined;
    this.codes.delete(code);
    return data;
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [code, data] of this.codes.entries()) {
      if (now - data.createdAt > this.ttlMs) {
        this.codes.delete(code);
      }
    }
  }
}

export function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function verifyPkce(verifier: string, challenge: string, method = 'S256'): boolean {
  if (method === 'plain') {
    return verifier === challenge;
  }
  const hash = crypto.createHash('sha256').update(verifier).digest();
  const calculated = base64UrlEncode(hash);
  return calculated === challenge;
}

export function getBaseUrl(request: FastifyRequest): string {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto =
    typeof forwardedProto === 'string'
      ? forwardedProto.split(',')[0].trim()
      : (request.protocol ?? 'http');
  const host =
    (request.headers['x-forwarded-host'] as string) || request.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

export function getProtectedResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/sse`,
    authorization_servers: [baseUrl],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
  };
}

export function getAuthorizationServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    authorization_response_iss_parameter_supported: true,
    scopes_supported: ['mcp', 'openid', 'profile', 'email'],
  };
}

export function renderAuthorizeHtml(params: {
  clientId?: string;
  redirectUri: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  error?: string;
}): string {
  const errorAlert = params.error ? `<div class="error-banner">${params.error}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize MachineBridge MCP</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-heading: #f0f6fc;
      --accent: #238636;
      --accent-hover: #2ea043;
      --danger-bg: #490202;
      --danger-border: #f85149;
      --danger-text: #ff7b72;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    .badge {
      display: inline-block;
      background: #1f6feb22;
      border: 1px solid #1f6feb;
      color: #58a6ff;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.2rem 0.6rem;
      border-radius: 20px;
      margin-bottom: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    h1 {
      color: var(--text-heading);
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    p.desc {
      font-size: 0.9rem;
      line-height: 1.5;
      color: #8b949e;
      margin-bottom: 1.5rem;
    }
    .error-banner {
      background: var(--danger-bg);
      border: 1px solid var(--danger-border);
      color: var(--danger-text);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      font-size: 0.85rem;
      margin-bottom: 1.25rem;
    }
    .scope-box {
      background: #090d13;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      margin-bottom: 1.5rem;
    }
    .scope-box label {
      font-size: 0.75rem;
      color: #8b949e;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
      display: block;
      margin-bottom: 0.25rem;
    }
    .scope-box span {
      color: #58a6ff;
      font-family: monospace;
      font-size: 0.85rem;
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      margin-bottom: 0.5rem;
      color: var(--text-heading);
    }
    input[type="password"], input[type="text"] {
      width: 100%;
      background: #0d1117;
      border: 1px solid var(--border);
      color: var(--text-heading);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="password"]:focus, input[type="text"]:focus {
      border-color: #58a6ff;
      box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.2);
    }
    button {
      width: 100%;
      background: var(--accent);
      color: #fff;
      font-size: 0.95rem;
      font-weight: 600;
      padding: 0.75rem 1rem;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: var(--accent-hover);
    }
    .client-info {
      font-size: 0.8rem;
      color: #8b949e;
      text-align: center;
      margin-top: 1.25rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Model Context Protocol</div>
    <h1>Authorize Connector</h1>
    <p class="desc">An AI client (such as ChatGPT) is requesting access to execute tools on your machine via MachineBridge.</p>
    ${errorAlert}
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(params.clientId || '')}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
      <input type="hidden" name="state" value="${escapeHtml(params.state || '')}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge || '')}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.codeChallengeMethod || '')}">

      <div class="scope-box">
        <label>Requested Permissions</label>
        <span>mcp (Execute local terminal & filesystem tools)</span>
      </div>

      <div class="form-group">
        <label for="apiKey">MachineBridge API Key</label>
        <input type="password" id="apiKey" name="apiKey" placeholder="Enter your MACHINEBRIDGE_API_KEY" required autofocus>
      </div>

      <button type="submit">Authorize Connection</button>
    </form>
    <div class="client-info">Client: ${escapeHtml(params.clientId || 'ChatGPT')}</div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
