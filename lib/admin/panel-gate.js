// ================================================================
//  lib/admin/panel-gate.js — بوابة لوحة الأدمن (فتح/قفل)
//  - تخزين الحالة في AppConfig
//  - Cache في الذاكرة لمدة 30 ثانية
//  - Fail-Close افتراضي (مقفولة)
//  - Audit Log لكل تغيير
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';
import { writeAuditLog } from './audit.js';
import { getClientIP } from './auth.js';
// ✅ استخدام الدالة الجاهزة من app-config.js (بتبعت created_at صح)
import { setAppConfigValue } from '../db/app-config.js';

// ================================================================
//  🔧 الثوابت
// ================================================================
const PANEL_KEY = 'admin_panel_enabled';   // 'نعم' | 'لا'
const BY_KEY    = 'admin_panel_enabled_by'; // username اللي غيّر الحالة
const AT_KEY    = 'admin_panel_enabled_at'; // وقت التغيير (توقيت مصر)
const CACHE_TTL_MS = 30 * 1000;             // 30 ثانية

// ================================================================
//  🗃️ Cache في الذاكرة
//  ملاحظة: يعيش داخل نسخة الدالة الواحدة (Warm Instance)
//  عند Cold Start → يُعاد بناؤه من الصفر
// ================================================================
let _cache = {
  value: null,       // true | false | null
  timestamp: 0
};

// ================================================================
//  🕐 nowEgyptString — توقيت مصر كنص
// ================================================================
function nowEgyptString() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

// ================================================================
//  📖 readConfigValue — قراءة قيمة من AppConfig
//  يُرجِع null لو غير موجودة أو حصل خطأ
// ================================================================
async function readConfigValue(key) {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.APP_CONFIG)
      .select('value')
      .eq('key', key)
      .maybeSingle();

    if (error) return null;
    if (!data) return null;
    return String(data.value || '').trim();
  } catch (e) {
    return null;
  }
}

// ================================================================
//  ✏️ writeConfigValue — كتابة قيمة في AppConfig (upsert)
//  يُرجِع true لو نجح
// ================================================================
// ✅ نستخدم setAppConfigValue من app-config.js — بتبعت created_at صح
async function writeConfigValue(key, value) {
  try {
    const result = await setAppConfigValue(key, value);
    if (!result || !result.success) {
      console.error('[writeConfigValue] FAILED:', {
        key: key,
        value: String(value).substring(0, 50),
        error: result ? result.error : 'unknown'
      });
      return false;
    }
    return true;
  } catch (e) {
    console.error('[writeConfigValue] EXCEPTION:', e.message);
    return false;
  }
}

// ================================================================
//  🚦 isPanelOpen — هل البوابة مفتوحة؟ (مع Cache 30 ثانية)
//  - Fail-Close: أي حالة غير 'نعم' تُعتبر مقفولة
// ================================================================
export async function isPanelOpen() {
  const now = Date.now();

  // 1. فحص الكاش
  if (_cache.value !== null && (now - _cache.timestamp) < CACHE_TTL_MS) {
    return _cache.value;
  }

  // 2. قراءة من DB
  const raw = await readConfigValue(PANEL_KEY);
  const isOpen = (raw === 'نعم');

  // 3. تحديث الكاش
  _cache.value = isOpen;
  _cache.timestamp = now;

  return isOpen;
}

// ================================================================
//  🔄 invalidatePanelCache — إبطال الكاش فورًا
//  يُستدعى بعد أي فتح/قفل عشان القيمة الجديدة تظهر فورًا
// ================================================================
export function invalidatePanelCache() {
  _cache.value = null;
  _cache.timestamp = 0;
}

// ================================================================
//  📊 getPanelStatus — حالة البوابة الكاملة (مع من ومتى)
// ================================================================
export async function getPanelStatus() {
  const [enabledRaw, byRaw, atRaw] = await Promise.all([
    readConfigValue(PANEL_KEY),
    readConfigValue(BY_KEY),
    readConfigValue(AT_KEY)
  ]);

  const isOpen = (enabledRaw === 'نعم');

  return {
    success: true,
    isOpen: isOpen,
    state: isOpen ? 'open' : 'closed',
    updatedBy: byRaw || null,
    updatedAt: atRaw || null
  };
}

// ================================================================
//  🔓 openPanel — فتح البوابة
// ================================================================
export async function openPanel(username, req) {
  const by = String(username || 'system').trim();
  const at = nowEgyptString();

  // كتابة الثلاثة صفوف بالتوازي
  // ✅ تسلسل بدل توازي — لتفادي تعارض الاتصالات في Supabase
  const ok1 = await writeConfigValue(PANEL_KEY, 'نعم');
  const ok2 = await writeConfigValue(BY_KEY, by);
  const ok3 = await writeConfigValue(AT_KEY, at);

  if (!ok1 || !ok2 || !ok3) {
    return {
      success: false,
      error: 'db_write_failed',
      message: 'تعذر فتح اللوحة',
      debug: { panel: ok1, by: ok2, at: ok3 }
    };
  }

  // إبطال الكاش فورًا
  invalidatePanelCache();

  // Audit Log (best-effort)
  try {
    await writeAuditLog({
      username: by,
      action: 'panel_opened',
      ip_address: getClientIP(req),
      user_agent: String((req && req.headers && req.headers['user-agent']) || '').substring(0, 300)
    });
  } catch (e) {}

  return {
    success: true,
    message: 'تم فتح اللوحة',
    updatedBy: by,
    updatedAt: at
  };
}

// ================================================================
//  🔒 closePanel — قفل البوابة
// ================================================================
export async function closePanel(username, req) {
  const by = String(username || 'system').trim();
  const at = nowEgyptString();

  const ok1 = await writeConfigValue(PANEL_KEY, 'لا');
  const ok2 = await writeConfigValue(BY_KEY, by);
  const ok3 = await writeConfigValue(AT_KEY, at);

  if (!ok1 || !ok2 || !ok3) {
    return {
      success: false,
      error: 'db_write_failed',
      message: 'تعذر قفل اللوحة',
      debug: { panel: ok1, by: ok2, at: ok3 }
    };
  }

  invalidatePanelCache();

  try {
    await writeAuditLog({
      username: by,
      action: 'panel_closed',
      ip_address: getClientIP(req),
      user_agent: String((req && req.headers && req.headers['user-agent']) || '').substring(0, 300)
    });
  } catch (e) {}

  return {
    success: true,
    message: 'تم قفل اللوحة',
    updatedBy: by,
    updatedAt: at
  };
}