// ================================================================
//  js/error-reporter.js — إرسال أخطاء الواجهة الأمامية إلى الخادم
//  - معالجان عالميان: window.onerror + unhandledrejection
//  - إسكات console.error / console.warn في الإنتاج
//  - التصحيح المحلي يبقى فعّالًا على localhost أو مع ?debug=1
// ================================================================

(function() {
  'use strict';

  // ============================================================
  //  🧪 هل نحن في وضع التصحيح؟
  // ============================================================
  const isDebug =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.search.indexOf('debug=1') !== -1 ||
    window.location.hash.indexOf('debug=1') !== -1;

  const ENDPOINT = '/api?action=reportError';

    // ============================================================
  //  🚫 فلتر الأخطاء الضجيجية — لا تُبلَّغ
  //  - أخطاء الإلغاء (navigation / redirect / revoke)
  //  - أخطاء متصفحات قديمة (Dolphin)
  //  - أخطاء كاش / SW
  // ============================================================
  var NOISE_PATTERNS = [
    'NetworkError when attempting to fetch',
    'Failed to fetch',
    'Load failed',
    'The operation was aborted',
    'AbortError',
    'NS_BINDING_ABORTED',
    'NetworkError',
    'The user aborted a request',
    'The fetching process for the media resource was aborted',
    'Unexpected token \'else\'',  // Dolphin
    'Unexpected token',           // Dolphin
    'SyntaxError'
  ];

  function isNoiseError(message) {
    var m = String(message || '');
    for (var i = 0; i < NOISE_PATTERNS.length; i++) {
      if (m.indexOf(NOISE_PATTERNS[i]) !== -1) return true;
    }
    return false;
  }

  // ============================================================
  //  💾 طابور محلي للأخطاء (عند انقطاع الشبكة)
  // ============================================================
  const QUEUE_KEY = '__kc_error_queue';
  const MAX_QUEUE = 20;

  function loadQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveQueue(arr) {
    try {
      if (arr.length > MAX_QUEUE) arr = arr.slice(-MAX_QUEUE);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  function enqueue(payload) {
    try {
      const arr = loadQueue();
      arr.push({ payload: payload, ts: Date.now() });
      saveQueue(arr);
    } catch (e) {}
  }

  function flushQueue() {
    try {
      if (!navigator.onLine) return;
      const arr = loadQueue();
      if (arr.length === 0) return;

      saveQueue([]);

      arr.forEach(function(item) {
        try {
          fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
            keepalive: true
          }).catch(function() {
            enqueue(item.payload);
          });
        } catch (e) {
          enqueue(item.payload);
        }
      });
    } catch (e) {}
  }

  window.addEventListener('online', function() {
    setTimeout(flushQueue, 1000);
  });

  setInterval(flushQueue, 30000);
  setTimeout(flushQueue, 2000);

  // ============================================================
  //  🚦 منع التكرار
  // ============================================================
  const sentKeys = new Map();
  const THROTTLE_MS = 8000;

  function shouldSend(key) {
    // ✅ فلترة الضجيج
    var parts = String(key || '').split('::');
    var msg = parts[1] || parts[0] || '';
    if (isNoiseError(msg)) return false;

    const now = Date.now();
    const last = sentKeys.get(key);
    if (last && (now - last) < THROTTLE_MS) return false;
    sentKeys.set(key, now);
    if (sentKeys.size > 50) {
      const cutoff = now - THROTTLE_MS * 2;
      sentKeys.forEach(function(v, k) {
        if (v < cutoff) sentKeys.delete(k);
      });
    }
    return true;
  }

  // ============================================================
  //  📤 إرسال الطلب للخادم
  // ============================================================
  function sendToServer(payload) {
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
      enqueue(payload);
      return;
    }

    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).then(function(response) {
        if (!response.ok) {
          enqueue(payload);
        }
      }).catch(function() {
        enqueue(payload);
      });
    } catch (e) {
      enqueue(payload);
    }
  }

  // ============================================================
  //  🔗 المعلومات الأساسية المشتركة
  // ============================================================
  function baseInfo() {
    return {
      url: String(window.location.href).substring(0, 300),
      userAgent: String(navigator.userAgent).substring(0, 200)
    };
  }

  // ============================================================
  //  🛑 window.onerror
  // ============================================================
  window.addEventListener('error', function(event) {
    if (event.target && event.target !== window && event.target.tagName) return;

    const message = (event.error && event.error.message) || event.message || 'Unknown error';
    const stack = (event.error && event.error.stack) || '';
    const filename = String(event.filename || '').substring(0, 150);
    const key = 'onerror::' + message + '::' + filename + '::' + (event.lineno || '');

    if (!shouldSend(key)) return;

    const info = baseInfo();
    sendToServer({
      source: 'window.onerror',
      message: String(message).substring(0, 500),
      stack: String(stack).substring(0, 1500),
      filename: filename,
      lineno: event.lineno || 0,
      colno: event.colno || 0,
      url: info.url,
      userAgent: info.userAgent
    });
  }, true);

  // ============================================================
  //  💥 window.onunhandledrejection
  // ============================================================
  window.addEventListener('unhandledrejection', function(event) {
    const reason = event.reason;
    let message = 'Unhandled Promise Rejection';
    let stack = '';

    if (reason instanceof Error) {
      message = reason.message || message;
      stack = reason.stack || '';
    } else if (typeof reason === 'string') {
      message = reason;
    } else if (reason && typeof reason === 'object') {
      try { message = JSON.stringify(reason).substring(0, 300); } catch (e) {}
    }

    const key = 'rejection::' + message;
    if (!shouldSend(key)) return;

    const info = baseInfo();
    sendToServer({
      source: 'unhandledrejection',
      message: String(message).substring(0, 500),
      stack: String(stack).substring(0, 1500),
      url: info.url,
      userAgent: info.userAgent
    });
  });

  // ============================================================
  //  🔇 إسكات console.error / console.warn في الإنتاج
  // ============================================================
  if (!isDebug) {
    try {
      console.error = function() {
        try {
          const args = Array.prototype.slice.call(arguments);
          const message = args.map(function(a) {
            if (a instanceof Error) return a.message;
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a); } catch (e) { return String(a); }
          }).join(' ');

          const key = 'console.error::' + message.substring(0, 200);
          if (!shouldSend(key)) return;

          const info = baseInfo();
          sendToServer({
            source: 'console.error',
            message: message.substring(0, 500),
            stack: '',
            url: info.url,
            userAgent: info.userAgent
          });
        } catch (e) {}
      };

      console.warn = function() {
        // نتجاهل التحذيرات
      };
    } catch (e) {}
  }

  // ============================================================
  //  🌐 واجهة يدوية — kcReportError (لتجنب تعارض reportError الأصلي)
  // ============================================================
  window.kcReportError = function(message, context) {
    try {
      // ✅ فلترة الضجيج
      if (isNoiseError(message)) return 'filtered';

      const key = 'manual::' + String(message).substring(0, 200);
      if (!shouldSend(key)) return 'throttled';

      const info = baseInfo();
      const payload = {
        source: 'manual',
        message: String(message).substring(0, 500),
        stack: '',
        context: context || {},
        url: info.url,
        userAgent: info.userAgent
      };

      // إذا كان الجهاز غير متصل → خزّن في الطابور
      if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
        enqueue(payload);
        return 'queued';
      }

      sendToServer(payload);
      return 'dispatched';
    } catch (e) {
      return 'error';
    }
  };

  // علَم للتحقق من التحميل
  window.__kcErrorReporterActive = true;

})();