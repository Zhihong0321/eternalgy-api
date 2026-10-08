import { describe, it, expect, beforeAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

describe('Unified AI & Human API Key Documentation (/docs/keys/:keyId)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  it('serves fully pre-rendered Server-Side HTML (SSR) with all schemas and tables present in DOM', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docs/keys/key_weihao?secret=weihao2026',
      headers: {
        accept: 'text/html',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');

    const html = res.body;

    // 1. Checks that hero and profile metadata are pre-rendered into HTML text
    expect(html).toContain('Weihao - Product & Package Manager');
    expect(html).toContain('product_manager');
    expect(html).toContain('120');

    // 2. Checks that tables and columns are directly in the HTML without needing client JS
    expect(html).toContain('Table: <span class="code" style="color: var(--accent);">package</span>');
    expect(html).toContain('Table: <span class="code" style="color: var(--accent);">product</span>');
    expect(html).toContain('bubble_id');
    expect(html).toContain('Primary Key');

    // 3. Checks that 3rd-party proxy services are pre-rendered
    expect(html).toContain('ATAP Solar Calculator (ATS Add-on Price)');
    expect(html).toContain('/v1/settings/ats-addon-price');

    // 4. Checks that AI Agent Directives and System Prompts are pre-rendered in HTML
    expect(html).toContain('🤖 AI Agent Directive');
    expect(html).toContain('mkdir eternalgy-ats-integration && cd eternalgy-ats-integration');
    expect(html).toContain('MEMORY.md');
    expect(html).toContain('x-api-key: weihao2026');

    // 5. Checks discovery links in head
    expect(html).toContain('rel="alternate" type="text/markdown"');
    expect(html).toContain('rel="alternate" type="application/json"');

    // 6. Checks embedded zero-latency JSON spec
    expect(html).toContain('id="initial-spec" type="application/json"');
  });

  it('supports Content Negotiation: returns clean Markdown when Accept: text/markdown is sent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docs/keys/key_weihao?secret=weihao2026',
      headers: {
        accept: 'text/markdown',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');

    const md = res.body;
    expect(md).toContain('# 🤖 AI Coding Agent System Prompt & Schema Specification');
    expect(md).toContain('mkdir eternalgy-ats-integration');
    expect(md).toContain('### Table: `package`');
    expect(md).toContain('### Table: `product`');
    expect(md).toContain('x-api-key: weihao2026');
  });

  it('supports Content Negotiation via query parameter: ?format=md', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docs/keys/key_weihao?secret=weihao2026&format=md',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');

    const md = res.body;
    expect(md).toContain('# 🤖 AI Coding Agent System Prompt & Schema Specification');
    expect(md).toContain('### Table: `package`');
  });

  it('rejects unknown or invalid keys with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docs/keys/non_existent_key_999',
      headers: {
        accept: 'text/html',
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('Authentication Required');
  });

  describe('Key eternalgy2026 - Document Revelation', () => {
    it('reveals HTML document when calling /docs/keys/eternalgy2026', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/keys/eternalgy2026',
        headers: {
          accept: 'text/html',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('You are my video maker');
      expect(res.body).toContain('sk-cp-Mn15gRFLBQz1Rb5roxtNLoet9MDnGLTiET3I2YmebEWr4WOvgQLOei3D48o2HIrm36pcF8aA1shygKt1WMWrNy-ca5Cr1cij4MxOOTHZkRBmfPLKBpXBMuo');
    });

    it('reveals Markdown document when calling /docs/keys/eternalgy2026/llms.txt', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/keys/eternalgy2026/llms.txt',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.body).toContain('You are my video maker');
      expect(res.body).toContain('sk-cp-Mn15gRFLBQz1Rb5roxtNLoet9MDnGLTiET3I2YmebEWr4WOvgQLOei3D48o2HIrm36pcF8aA1shygKt1WMWrNy-ca5Cr1cij4MxOOTHZkRBmfPLKBpXBMuo');
    });

    it('returns document JSON from /api/document with x-api-key: eternalgy2026', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/document',
        headers: {
          'x-api-key': 'eternalgy2026',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.statusCode).toBe(200);
      expect(json.apiKey).toBe('eternalgy2026');
      expect(json.document).toContain('You are my video maker');
      expect(json.document).toContain('sk-cp-Mn15gRFLBQz1Rb5roxtNLoet9MDnGLTiET3I2YmebEWr4WOvgQLOei3D48o2HIrm36pcF8aA1shygKt1WMWrNy-ca5Cr1cij4MxOOTHZkRBmfPLKBpXBMuo');
    });

    it('returns raw markdown from /api/document?key=eternalgy2026&format=md', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/document?key=eternalgy2026&format=md',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.body).toContain('You are my video maker');
    });

    it('rejects /api/document without key with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/document',
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
