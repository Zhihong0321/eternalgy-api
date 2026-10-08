import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { config } from '../src/config/env.js';
import {
  parseName,
  normalizePhone,
  normalizeEmail,
  formatRecordsToCsv,
} from '../src/services/customer-export-service.js';
import * as poolModule from '../src/db/pool.js';

describe('Customer Export Service - Name, Phone & Email Normalization', () => {
  describe('parseName()', () => {
    it('handles Chinese surname first (e.g. Lim Mei Ling -> fn: Mei Ling, ln: Lim)', () => {
      const result = parseName('Lim Mei Ling');
      expect(result).toEqual({ fn: 'Mei Ling', ln: 'Lim' });
    });

    it('handles Chinese 3-word names with uppercase (e.g. TAN WAI KHONG -> fn: Wai Khong, ln: Tan)', () => {
      const result = parseName('TAN WAI KHONG');
      expect(result).toEqual({ fn: 'Wai Khong', ln: 'Tan' });
    });

    it('strips bracket notes like (ATAP), (FACTORY)', () => {
      const result = parseName('OH LI YIN (ATAP)');
      expect(result).toEqual({ fn: 'Li Yin', ln: 'Oh' });
    });

    it('handles English name prefix + Chinese surname (e.g. RICHARD TAI JIA XIAN)', () => {
      const result = parseName('RICHARD TAI JIA XIAN');
      expect(result).toEqual({ fn: 'Richard Jia Xian', ln: 'Tai' });
    });

    it('handles English name + Chinese surname 2 words (e.g. ADELYN NG)', () => {
      const result = parseName('ADELYN NG');
      expect(result).toEqual({ fn: 'Adelyn', ln: 'Ng' });
    });

    it('handles Malay patronymic with BIN / BINTI (e.g. NOOR KHAPIZA BINTI BOHANI)', () => {
      const result = parseName('NOOR KHAPIZA BINTI BOHANI (ATAP)');
      expect(result).toEqual({ fn: 'Noor Khapiza', ln: 'Bohani' });
    });

    it('handles Indian patronymic with A/L or A/P (e.g. SHARMILAH A/P THANGASHA)', () => {
      const result = parseName('SHARMILAH A/P THANGASHA');
      expect(result).toEqual({ fn: 'Sharmilah', ln: 'Thangasha' });
    });

    it('identifies corporate entities and avoids splitting (e.g. AHS GRANITE SDN BHD)', () => {
      const result = parseName('AHS GRANITE SDN BHD (LOT 1197)');
      expect(result).toEqual({ fn: 'Ahs Granite SDN BHD', ln: '' });
    });

    it('cleans aliases with @ symbol (e.g. ANG KAH SEONG @ ONG KAH SEONG)', () => {
      const result = parseName('ANG KAH SEONG @ ONG KAH SEONG');
      expect(result).toEqual({ fn: 'Kah Seong', ln: 'Ang' });
    });
  });

  describe('normalizePhone()', () => {
    it('converts leading 0 into 60... (e.g. 0167654321 -> 60167654321)', () => {
      expect(normalizePhone('0167654321')).toBe('60167654321');
    });

    it('strips punctuation and dashes (e.g. +60 16-776 2726 -> 60167762726)', () => {
      expect(normalizePhone('+60 16-776 2726')).toBe('60167762726');
    });

    it('leaves existing 60... format intact (e.g. 60127056518 -> 60127056518)', () => {
      expect(normalizePhone('60127056518')).toBe('60127056518');
    });

    it('picks Malaysian number when multiple / dual numbers are present', () => {
      expect(normalizePhone('6597775088/0187622951')).toBe('60187622951');
    });

    it('adds 60 if leading 0 was omitted for a 9 or 10-digit mobile number', () => {
      expect(normalizePhone('127516738')).toBe('60127516738');
    });

    it('returns empty string for invalid text without digits', () => {
      expect(normalizePhone('Hannah Sew')).toBe('');
      expect(normalizePhone(null)).toBe('');
    });
  });

  describe('normalizeEmail()', () => {
    it('lowercases and trims email addresses', () => {
      expect(normalizeEmail('  MeiLing@GMAIL.COM  ')).toBe('meiling@gmail.com');
    });

    it('extracts valid email from string with surrounding spaces or notes', () => {
      expect(normalizeEmail('contact: john@example.com (primary)')).toBe('john@example.com');
    });

    it('returns empty string for invalid email', () => {
      expect(normalizeEmail('not_an_email')).toBe('');
      expect(normalizeEmail(null)).toBe('');
    });
  });

  describe('formatRecordsToCsv()', () => {
    it('formats records into strict CSV header and lines', () => {
      const records = [
        {
          phone: '60167654321',
          fn: 'Mei Ling',
          ln: 'Lim',
          email: 'meiling@gmail.com',
          country: 'MY',
        },
      ];

      const csv = formatRecordsToCsv(records);
      expect(csv).toBe(
        'phone,fn,ln,email,country\n60167654321,Mei Ling,Lim,meiling@gmail.com,MY'
      );
    });

    it('escapes fields with commas in CSV', () => {
      const records = [
        {
          phone: '60123456789',
          fn: 'Tan, Junior',
          ln: 'Lee',
          email: 'test@example.com',
          country: 'MY',
        },
      ];

      const csv = formatRecordsToCsv(records);
      expect(csv).toContain('"Tan, Junior",Lee');
    });
  });
});

