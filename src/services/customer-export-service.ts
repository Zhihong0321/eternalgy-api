import fs from 'node:fs';
import path from 'node:path';
import { executeQuery } from '../db/pool.js';

export interface PaidCustomerExportOptions {
  deduplicate?: boolean;
  minPaidAmount?: number;
  requirePhone?: boolean;
  requireEmail?: boolean;
  since?: string | Date;
  sinceDays?: number;
  dateType?: 'updated' | 'payment' | 'created';
  limit?: number;
}

export interface PaidCustomerExportResult {
  records: PaidCustomerRecord[];
  exportTimestamp: string;
  count: number;
  latestPaymentDate: string | null;
}

export interface PaidCustomerRecord {
  phone: string;
  fn: string;
  ln: string;
  email: string;
  country: string;
}

// Comprehensive registry of Chinese surnames in Malaysia (Hokkien, Cantonese, Hakka, Teochew, Foochow, Hainanese, Mandarin)
export const CHINESE_SURNAMES = new Set([
  'ANG', 'AU', 'AW', 'BOEY', 'BONG', 'CHAI', 'CHAN', 'CHANG', 'CHAT', 'CHAU', 'CHE', 'CHEAH', 'CHEANG',
  'CHEE', 'CHEN', 'CHENG', 'CHEONG', 'CHEW', 'CHIA', 'CHIANG', 'CHIEW', 'CHIENG', 'CHIN', 'CHING',
  'CHIO', 'CHIOU', 'CHIU', 'CHO', 'CHOK', 'CHONG', 'CHOI', 'CHOO', 'CHOONG', 'CHOW', 'CHU', 'CHUA',
  'CHUAH', 'CHUNG', 'EE', 'ENG', 'EWE', 'FOH', 'FOK', 'FONG', 'FOO', 'FOONG', 'FU', 'FUNG',
  'GAN', 'GOH', 'GUAN', 'HA', 'HANG', 'HEE', 'HENG', 'HEW', 'HII', 'HO', 'HOE', 'HOM',
  'HON', 'HONG', 'HOO', 'HOOI', 'HOON', 'HOR', 'HOW', 'HSIA', 'HU', 'HUA', 'HUANG', 'HUI',
  'HWA', 'HWANG', 'HWI', 'JIA', 'KANG', 'KE', 'KEE', 'KHEW', 'KHO', 'KHOO', 'KHONG', 'KHOR',
  'KIANG', 'KIEW', 'KIM', 'KO', 'KOH', 'KOK', 'KONG', 'KOO', 'KOAY', 'KUA', 'KUAN', 'KUEK',
  'KUNG', 'KWAN', 'KWOK', 'KWONG', 'LAI', 'LAM', 'LAN', 'LAU', 'LAW', 'LEE', 'LEK', 'LEONG',
  'LEOW', 'LEW', 'LI', 'LIAN', 'LIANG', 'LIAO', 'LIAW', 'LIEW', 'LIM', 'LIN', 'LING', 'LIONG',
  'LIOW', 'LIP', 'LIU', 'LO', 'LOH', 'LOKE', 'LONG', 'LOO', 'LOOK', 'LOW', 'LUA', 'LUM',
  'LUO', 'MA', 'MAH', 'MAK', 'MAN', 'MO', 'MOK', 'MOO', 'MOOI', 'MOON', 'MUN', 'NEO',
  'NEW', 'NG', 'NGA', 'NGAI', 'NGE', 'NGEOW', 'NGI', 'NGIAM', 'NGOH', 'NGU', 'OH', 'ONG',
  'OOI', 'OU', 'OW', 'OWYANG', 'PAN', 'PANG', 'PAU', 'PEH', 'PEK', 'PENG', 'PHAN', 'PHANG',
  'PHUA', 'PI', 'POH', 'POK', 'POON', 'PUN', 'QUAH', 'QUEK', 'SAM', 'SAN', 'SAW', 'SEE',
  'SEET', 'SEETOH', 'SEH', 'SEO', 'SEOK', 'SEOW', 'SHE', 'SHEN', 'SHI', 'SHIA', 'SHIAU', 'SHIH',
  'SHIM', 'SHING', 'SHIU', 'SHUM', 'SI', 'SIA', 'SIAH', 'SIAM', 'SIEW', 'SIM', 'SING', 'SIO',
  'SIOH', 'SIONG', 'SIOW', 'SIT', 'SITU', 'SIU', 'SOH', 'SONG', 'SOO', 'SOON', 'SU', 'SUE',
  'SUH', 'SUI', 'SUM', 'SUN', 'SUNG', 'SZETO', 'TAI', 'TAM', 'TAN', 'TANG', 'TAO', 'TAT',
  'TAY', 'TEE', 'TEH', 'TEO', 'TEOH', 'TEOW', 'TEW', 'TI', 'TIAN', 'TING', 'TIONG', 'TOH',
  'TONG', 'TSAI', 'TSAO', 'TSE', 'TSEN', 'TSENG', 'TSIANG', 'TSOI', 'TSOU', 'TSU', 'TU', 'TUAN',
  'TUNG', 'VOON', 'VOO', 'WAH', 'WAI', 'WAN', 'WANG', 'WEE', 'WEN', 'WENG', 'WIE', 'WOH',
  'WON', 'WONG', 'WOO', 'WOON', 'WU', 'XIA', 'XIAO', 'XIE', 'XING', 'XU', 'XUE', 'YAM',
  'YAN', 'YANG', 'YAP', 'YAU', 'YE', 'YEE', 'YEH', 'YEN', 'YEO', 'YEOH', 'YEOP', 'YEOW',
  'YEP', 'YEU', 'YEUNG', 'YIE', 'YIK', 'YIM', 'YIN', 'YING', 'YIP', 'YIU', 'YONG', 'YOO',
  'YOON', 'YOU', 'YOW', 'YU', 'YUE', 'YUEN', 'YUNG'
]);

