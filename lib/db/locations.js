// ================================================================
//  lib/db/locations.js — تسجيل موقع الطفل (QR Scan)
//  - recordLocation: الدالة الرئيسية
//  - logScan: تسجيل في ScanLogs
//  - reverseGeocode: تحويل lat/lng لعنوان (3-tier fallback)
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from './tables.js';
import { validateOneTimeToken } from './tokens.js';
import { notifyFamily } from '../notify.js';
import { cacheGet, cachePut } from '../cache.js';

// ============================================================
//  🕐 توقيت مصر
// ============================================================
function nowEgypt() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

// ============================================================
//  🔍 isInvalidCoord
// ============================================================
function isInvalidCoord(value) {
  if (value === null || value === undefined || value === '') return true;
  const str = String(value).trim().toUpperCase();
  return ['REFUSED', 'FAILED', 'UNAVAILABLE', 'UNDEFINED', 'NULL', 'NAN', '#NUM!'].includes(str);
}

// ============================================================
//  🌍 reverseGeocode — 3-tier fallback
// ============================================================
export async function reverseGeocode(lat, lng) {
  // تحويل لأرقام
  const latNum = parseFloat(String(lat).replace(/[٫،]/g, '.').replace(/,/g, '.'));
  const lngNum = parseFloat(String(lng).replace(/[٫،]/g, '.').replace(/,/g, '.'));

  if (isNaN(latNum) || isNaN(lngNum)) return 'إحداثيات غير صالحة';

  // ===== 1. Nominatim =====
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latNum}&lon=${lngNum}&accept-language=ar&zoom=16&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'KidCode-EG/3.0 (https://kidcode-eg.com; support@kidcode-eg.com)' }
    });
    const data = await resp.json();
    if (data && data.display_name && !data.display_name.includes('nominatim')) {
      return data.display_name;
    }
  } catch (e) { console.warn('Nominatim:', e.message); }

  // ===== 2. BigDataCloud =====
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latNum}&longitude=${lngNum}&localityLanguage=ar`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data && (data.locality || data.city)) {
      const parts = [data.locality, data.city, data.principalSubdivision, data.countryName].filter(v => v);
      if (parts.length) return parts.join('، ');
    }
  } catch (e) { console.warn('BigDataCloud:', e.message); }

  // ===== 3. Maps.co =====
  try {
    const url = `https://geocode.maps.co/reverse?lat=${latNum}&lon=${lngNum}&format=json&accept-language=ar`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data && data.display_name) return data.display_name;
  } catch (e) { console.warn('Maps.co:', e.message); }

  // ===== 4. Fallback — رابط خرائط =====
  return `https://maps.google.com/?q=${latNum},${lngNum}`;
}

// ============================================================
//  📝 logScan — تسجيل في ScanLogs
// ============================================================
export async function logScan(params) {
  try {
    const { childID, token, lat, lng, source, userAgent, clientIP, address } = params;

    const { error } = await supabaseAdmin
      .from(TABLES.SCAN_LOGS)
      .insert({
        timestamp: nowEgypt(),
        child_id: childID,
        latitude: (lat !== null && lat !== undefined && lat !== '') ? String(lat) : 'REFUSED',
        longitude: (lng !== null && lng !== undefined && lng !== '') ? String(lng) : 'REFUSED',
        location_source: source || 'unknown',
        user_agent: userAgent || 'unknown',
        address: String(address || '').trim(),
        ip: clientIP || 'UNKNOWN'
      });

    if (error) {
      console.error('❌ [logScan]', error.message);
      return { success: false };
    }

    console.log(`📍 [logScan] ${childID} | ${source} | address: ${(address || '').substring(0, 40)}...`);
    return { success: true };

  } catch (e) {
    console.error('❌ [logScan]', e.message);
    return { success: false };
  }
}

