// ================================================================
//  lib/admin/recovery.js — الطوارئ
//  - Emergency Secret (env)
//  - Recovery Codes (SHA-256 hash)
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';
import { writeAuditLog } from './audit.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_COUNT = 10;

function nowUTC() { return new Date().toISOString(); }

// RC-XXXX-XXXX-XXXX
function randomCode() {
  const bytes = crypto.randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i++) {
    raw += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return 'RC-' + raw.substring(0, 4) + '-' + raw.substring(4, 8) + '-' + raw.substring(8, 12);
}

// SHA-256 للبحث السريع (الأكواد عالية العشوائية → bcrypt مش ضروري)
function hashCode(code) {
  return crypto.createHash('sha256')
    .update(String(code).toUpperCase().trim())
    .digest('hex');
}

function safeCompare(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) {
    diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return diff === 0;
}

// ================================================================
//  🔐 verifyEmergencySecret
// ================================================================
export function verifyEmergencySecret(input) {
  const expected = String(process.env.EMERGENCY_SECRET || '').trim();
  if (!expected || expected.length < 16) return false;
  return safeCompare(String(input || '').trim(), expected);
}

// ================================================================
//  🆕 generateRecoveryCodes
// ================================================================
export async function generateRecoveryCodes(username, createdBy) {
  const uname = String(username || '').trim();
  if (!uname) return { success: false, error: 'missing_username' };

  const by = String(createdBy || 'system').trim();

  // احذف الأكواد القديمة غير المستخدمة
  try {
    await supabaseAdmin
      .from(TABLES.ADMIN_RECOVERY_CODES)
      .delete()
      .eq('username', uname)
      .eq('used', 'لا');
  } catch (e) {}

  const plain = [];
  const rows = [];

  for (let i = 0; i < RECOVERY_COUNT; i++) {
    const code = randomCode();
    plain.push(code);
    rows.push({
      code_hash: hashCode(code),
      username: uname,
      used: 'لا',
      created_by: by,
      created_at: nowUTC()
    });
  }

  const { error } = await supabaseAdmin
    .from(TABLES.ADMIN_RECOVERY_CODES)
    .insert(rows);

  if (error) return { success: false, error: error.message };

  try {
    await writeAuditLog({
      username: by,
      action: 'recovery_codes_generated',
      target_table: TABLES.ADMINS,
      target_id: uname,
      changes: { count: RECOVERY_COUNT }
    });
  } catch (e) {}

  return { success: true, codes: plain, count: RECOVERY_COUNT };
}

// ================================================================
//  🔍 consumeRecoveryCode
// ================================================================
export async function consumeRecoveryCode(code, ipAddress) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return { success: false, error: 'missing_code' };

  const hash = hashCode(c);

  let row = null;
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.ADMIN_RECOVERY_CODES)
      .select('id,username,used')
      .eq('code_hash', hash)
      .maybeSingle();

    if (error) return { success: false, error: 'db_error' };
    row = data;
  } catch (e) {
    return { success: false, error: 'db_exception' };
  }

  if (!row) return { success: false, error: 'invalid_code' };
  if (String(row.used || '').trim() === 'نعم') {
    return { success: false, error: 'used_code' };
  }

  try {
    const { data: updated, error: updErr } = await supabaseAdmin
      .from(TABLES.ADMIN_RECOVERY_CODES)
      .update({
        used: 'نعم',
        used_at: nowUTC(),
        used_ip: String(ipAddress || '').substring(0, 60) || null
      })
      .eq('id', row.id)
      .eq('used', 'لا')
      .select('username');

    if (updErr) return { success: false, error: 'consume_failed' };
    if (!updated || updated.length === 0) {
      return { success: false, error: 'race_lost' };
    }
  } catch (e) {
    return { success: false, error: 'consume_exception' };
  }

  try {
    await writeAuditLog({
      username: row.username,
      action: 'recovery_code_consumed',
      target_table: TABLES.ADMINS,
      target_id: row.username,
      ip_address: ipAddress
    });
  } catch (e) {}

  return { success: true, username: row.username };
}

// ================================================================
//  🔢 countUnusedCodes
// ================================================================
export async function countUnusedCodes(username) {
  const uname = String(username || '').trim();
  if (!uname) return 0;

  try {
    const { count } = await supabaseAdmin
      .from(TABLES.ADMIN_RECOVERY_CODES)
      .select('id', { count: 'exact', head: true })
      .eq('username', uname)
      .eq('used', 'لا');
    return count || 0;
  } catch (e) {
    return 0;
  }
}