export function toTitleCase(str: string): string {
  if (!str) return '';
  return str
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      // Retain abbreviations like SDN, BHD, PLT
      const upper = w.toUpperCase();
      if (['SDN', 'BHD', 'SDN.', 'BHD.', 'PLT', 'CO.', 'CO', 'LLC', 'INC'].includes(upper)) {
        return upper;
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Split Malaysian customer names into fn (First/Given name) and ln (Last name/Surname)
 */
export function parseName(rawName?: string | null): { fn: string; ln: string } {
  if (!rawName) return { fn: '', ln: '' };

  // 1. Clean bracketed notes like (ATAP), (FACTORY), (CANCEL ...), etc.
  let cleaned = rawName.replace(/\(.*?\)/g, ' ').trim();

  // 2. Handle aliases like @ or a/k/a - pick primary identity before alias
  if (cleaned.includes('@')) {
    cleaned = cleaned.split('@')[0].trim();
  }

  // 3. Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (!cleaned) return { fn: '', ln: '' };

  const upper = cleaned.toUpperCase();

  // 4. Check if corporate / commercial entity
  const companyKeywords = [
    'SDN BHD', 'SDN. BHD.', 'BHD', 'ENTERPRISE', 'TRADING', 'SERVICES',
    'PLT', 'CORP', 'CO.', 'ENGINEERING', 'HOLDINGS', 'LOGISTICS',
    'VENTURES', 'HARDWARE', 'ALIGNMENT', 'AUTO', 'MOTOR', 'WORKSHOP',
    'INDUSTRIES', 'RESOURCES', 'STATION', 'CLINIC', 'PHARMACY'
  ];

  if (companyKeywords.some((kw) => upper.includes(kw))) {
    return { fn: toTitleCase(cleaned), ln: '' };
  }

  // 5. Malay patronymic: BIN / BINTI / BT / BTE
  const malayMatch = cleaned.match(/^(.*?)\s+(?:BIN|BINTI|BT\.?|BTE\.?)\s+(.*?)$/i);
  if (malayMatch) {
    return {
      fn: toTitleCase(malayMatch[1].trim()),
      ln: toTitleCase(malayMatch[2].trim()),
    };
  }

  // 6. Indian patronymic: A/L / A/P / S/O / D/O
  const indianMatch = cleaned.match(/^(.*?)\s+(?:A\/L|A\/P|S\/O|D\/O)\s+(.*?)$/i);
  if (indianMatch) {
    return {
      fn: toTitleCase(indianMatch[1].trim()),
      ln: toTitleCase(indianMatch[2].trim()),
    };
  }

  const parts = cleaned.split(' ');
  if (parts.length === 1) {
    return { fn: toTitleCase(parts[0]), ln: '' };
  }

  const firstUpper = parts[0].toUpperCase();
  const secondUpper = parts[1].toUpperCase();

  // 7. English name + Chinese surname (+ Chinese given name), e.g. "Richard Tai Jia Xian" or "Adelyn Ng"
  if (!CHINESE_SURNAMES.has(firstUpper) && CHINESE_SURNAMES.has(secondUpper)) {
    const ln = toTitleCase(parts[1]);
    const fnParts = [parts[0], ...parts.slice(2)];
    return { fn: toTitleCase(fnParts.join(' ')), ln };
  }

  // 8. Chinese surname first, e.g. "Lim Mei Ling" -> fn: "Mei Ling", ln: "Lim"
  if (CHINESE_SURNAMES.has(firstUpper)) {
    const ln = toTitleCase(parts[0]);
    const fn = toTitleCase(parts.slice(1).join(' '));
    return { fn, ln };
  }

  // 9. Default fallback (e.g. Western order / Malay non-patronymic): given names + last word as surname
  return {
    fn: toTitleCase(parts.slice(0, -1).join(' ')),
    ln: toTitleCase(parts[parts.length - 1]),
  };
}

/**
 * Standardize phone number into Malaysia format (60...)
 * If starts with 0 -> prepend 6 (e.g. 012... -> 6012...)
 * If missing leading 0 -> prepend 60 (e.g. 12... -> 6012...)
 */
export function normalizePhone(rawPhone?: string | null): string {
  if (!rawPhone) return '';

  // Handle dual or slash-separated numbers (e.g. '6597775088/0187622951')
  const candidates = rawPhone.split(/[\/,;,|]/).map((s) => s.trim()).filter(Boolean);

  // Prefer candidate that begins with 0, +60, or 60
  let chosen = candidates[0] || '';
  for (const cand of candidates) {
    const clean = cand.replace(/[^0-9+]/g, '');
    if (clean.startsWith('0') || clean.startsWith('+60') || clean.startsWith('60')) {
      chosen = cand;
      break;
    }
  }

  let digits = chosen.replace(/[^0-9]/g, '');
  if (!digits || digits.length < 7) {
    for (const cand of candidates) {
      const d = cand.replace(/[^0-9]/g, '');
      if (d.length >= 7) {
        digits = d;
        break;
      }
    }
  }

  if (!digits || digits.length < 7) return '';

  if (digits.startsWith('0')) {
    return '6' + digits;
  }
  if (digits.startsWith('60')) {
    return digits;
  }
  if ((digits.length === 9 || digits.length === 10) && digits.startsWith('1')) {
    return '60' + digits;
  }

  return digits;
}

/**
 * Extract and lowercase a clean email address
 */
export function normalizeEmail(rawEmail?: string | null): string {
  if (!rawEmail) return '';
  const trimmed = rawEmail.trim().toLowerCase();
  const match = trimmed.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0] : '';
}

/**
 * Escape CSV field according to RFC 4180
 */
export function escapeCsvField(val: string | number | null | undefined): string {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Fetch and process paid customer records
 */
export async function fetchPaidCustomerRecords(
  options: PaidCustomerExportOptions = {}
): Promise<PaidCustomerRecord[]> {
  const {
    deduplicate = true,
    minPaidAmount = 0,
    requirePhone = false,
    requireEmail = false,
    since,
    sinceDays,
    dateType = 'updated',
    limit,
  } = options;

  let sinceDate: Date | null = null;
  if (since) {
    const parsed = new Date(since);
    if (!isNaN(parsed.getTime())) {
      sinceDate = parsed;
    }
  } else if (typeof sinceDays === 'number' && sinceDays > 0) {
    sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  }

  const params: any[] = [minPaidAmount];
  let dateClause = '';
  if (sinceDate) {
    params.push(sinceDate.toISOString());
    const paramIdx = params.length;
    if (dateType === 'payment') {
      dateClause = ` AND (i.last_payment_date >= $${paramIdx} OR i."1st_payment_date" >= $${paramIdx})`;
    } else if (dateType === 'created') {
      dateClause = ` AND i.created_at >= $${paramIdx}`;
    } else {
      dateClause = ` AND (i.updated_at >= $${paramIdx} OR i.last_payment_date >= $${paramIdx} OR i."1st_payment_date" >= $${paramIdx})`;
    }
  }

  let sql: string;

  if (deduplicate) {
    sql = `
      WITH paid_customers AS (
        SELECT 
          c.customer_id, 
          c.name as cust_name, 
          c.phone as cust_phone, 
          c.email as cust_email, 
          c.linked_seda_registration as cust_seda
        FROM invoice i
        JOIN customer c ON i.linked_customer = c.customer_id
        WHERE i.paid_amount > $1${dateClause}
        GROUP BY c.customer_id, c.name, c.phone, c.email, c.linked_seda_registration
      ),
      seda_candidates AS (
        SELECT DISTINCT ON (customer_id)
          customer_id,
          email,
          applicant_email,
          applicant_phone,
          e_contact_no
        FROM (
          SELECT 
            s.linked_customer as customer_id,
            s.email,
            s.applicant_email,
            s.applicant_phone,
            s.e_contact_no,
            s.updated_at
          FROM seda_registration s
          WHERE s.linked_customer IN (SELECT customer_id FROM paid_customers)
          UNION ALL
          SELECT 
            pc.customer_id,
            s.email,
            s.applicant_email,
            s.applicant_phone,
            s.e_contact_no,
            s.updated_at
          FROM paid_customers pc
          JOIN seda_registration s ON s.bubble_id = pc.cust_seda
        ) u
        ORDER BY customer_id, (CASE WHEN email IS NOT NULL AND TRIM(email) <> '' THEN 1 ELSE 2 END), updated_at DESC NULLS LAST
      )
      SELECT 
        pc.customer_id,
        pc.cust_name,
        pc.cust_phone,
        pc.cust_email,
        COALESCE(
          NULLIF(TRIM(pc.cust_email), ''),
          NULLIF(TRIM(sc.email), ''),
          NULLIF(TRIM(sc.applicant_email), '')
        ) as resolved_email,
        COALESCE(
          NULLIF(TRIM(pc.cust_phone), ''),
          NULLIF(TRIM(sc.applicant_phone), ''),
          NULLIF(TRIM(sc.e_contact_no), '')
        ) as resolved_phone
      FROM paid_customers pc
      LEFT JOIN seda_candidates sc ON pc.customer_id = sc.customer_id
      ORDER BY pc.cust_name ASC NULLS LAST
    `;
  } else {
    sql = `
      SELECT 
        i.id as invoice_id,
        c.customer_id,
        c.name as cust_name,
        c.phone as cust_phone,
        c.email as cust_email,
        COALESCE(
          NULLIF(TRIM(c.email), ''),
          NULLIF(TRIM(s_inv.email), ''),
          NULLIF(TRIM(s_inv.applicant_email), ''),
          NULLIF(TRIM(s_cust.email), ''),
          NULLIF(TRIM(s_cust.applicant_email), '')
        ) as resolved_email,
        COALESCE(
          NULLIF(TRIM(c.phone), ''),
          NULLIF(TRIM(s_inv.applicant_phone), ''),
          NULLIF(TRIM(s_inv.e_contact_no), ''),
          NULLIF(TRIM(s_cust.applicant_phone), ''),
          NULLIF(TRIM(s_cust.e_contact_no), '')
        ) as resolved_phone
      FROM invoice i
      JOIN customer c ON i.linked_customer = c.customer_id
      LEFT JOIN seda_registration s_inv ON i.linked_seda_registration = s_inv.bubble_id
      LEFT JOIN seda_registration s_cust ON c.linked_seda_registration = s_cust.bubble_id
      WHERE i.paid_amount > $1${dateClause}
      ORDER BY i.id ASC
    `;
  }

  if (limit && limit > 0) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }

  const result = await executeQuery(sql, params);

  const records: PaidCustomerRecord[] = [];
  for (const row of result.rows) {
    const { fn, ln } = parseName(row.cust_name);
    const phone = normalizePhone(row.resolved_phone || row.cust_phone);
    const email = normalizeEmail(row.resolved_email || row.cust_email);
    const country = 'MY';

    if (requirePhone && !phone) continue;
    if (requireEmail && !email) continue;

    records.push({
      phone,
      fn,
      ln,
      email,
      country,
    });
  }

  return records;
}

/**
 * Generate strict CSV string:
 * phone,fn,ln,email,country
 */
export function formatRecordsToCsv(records: PaidCustomerRecord[]): string {
  const header = 'phone,fn,ln,email,country';
  const lines = [header];

  for (const rec of records) {
    const line = [
      escapeCsvField(rec.phone),
      escapeCsvField(rec.fn),
      escapeCsvField(rec.ln),
      escapeCsvField(rec.email),
      escapeCsvField(rec.country),
    ].join(',');
    lines.push(line);
  }

  return lines.join('\n');
}

export interface MasterCopyMetadata {
  lastUpdated: string;
  recordCount: number;
  fileSizeBytes: number;
  fileSizeKb: number;
  fileName: string;
}

export interface MasterCopyStatus {
  exists: boolean;
  metadata: MasterCopyMetadata | null;
}

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'exports');
const MASTER_CSV_PATH = path.join(STORAGE_DIR, 'paid_customers_master.csv');
const MASTER_META_PATH = path.join(STORAGE_DIR, 'paid_customers_metadata.json');