// ============================================================
//  🚀 recordLocation — الدالة الرئيسية
// ============================================================
export async function recordLocation(params) {
  try {
    const childID = String(params.childID || '').trim();
    const token = String(params.token || '').trim();
    const lat = params.lat;
    const lng = params.lng;
    const source = String(params.source || 'gps_manual').trim();
    const userAgent = String(params.userAgent || '').trim();
    const clientIP = String(params.clientIP || 'UNKNOWN').trim();
    const demoToken = String(params.demoToken || '').trim();
    const accuracy = params.accuracy || null;

    // 1. تحقق من المدخلات (مع رسائل خطأ دقيقة)
    const missing = [];
    if (!childID) missing.push('childID');
    if (!token) missing.push('token');
    if (lat === undefined || lat === null || lat === '') missing.push('lat');
    if (lng === undefined || lng === null || lng === '') missing.push('lng');

    if (missing.length > 0) {
      console.log(`❌ [recordLocation] missing: ${missing.join(', ')} | body:`, params);
      return { success: false, error: 'missing_data', missing };
    }

    // 2. فحص التوكن (مش للـ demo)
    if (!demoToken) {
      const tokenData = await validateOneTimeToken(token);
      if (!tokenData) {
        console.log(`🚫 [recordLocation] التوكن غير موجود أو منتهي`);
        return { success: false, error: 'invalid_token', reason: 'token_invalid_or_expired' };
      }
      if (tokenData.childID !== childID) {
        console.log(`🚫 [recordLocation] التوكن لطفل تاني (${tokenData.childID} ≠ ${childID})`);
        return { success: false, error: 'invalid_token', reason: 'child_mismatch' };
      }
    }

    const cacheId = demoToken || token;

    // 3. هل نسجّل في ScanLogs؟
    let shouldLog = false;
    let sourceForLog = source;

    // ✅ في الـ Demo: مش بنسجل في ScanLogs
    if (demoToken) {
      shouldLog = false;
    } else if (source === 'periodic_tick') {
      shouldLog = true;
    } else if (source.startsWith('auto_')) {
      const pageOpenKey = 'page_open_logged_' + cacheId;
      if (!cacheGet(pageOpenKey)) {
        shouldLog = true;
        sourceForLog = 'page_open';
        cachePut(pageOpenKey, '1', 600);
      }
    } else if (source.startsWith('gps_') || source.startsWith('manual_')) {
      shouldLog = true;
    }

    // 4. فحص الإحداثيات (نقل من مكانه)
    const latStr = String(lat);
    const lngStr = String(lng);
    const isInvalidCoords = isInvalidCoord(latStr) || isInvalidCoord(lngStr)
                            || isNaN(parseFloat(latStr)) || isNaN(parseFloat(lngStr));

    // 5. منطق الإشعارات (نقل من مكانه — قبل logScan)
    const emailCountKey = 'loc_email_count_' + cacheId;
    const currentEmailCount = parseInt(cacheGet(emailCountKey) || '0', 10);
    const MAX_SESSION_EMAILS = 2;

    let shouldSendNotification = false;

    if (!isInvalidCoords) {
      if (source.startsWith('manual_') || source.startsWith('gps_')) {
        shouldSendNotification = true;
      } else if (currentEmailCount < MAX_SESSION_EMAILS) {
        shouldSendNotification = true;
        cachePut(emailCountKey, String(currentEmailCount + 1), 600);
      } else {
        console.log(`⏳ [recordLocation] تم إرسال ${MAX_SESSION_EMAILS} إشعارات — سكتنا`);
      }
    }

    // 6. ✅ reverseGeocode — مرة واحدة، قبل logScan
    let addressText = '';
    if (!isInvalidCoords && (shouldLog || shouldSendNotification)) {
      try {
        addressText = await reverseGeocode(lat, lng);
        console.log(`🌍 [recordLocation] address: ${addressText.substring(0, 80)}`);
      } catch (e) {
        console.warn('⚠️ [recordLocation] reverseGeocode failed:', e.message);
      }
    }

    // 7. سجّل في ScanLogs (مع address)
    if (shouldLog) {
      await logScan({
        childID, token, lat, lng,
        source: sourceForLog,
        userAgent, clientIP,
        address: addressText
      });
    }

    // 8. لو الإحداثيات غير صالحة → خلاص
    if (isInvalidCoords) {
      console.log(`⏳ [recordLocation] إحداثيات غير صالحة (${lat}, ${lng})`);
      return { success: true };
    }

    // 9. حدّث LAST_LOCATION
    if (!demoToken) {
      try {
        const updates = {
          [COLS_CHILDREN.last_location]: `${lat},${lng}`
        };
        if (shouldSendNotification) {
          updates[COLS_CHILDREN.last_location_email_sent] = nowEgypt();
        }

        const { error: updateError } = await supabaseAdmin
          .from(TABLES.CHILDREN)
          .update(updates)
          .eq(COLS_CHILDREN.child_id, childID);

        if (updateError) {
          console.error(`❌ [recordLocation] LAST_LOCATION update failed:`, updateError.message);
        } else {
          console.log(`✅ [recordLocation] LAST_LOCATION updated: ${lat},${lng}`);
        }
      } catch (updateErr) {
        console.error('❌ [recordLocation] LAST_LOCATION exception:', updateErr.message);
      }
    }

    // 10. أرسل الإشعار
    if (shouldSendNotification) {
      try {
        const locationLink = `https://maps.google.com/?q=${lat},${lng}`;
        // ✅ FIX: نستخدم addressText المحسوب في section 6 (السطر ~200)
        //    كان فيه let addressText = '' هنا (shadowing) + reverseGeocode call مكرر
        //    - توفير reverseGeocode call لكل طلب
        //    - ضمان إن logScan و email يشوفوا نفس العنوان

        // ============================================================
        //  ✅ مسار Demo — إيميل مباشر للمستخدم التجريبي
        // ============================================================
        if (demoToken) {
          const { getDemoSession } = await import('./demo.js');
          const session = await getDemoSession(demoToken);

          if (session && session.email) {
            const { sendLocationEmail } = await import('../email/brevo.js');
            const isFollowup = source === 'periodic_tick';
            const scanTime = nowEgypt();

            await sendLocationEmail(
              session.email,
              childID,
              session.name || 'طفل تجريبي',
              locationLink,
              scanTime,
              addressText,
              clientIP,
              isFollowup
            );

            console.log(`📧 [recordLocation] Demo location email → ${session.email} | followup: ${isFollowup}`);
          } else {
            console.log(`⚠️ [recordLocation] Demo session غير موجود أو منتهي`);
          }
        } else {
          // ============================================================
          //  المسار العادي — notifyFamily
          // ============================================================
          const notifyResult = await notifyFamily({
            childID,
            eventType: 'location',
            eventData: {
              locationLink,
              addressText,
              accuracy,
              clientIP,
              demoToken
            }
          });

          console.log(`📨 [recordLocation] notifyFamily: channel=${notifyResult.channel || '?'}`);
        }

      } catch (notifyErr) {
        console.error('❌ [recordLocation] notify:', notifyErr.message);
      }
    }

    // 11. نجاح
    return { success: true };

  } catch (err) {
    console.error('❌ [recordLocation]', err.message);
    return { success: false, error: err.message };
  }
}