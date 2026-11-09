// ================================================================
//  lib/db/app-config.js — قراءة/كتابة جدول AppConfig
//  الجدول: key (PK) / value / created_at
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_APPCONFIG } from './tables.js';

// ============================================================
//  📖 قراءة مفاتيح (أو الكل)
//  @param {string[]|null} keys - قائمة مفاتيح، أو null للكل
//  @returns {Promise<{success:boolean, config:Object, error?:string}>}
// ============================================================
export async function getAppConfig(keys = null) {
  try {
    let query = supabaseAdmin
      .from(TABLES.APP_CONFIG)
      .select(`${COLS_APPCONFIG.key},${COLS_APPCONFIG.value}`);

    if (Array.isArray(keys) && keys.length > 0) {
      query = query.in(COLS_APPCONFIG.key, keys);
    }

    const { data, error } = await query;
    if (error) throw error;

    const config = {};
    (data || []).forEach(row => {
      config[row[COLS_APPCONFIG.key]] = row[COLS_APPCONFIG.value];
    });

    return { success: true, config };

  } catch (e) {
    console.error('❌ [AppConfig] getAppConfig:', e.message);
    return { success: false, error: e.message, config: {} };
  }
}

// ============================================================
//  📖 قراءة مفتاح واحد
// ============================================================
export async function getAppConfigValue(key) {
  const result = await getAppConfig([key]);
  return result.success ? (result.config[key] ?? null) : null;
}

// ============================================================
//  ✏️ كتابة/تحديث قيمة مفتاح (Upsert)
//  ⚠️ بنبعت created_at يدويًا كـ fallback لو العمود NOT NULL بدون default
// ============================================================
export async function setAppConfigValue(key, value) {
  try {
    const { error } = await supabaseAdmin
      .from(TABLES.APP_CONFIG)
      .upsert(
        {
          [COLS_APPCONFIG.key]: key,
          [COLS_APPCONFIG.value]: String(value),
          [COLS_APPCONFIG.created_at]: new Date().toISOString()
        },
        { onConflict: COLS_APPCONFIG.key }
      );

    if (error) throw error;
    return { success: true };

  } catch (e) {
    console.error('❌ [AppConfig] setAppConfigValue:', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  ➖ decrement remaining_offers (للاستخدام من registration.js)
// ============================================================
export async function decrementRemainingOffers() {
  try {
    const current = await getAppConfigValue('remaining_offers');
    const num = parseInt(current || '0', 10);
    if (isNaN(num) || num <= 0) return { success: true, remainingOffers: 0 };

    const newVal = Math.max(0, num - 1);
    await setAppConfigValue('remaining_offers', newVal);
    return { success: true, remainingOffers: newVal };

  } catch (e) {
    console.error('❌ [AppConfig] decrement:', e.message);
    return { success: false, error: e.message };
  }
}