function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/**
 * Check whether the master copy CSV exists and get its metadata
 */
export function getMasterCopyStatus(): MasterCopyStatus {
  ensureStorageDir();
  if (!fs.existsSync(MASTER_CSV_PATH)) {
    return { exists: false, metadata: null };
  }

  try {
    if (fs.existsSync(MASTER_META_PATH)) {
      const meta = JSON.parse(fs.readFileSync(MASTER_META_PATH, 'utf-8'));
      return { exists: true, metadata: meta };
    }

    const stat = fs.statSync(MASTER_CSV_PATH);
    const content = fs.readFileSync(MASTER_CSV_PATH, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const count = Math.max(0, lines.length - 1);

    const meta: MasterCopyMetadata = {
      lastUpdated: stat.mtime.toISOString(),
      recordCount: count,
      fileSizeBytes: stat.size,
      fileSizeKb: Math.round((stat.size / 1024) * 100) / 100,
      fileName: 'paid_customers_master.csv',
    };
    return { exists: true, metadata: meta };
  } catch (err) {
    return { exists: false, metadata: null };
  }
}

/**
 * Read the stored master copy CSV directly from disk
 */
export function readMasterCopy(): { content: string; metadata: MasterCopyMetadata } | null {
  const status = getMasterCopyStatus();
  if (!status.exists || !status.metadata) {
    return null;
  }

  try {
    const content = fs.readFileSync(MASTER_CSV_PATH, 'utf-8');
    return { content, metadata: status.metadata };
  } catch (err) {
    return null;
  }
}

/**
 * Save records as the master copy on disk
 */
export function saveMasterCopy(records: PaidCustomerRecord[]): MasterCopyMetadata {
  ensureStorageDir();
  const csvContent = formatRecordsToCsv(records);
  fs.writeFileSync(MASTER_CSV_PATH, csvContent, 'utf-8');

  const stat = fs.statSync(MASTER_CSV_PATH);
  const metadata: MasterCopyMetadata = {
    lastUpdated: new Date().toISOString(),
    recordCount: records.length,
    fileSizeBytes: stat.size,
    fileSizeKb: Math.round((stat.size / 1024) * 100) / 100,
    fileName: 'paid_customers_master.csv',
  };

  fs.writeFileSync(MASTER_META_PATH, JSON.stringify(metadata, null, 2), 'utf-8');
  return metadata;
}

/**
 * Refresh the master copy:
 * - mode: 'full' (default) -> Re-queries all paid customers from DB and rewrites master copy.
 * - mode: 'incremental' -> Queries customers updated/paid since lastUpdated, merges with existing master copy.
 */
export async function refreshMasterCopy(
  options: { mode?: 'full' | 'incremental' } = {}
): Promise<{ metadata: MasterCopyMetadata; addedCount: number; refreshedAt: string }> {
  const { mode = 'full' } = options;
  const status = getMasterCopyStatus();

  if (mode === 'incremental' && status.exists && status.metadata) {
    const newRecords = await fetchPaidCustomerRecords({
      since: status.metadata.lastUpdated,
      deduplicate: true,
    });

    if (newRecords.length === 0) {
      return {
        metadata: status.metadata,
        addedCount: 0,
        refreshedAt: new Date().toISOString(),
      };
    }

    // Read existing file and parse existing phones / emails to prevent duplicates
    const current = fs.readFileSync(MASTER_CSV_PATH, 'utf-8');
    const existingLines = current.trim().split('\n');
    const existingKeys = new Set<string>();

    for (let i = 1; i < existingLines.length; i++) {
      const parts = existingLines[i].split(',');
      const phone = parts[0]?.trim();
      const email = parts[3]?.trim();
      if (phone) existingKeys.add(phone);
      if (email) existingKeys.add(email);
    }

    const trulyNew: PaidCustomerRecord[] = [];
    const appendLines: string[] = [];

    for (const rec of newRecords) {
      const keyPhone = rec.phone.trim();
      const keyEmail = rec.email.trim();
      const isDuplicate = (keyPhone && existingKeys.has(keyPhone)) || (keyEmail && existingKeys.has(keyEmail));
      if (!isDuplicate) {
        trulyNew.push(rec);
        if (keyPhone) existingKeys.add(keyPhone);
        if (keyEmail) existingKeys.add(keyEmail);
        appendLines.push([
          escapeCsvField(rec.phone),
          escapeCsvField(rec.fn),
          escapeCsvField(rec.ln),
          escapeCsvField(rec.email),
          escapeCsvField(rec.country),
        ].join(','));
      }
    }

    if (appendLines.length > 0) {
      fs.appendFileSync(MASTER_CSV_PATH, '\n' + appendLines.join('\n'), 'utf-8');
    }

    const stat = fs.statSync(MASTER_CSV_PATH);
    const newCount = status.metadata.recordCount + trulyNew.length;
    const metadata: MasterCopyMetadata = {
      lastUpdated: new Date().toISOString(),
      recordCount: newCount,
      fileSizeBytes: stat.size,
      fileSizeKb: Math.round((stat.size / 1024) * 100) / 100,
      fileName: 'paid_customers_master.csv',
    };
    fs.writeFileSync(MASTER_META_PATH, JSON.stringify(metadata, null, 2), 'utf-8');

    return {
      metadata,
      addedCount: trulyNew.length,
      refreshedAt: metadata.lastUpdated,
    };
  }

  // Full refresh
  const allRecords = await fetchPaidCustomerRecords({ deduplicate: true });
  const metadata = saveMasterCopy(allRecords);

  return {
    metadata,
    addedCount: allRecords.length,
    refreshedAt: metadata.lastUpdated,
  };
}
