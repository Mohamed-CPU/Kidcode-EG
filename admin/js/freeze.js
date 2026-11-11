// ================================================================
//  admin/js/freeze.js — Overlay التجميد (شاشة التعارض)
//  يدير: العرض، العدّاد، زرّي التعامل
// ================================================================

(function() {
  'use strict';

  let overlayEl = null;
  let countdownTimer = null;
  let currentInfo = null;
  let currentSecondsLeft = 0;

  // ============================================================
  //  🎯 إنشاء الـ Overlay (مرة واحدة فقط)
  // ============================================================
  function ensureOverlay() {
    if (overlayEl && document.body.contains(overlayEl)) return overlayEl;

    overlayEl = document.createElement('div');
    overlayEl.className = 'freeze-overlay';
    overlayEl.id = 'freezeOverlay';

    overlayEl.innerHTML =
      '<div class="freeze-card">' +
        '<div class="freeze-icon"><i class="fas fa-shield-halved"></i></div>' +
        '<h2 class="freeze-title" id="freezeTitle">تعارض في الجلسات</h2>' +
        '<p class="freeze-message" id="freezeMessage">' +
          'هذا الحساب مفتوح من جهاز آخر. تم تجميد كل العمليات مؤقتًا لحماية حسابك.' +
        '</p>' +

        '<div class="freeze-device-info" id="freezeDeviceInfo" style="display:none;">' +
          '<div class="device-row">' +
            '<span>الجهاز الآخر:</span>' +
            '<span id="deviceUA">—</span>' +
          '</div>' +
          '<div class="device-row">' +
            '<span>عنوان IP:</span>' +
            '<span id="deviceIP" style="direction:ltr;">—</span>' +
          '</div>' +
          '<div class="device-row">' +
            '<span>آخر نشاط:</span>' +
            '<span id="deviceTime">—</span>' +
          '</div>' +
        '</div>' +

        '<div class="freeze-timer" id="freezeTimer" style="display:none;">05:00</div>' +
        '<p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:16px;" id="freezeHint">' +
          'بعد انتهاء الوقت سيتم تعطيل الحساب تلقائيًا' +
        '</p>' +

        '<div class="freeze-actions" id="freezeActions">' +
          '<button class="btn btn-primary btn-lg btn-block" id="freezeChangePwdBtn">' +
            '<i class="fas fa-key"></i> تغيير كلمة السر' +
          '</button>' +
          '<button class="btn btn-danger btn-lg btn-block" id="freezeLogoutBtn">' +
            '<i class="fas fa-sign-out-alt"></i> تسجيل الخروج من هذا الجهاز' +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlayEl);

    // ربط الأزرار
    overlayEl.querySelector('#freezeChangePwdBtn').addEventListener('click', handleChangePassword);
    overlayEl.querySelector('#freezeLogoutBtn').addEventListener('click', handleLogout);

    return overlayEl;
  }

  // ============================================================
  //  🎨 العرض والإخفاء
  // ============================================================
  function show(info) {
    info = info || {};
    currentInfo = info;

    const el = ensureOverlay();

    // تحديث المعلومات
    const titleEl = el.querySelector('#freezeTitle');
    const msgEl = el.querySelector('#freezeMessage');
    const deviceBox = el.querySelector('#freezeDeviceInfo');
    const timerEl = el.querySelector('#freezeTimer');
    const hintEl = el.querySelector('#freezeHint');
    const actionsEl = el.querySelector('#freezeActions');

    // هل السبب يدوي (من superAdmin) أم تعارض؟
    const isManual = String(info.frozenReason || '') === 'manual';

    if (isManual) {
      titleEl.textContent = 'تم تجميد الحساب';
      msgEl.textContent = 'تم تجميد حسابك من قِبل superAdmin. يرجى التواصل معه.';
      deviceBox.style.display = 'none';
      timerEl.style.display = 'none';
      hintEl.style.display = 'none';
      actionsEl.innerHTML =
        '<button class="btn btn-secondary btn-lg btn-block" id="freezeLogoutBtn">' +
          '<i class="fas fa-sign-out-alt"></i> تسجيل الخروج' +
        '</button>';
      actionsEl.querySelector('#freezeLogoutBtn').addEventListener('click', handleLogout);
    } else {
      titleEl.textContent = 'تعارض في الجلسات';
      msgEl.innerHTML =
        'تم تسجيل دخول لحسابك من جهاز آخر. ' +
        '<br>تم تجميد كل العمليات مؤقتًا حتى تحسم الأمر.';
      hintEl.style.display = 'block';

      // معلومات الجهاز الآخر
      if (info.conflictInfo) {
        deviceBox.style.display = 'block';
        const ua = parseUserAgent(info.conflictInfo.user_agent);
        el.querySelector('#deviceUA').textContent = ua || 'جهاز غير معروف';
        el.querySelector('#deviceIP').textContent = info.conflictInfo.ip_address || '—';
        el.querySelector('#deviceTime').textContent = formatDateTime(info.conflictInfo.last_activity_at || info.conflictInfo.created_at);
      } else {
        deviceBox.style.display = 'none';
      }

      // العدّاد
      if (typeof info.secondsLeft === 'number' && info.secondsLeft > 0) {
        timerEl.style.display = 'block';
        currentSecondsLeft = info.secondsLeft;
        renderTimer();
        startCountdown();
      } else {
        timerEl.style.display = 'none';
      }
    }

    // إظهار الـ Overlay
    el.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function hide() {
    if (overlayEl) {
      overlayEl.classList.remove('show');
    }
    document.body.style.overflow = '';
    stopCountdown();
    currentInfo = null;
  }

  // ============================================================
  //  ⏱️ العدّاد التنازلي
  // ============================================================
  function startCountdown() {
    stopCountdown();
    countdownTimer = setInterval(function() {
      currentSecondsLeft--;
      if (currentSecondsLeft <= 0) {
        currentSecondsLeft = 0;
        renderTimer();
        stopCountdown();
        // انتهى الوقت — الـ polling سيتولى إبلاغنا بالتعطيل
      } else {
        renderTimer();
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function renderTimer() {
    if (!overlayEl) return;
    const timerEl = overlayEl.querySelector('#freezeTimer');
    if (!timerEl) return;

    const mins = Math.floor(currentSecondsLeft / 60);
    const secs = currentSecondsLeft % 60;
    timerEl.textContent =
      String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  // ============================================================
  //  🎯 الإجراءات
  // ============================================================
  async function handleChangePassword() {
    const btn = overlayEl.querySelector('#freezeChangePwdBtn');
    if (!btn) return;

    const confirmed = await window.UI.confirm({
      title: 'تغيير كلمة السر',
      message:
        'سيتم إرسال رابط إلى بريدك الإلكتروني لتغيير كلمة السر. ' +
        'بعد التغيير ستُنهى كل الجلسات الأخرى.',
      confirmText: 'إرسال الرابط',
      type: 'info'
    });

    if (!confirmed) return;

    window.UI.setLoading(btn, true, 'جاري الإرسال...');

    try {
      const result = await window.Core.api('requestPasswordChange', {}, 'POST');

      if (result.success) {
        window.UI.toast.success(
          result.message || 'تم إرسال رابط تغيير كلمة السر إلى بريدك الإلكتروني.',
          { duration: 8000 }
        );
        // نبقى في حالة تجميد — المستخدم يحتاج للضغط على الرابط في البريد
      } else {
        window.UI.toast.error(result.message || 'تعذر إرسال الرابط');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال بالخادم');
    } finally {
      window.UI.setLoading(btn, false);
    }
  }

  async function handleLogout() {
    const btn = overlayEl.querySelector('#freezeLogoutBtn');
    if (!btn) return;

    const confirmed = await window.UI.confirm({
      title: 'تسجيل الخروج',
      message:
        'سيتم تسجيل الخروج من هذا الجهاز. ' +
        'سيعمل الجهاز الآخر بشكل طبيعي خلال ثوانٍ.',
      confirmText: 'تسجيل الخروج',
      type: 'warning'
    });

    if (!confirmed) return;

    window.UI.setLoading(btn, true, 'جاري الخروج...');
    await window.Core.logout();
  }

  // ============================================================
  //  🛠️ Helpers
  // ============================================================
  function parseUserAgent(ua) {
    if (!ua) return '';
    ua = String(ua);
    let browser = '';
    let os = '';

    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';

    if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac OS/.test(ua)) os = 'macOS';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone|iPad/.test(ua)) os = 'iOS';
    else if (/Linux/.test(ua)) os = 'Linux';

    if (browser && os) return browser + ' على ' + os;
    if (browser) return browser;
    if (os) return os;
    return '';
  }

  // ✅ الصيغة العربية الكاملة بتوقيت القاهرة:
  //    "الأربعاء، 11 نوفمبر 2026 - 04:00 مساءً"
  //    (كان: local TZ + 4:00 PM بدون zero-pad)
  function formatDateTime(value) {
    if (!value) return '—';
    try {
      if (window.AdminUtils && typeof window.AdminUtils.formatDateTime === 'function') {
        return window.AdminUtils.formatDateTime(value) || '—';
      }
      // Fallback: Cairo numeric (لو AdminUtils مش محمّل)
      const d = new Date(value);
      if (isNaN(d.getTime())) return String(value);
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(d);
      const g = function(t) {
        const p = parts.find(function(x) { return x.type === t; });
        return p ? p.value : '';
      };
      let hh = g('hour'); if (hh === '24') hh = '00';
      return g('year') + '-' + g('month') + '-' + g('day') + ' ' + hh + ':' + g('minute');
    } catch (e) {
      return '—';
    }
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.FreezeOverlay = {
    show: show,
    hide: hide,
    update: function(info) {
      // لو الـ Overlay مش ظاهر → أنشئه
      if (!overlayEl || !overlayEl.classList.contains('show')) {
        show(info);
        return;
      }

      // ✅ ضمان إظهار العدّاد
      if (typeof info.secondsLeft === 'number' && info.secondsLeft > 0) {
        const timerEl = overlayEl.querySelector('#freezeTimer');
        const hintEl = overlayEl.querySelector('#freezeHint');

        if (timerEl && timerEl.style.display === 'none') {
          timerEl.style.display = 'block';
        }
        if (hintEl) hintEl.style.display = 'block';

        // ✅ حدّث العدّاد فقط إذا الفرق كبير (> 3 ثوان)
        //    هذا يمنع "القفزات" الناتجة عن تأخير الشبكة
        const diff = Math.abs(info.secondsLeft - currentSecondsLeft);
        if (diff > 3 || currentSecondsLeft === 0) {
          currentSecondsLeft = info.secondsLeft;
          renderTimer();
        }

        // ✅ ابدأ العدّاد إذا لم يكن يعمل
        if (!countdownTimer) {
          startCountdown();
        }
      }

      // ✅ حدّث معلومات الجهاز الآخر إذا وصلت
      if (info.conflictInfo) {
        const deviceBox = overlayEl.querySelector('#freezeDeviceInfo');
        if (deviceBox) {
          deviceBox.style.display = 'block';
          const ua = parseUserAgent(info.conflictInfo.user_agent);
          const uaEl = overlayEl.querySelector('#deviceUA');
          const ipEl = overlayEl.querySelector('#deviceIP');
          const timeEl = overlayEl.querySelector('#deviceTime');

          if (uaEl && ua) uaEl.textContent = ua || 'جهاز غير معروف';
          if (ipEl && info.conflictInfo.ip_address) ipEl.textContent = info.conflictInfo.ip_address;
          if (timeEl && (info.conflictInfo.last_activity_at || info.conflictInfo.created_at)) {
            timeEl.textContent = formatDateTime(info.conflictInfo.last_activity_at || info.conflictInfo.created_at);
          }
        }
      }
    }
  };

})();