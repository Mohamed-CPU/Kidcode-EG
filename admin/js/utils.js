// ================================================================
//  admin/js/utils.js — أدوات مساعدة موحدة للوحة الأدمن
//  - تحويل أي صيغة تاريخ إلى Date (مع افتراض UTC)
//  - عرض التواريخ بتوقيت مصر (Africa/Cairo)
// ================================================================

(function() {
  'use strict';

  // ============================================================
  //  🔄 parseToDate — تحويل أي قيمة إلى Date مع افتراض UTC
  //  السبب: Supabase session timezone = UTC، والقيم تُخزَّن بدون Z
  // ============================================================
  function parseToDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);

    const str = String(value).trim();
    if (!str) return null;

    // 1. ISO كامل (فيه T و Z أو offset)
    if (str.includes('T') && (str.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(str))) {
      return new Date(str);
    }

    // 2. "YYYY-MM-DD HH:MM:SS[.ms]" — نعتبرها UTC
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(str)) {
      return new Date(str.replace(' ', 'T') + 'Z');
    }

    // 3. "YYYY-MM-DD" فقط — بداية اليوم UTC
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return new Date(str + 'T00:00:00Z');
    }

    // 4. Fallback — نجرّب new Date العادي
    return new Date(str);
  }

  // ============================================================
  //  ⏰ formatDateTime — "YYYY-MM-DD HH:mm:ss" بتوقيت مصر (24 ساعة)
  // ============================================================
  function formatDateTime(value) {
    if (!value) return '';
    try {
      const d = parseToDate(value);
      if (!d || isNaN(d.getTime())) return String(value);

      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      }).formatToParts(d);

      const get = function(type) {
        const p = parts.find(function(x) { return x.type === type; });
        return p ? p.value : '';
      };

      let hh = get('hour');
      if (hh === '24') hh = '00';

      return get('year') + '-' + get('month') + '-' + get('day') +
             ' ' + hh + ':' + get('minute') + ':' + get('second');
    } catch (e) {
      return String(value);
    }
  }

  // ============================================================
  //  📅 formatDate — "YYYY-MM-DD" بتوقيت مصر
  // ============================================================
  function formatDate(value) {
    if (!value) return '';
    try {
      const d = parseToDate(value);
      if (!d || isNaN(d.getTime())) return String(value);

      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(d);

      const get = function(type) {
        const p = parts.find(function(x) { return x.type === type; });
        return p ? p.value : '';
      };

      return get('year') + '-' + get('month') + '-' + get('day');
    } catch (e) {
      return String(value);
    }
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.AdminUtils = {
    parseToDate: parseToDate,
    formatDateTime: formatDateTime,
    formatDate: formatDate
  };

})();