describe('Customer Export Route Integration (/api/export/paid-customers)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/export/paid-customers',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns JSON summary with total customers found and CSV link when requested', async () => {
    const querySpy = vi.spyOn(poolModule, 'executeQuery').mockResolvedValueOnce({
      rows: [
        {
          customer_id: 'cust_01',
          cust_name: 'Lim Mei Ling',
          cust_phone: '0167654321',
          cust_email: 'meiling@gmail.com',
          resolved_email: 'meiling@gmail.com',
          resolved_phone: '0167654321',
        },
      ],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/export/paid-customers',
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.summary).toBe('total customer with payment found : 1');
    expect(json.total_customers_with_payment).toBe(1);
    expect(json.link).toContain('/api/export/paid-customers/download');
    expect(json.download_url).toBeDefined();

    querySpy.mockRestore();
  });

  it('downloads CSV file directly when format=csv or /download is requested', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/export/paid-customers/download',
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('filename="paid_customers.csv"');
    expect(res.headers['x-export-summary']).toContain('total customer with payment found :');
    expect(res.body).toContain('phone,fn,ln,email,country');
  });

  it('allows CSV download via query parameter authentication (e.g. ?secret=...)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/export/paid-customers/download?secret=${config.ADMIN_API_KEY}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });

  it('checks master copy status via /api/export/paid-customers/status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/export/paid-customers/status',
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty('exists');
    expect(json).toHaveProperty('download_url');
  });

  it('manually refreshes master copy via POST /api/export/paid-customers/refresh', async () => {
    const querySpy = vi.spyOn(poolModule, 'executeQuery').mockResolvedValueOnce({
      rows: [
        {
          customer_id: 'cust_01',
          cust_name: 'Lim Mei Ling',
          cust_phone: '0167654321',
          cust_email: 'meiling@gmail.com',
          resolved_email: 'meiling@gmail.com',
          resolved_phone: '0167654321',
        },
      ],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/export/paid-customers/refresh?mode=full',
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.summary).toBe('total customer with payment found : 1');
    expect(json.total_customers_with_payment).toBe(1);
    expect(json.link).toContain('/api/export/paid-customers/download');

    // Next download should serve from stored Master Copy
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/export/paid-customers/download',
      headers: {
        'x-admin-secret': config.ADMIN_API_KEY,
      },
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers['x-master-copy']).toBe('true');
    expect(getRes.body).toContain('60167654321,Mei Ling,Lim,meiling@gmail.com,MY');

    querySpy.mockRestore();
  });

  it('allows access using Leon account with key=leon2026 and password=leon2026', async () => {
    // 1. With query param ?key=leon2026
    const resKey = await app.inject({
      method: 'GET',
      url: '/api/export/paid-customers?key=leon2026',
    });
    expect(resKey.statusCode).toBe(200);
    const jsonKey = resKey.json();
    expect(jsonKey.success).toBe(true);
    expect(jsonKey.summary).toContain('total customer with payment found :');
    expect(jsonKey.link).toContain('key=leon2026');

    // 2. With query param ?password=leon2026
    const resPass = await app.inject({
      method: 'GET',
      url: '/api/export/paid-customers?password=leon2026',
    });
    expect(resPass.statusCode).toBe(200);
    const jsonPass = resPass.json();
    expect(jsonPass.success).toBe(true);
    expect(jsonPass.summary).toContain('total customer with payment found :');

    // 3. With header x-api-key: leon2026
    const resHeader = await app.inject({
      method: 'GET',
      url: '/api/export/paid-customers',
      headers: {
        'x-api-key': 'leon2026',
      },
    });
    expect(resHeader.statusCode).toBe(200);
    const jsonHeader = resHeader.json();
    expect(jsonHeader.success).toBe(true);
  });
});


