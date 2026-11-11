// ================================================================
//  admin/js/utils.js — أدوات مساعدة موحدة للوحة الأدمن
//  - تحويل أي صيغة تاريخ إلى Date (مع افتراض UTC)
//  - عرض التواريخ بتوقيت مصر (Africa/Cairo) بصيغة عربية
// ================================================================

(function() {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  //  📚 القوائم المرجعية (شهور وأيام بالعربي بدون همزات)
  // ─────────────────────────────────────────────────────────────
  var CAIRO_MONTHS_AR = [
    'يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو',
    'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'
  ];

  var CAIRO_DAYS_AR = [
    'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'
  ];

  // ============================================================
  //  🔄 parseToDate — تحويل أي قيمة إلى Date
  //  بعد Migration: ISO مع Z دايماً → new Date() كافي
  //  نحتفظ بالـ defensive branches للتوافق مع البيانات القديمة
  // ============================================================
  function parseToDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      var dn = new Date(value);
      return isNaN(dn.getTime()) ? null : dn;
    }

    var str = String(value).trim();
    if (!str) return null;

    // 1. ISO كامل (فيه T و Z أو offset) — الحالة الطبيعية بعد Migration
    if (str.includes('T') && (str.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(str))) {
      var d1 = new Date(str);
      return isNaN(d1.getTime()) ? null : d1;
    }

    // 2. "YYYY-MM-DD HH:MM:SS[.ms]" — backward compat (نعتبرها UTC)
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(str)) {
      var d2 = new Date(str.replace(' ', 'T') + 'Z');
      return isNaN(d2.getTime()) ? null : d2;
    }

    // 3. "YYYY-MM-DD" فقط — بداية اليوم UTC
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      var d3 = new Date(str + 'T00:00:00Z');
      return isNaN(d3.getTime()) ? null : d3;
    }

    // 4. Fallback
    var d4 = new Date(str);
    return isNaN(d4.getTime()) ? null : d4;
  }

  // ============================================================
  //  📊 getCairoParts — استخراج أجزاء الوقت بتوقيت القاهرة
  // ============================================================
  function getCairoParts(value) {
    var d = parseToDate(value);
    if (!d) return null;

    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short',
      hour12: false
    }).formatToParts(d);

    var get = function(type) {
      var p = parts.find(function(x) { return x.type === type; });
      return p ? p.value : '';
    };

    var hh = get('hour');
    if (hh === '24') hh = '00';

    var weekdayShort = get('weekday');
    var DOW_MAP = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    var dow = DOW_MAP[weekdayShort];
    if (dow === undefined) dow = 0;

    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: hh,
      minute: get('minute'),
      second: get('second'),
      dayOfWeek: dow
    };
  }

  // ============================================================
  //  ⏰ formatTime12Arabic — الساعة والدقيقة → صيغة 12 ساعة عربية
  //  - 00:00 → "12:00 منتصف الليل"
  //  - 12:00 → "12:00 ظهراً"
  //  - 00:01–11:59 → "HH:MM صباحاً"
  //  - 12:01–23:59 → "HH:MM مساءً"
  // ============================================================
  function formatTime12Arabic(hour24, minute, second) {
    var h = parseInt(hour24, 10);
    var m = String(minute).padStart(2, '0');
    var s = second != null ? ':' + String(second).padStart(2, '0') : '';

    // منتصف الليل (00:00)
    if (h === 0 && m === '00') {
      return '12:00' + s + ' منتصف الليل';
    }
    // ظهراً (12:00)
    if (h === 12 && m === '00') {
      return '12:00' + s + ' ظهراً';
    }

    var hour12;
    var period;

    if (h === 0) { hour12 = 12; period = 'صباحاً'; }
    else if (h < 12) { hour12 = h; period = 'صباحاً'; }
    else if (h === 12) { hour12 = 12; period = 'مساءً'; }
    else { hour12 = h - 12; period = 'مساءً'; }

    var hh = String(hour12).padStart(2, '0');
    return hh + ':' + m + s + ' ' + period;
  }

  // ============================================================
  //  📅 formatDate — الصيغة العربية: "الأربعاء، 11 نوفمبر 2026"
  // ============================================================
  function formatDate(value) {
    if (!value) return '';
    var p = getCairoParts(value);
    if (!p) return String(value);

    var dayName = CAIRO_DAYS_AR[p.dayOfWeek] || 'الأحد';
    var monthName = CAIRO_MONTHS_AR[parseInt(p.month, 10) - 1] || 'يناير';
    var dayNum = parseInt(p.day, 10);

    return dayName + '، ' + dayNum + ' ' + monthName + ' ' + p.year;
  }

  // ============================================================
  //  📅 formatDateTime — الصيغة العربية الكاملة (مع ثواني)
  //  "الأربعاء، 11 نوفمبر 2026 - 02:00:35 مساءً"
  // ============================================================
  function formatDateTime(value) {
    if (!value) return '';
    var p = getCairoParts(value);
    if (!p) return String(value);

    return formatDate(value) + ' - ' + formatTime12Arabic(p.hour, p.minute, p.second);
  }

  // ============================================================
  //  ⏰ formatCairoTime — وقت فقط، بدون ثواني: "02:00 مساءً"
  // ============================================================
  function formatCairoTime(value) {
    if (!value) return '';
    var p = getCairoParts(value);
    if (!p) return String(value);
    return formatTime12Arabic(p.hour, p.minute, null);
  }

  // ============================================================
  //  ⏰ formatCairoTimeLong — وقت مع ثواني: "02:00:35 مساءً"
  // ============================================================
  function formatCairoTimeLong(value) {
    if (!value) return '';
    var p = getCairoParts(value);
    if (!p) return String(value);
    return formatTime12Arabic(p.hour, p.minute, p.second);
  }

  // ============================================================
  //  📊 Backward Compat — الصيغة الرقمية القديمة (24h)
  //  للأماكن اللي محتاجة compact format (بعض tables)
  // ============================================================
  function formatDateTimeNumeric(value) {
    if (!value) return '';
    var p = getCairoParts(value);
    if (!p) return String(value);
    return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second;
  }

  function formatDateNumeric(value) {
    if (!value) return '';
    var p = getCairoParts(value);
    if (!p) return String(value);
    return p.year + '-' + p.month + '-' + p.day;
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.AdminUtils = {
    parseToDate: parseToDate,

    // ← الصيغة العربية الجديدة (default)
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    formatCairoTime: formatCairoTime,
    formatCairoTimeLong: formatCairoTimeLong,

    // ← Backward compat (رقمي 24h)
    formatDateNumeric: formatDateNumeric,
    formatDateTimeNumeric: formatDateTimeNumeric,

    // قوائم مرجعية
    CAIRO_MONTHS_AR: CAIRO_MONTHS_AR,
    CAIRO_DAYS_AR: CAIRO_DAYS_AR
  };

})();