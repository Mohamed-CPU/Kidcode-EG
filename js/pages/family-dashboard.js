// ================================================================
//  family-dashboard.js - SPA Controller
//  - Auth Guard
//  - Router (hash-based)
//  - Sidebar load child info
//  - Logout
//  - Mobile drawer
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  Constants
    // ============================================================
    const API_ENDPOINT = '/api?action=family';
    const SESSION_KEY = 'family_session';
    const CHILD_ID_KEY = 'family_child_id';
    const DEFAULT_TAB = 'data';
    const VALID_TABS = ['data', 'notifications', 'reports', 'security', 'missing', 'contact', 'settings'];

    // ============================================================
    //  State
    // ============================================================
    const state = {
        session: '',
        childID: '',
        childData: null,
        currentTab: DEFAULT_TAB,
        isInitialized: false
    };

    let isRedirecting = false;

    // ============================================================
//  📡 BroadcastChannel — مزامنة فورية بين تابات نفس المتصفح
// ============================================================
const SESSION_BROADCAST_CHANNEL = 'kidcode_session_sync';
const SESSION_STORAGE_KEY = 'family_session_terminated';

let sessionChannel = null;
try {
    if ('BroadcastChannel' in window) {
        sessionChannel = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);
        sessionChannel.onmessage = function(e) {
            if (e.data && e.data.type === 'session_terminated') {
                console.log('📡 [Broadcast] جلسة اتلغت — redirect');
                handleSessionExpired();
            }
        };
    }
} catch (e) {}

// Fallback للـ storage event (بعض المتصفحات)
window.addEventListener('storage', function(e) {
    if (e.key === SESSION_STORAGE_KEY && e.newValue) {
        console.log('💾 [Storage] جلسة اتلغت — redirect');
        handleSessionExpired();
    }
});

// ============================================================
//  📢 بث إلغاء الجلسة لكل التابات
// ============================================================
function broadcastSessionTerminated() {
    console.log('📢 [Broadcast] إرسال إشارة إلغاء الجلسة');
    try {
        if (sessionChannel) {
            sessionChannel.postMessage({ type: 'session_terminated' });
        }
        // Fallback
        localStorage.setItem(SESSION_STORAGE_KEY, String(Date.now()));
        setTimeout(function() {
            try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (e) {}
        }, 1500);
    } catch (e) {
        console.warn('Broadcast failed:', e);
    }
}

    // ============================================================
    //  DOM References
    // ============================================================
    const els = {
        sidebar: document.getElementById('fdSidebar'),
        sidebarOverlay: document.getElementById('fdSidebarOverlay'),
        sidebarNav: document.getElementById('sidebarNav'),
        mobileSidebarToggle: document.getElementById('mobileSidebarToggle'),
        mobileCurrentTab: document.getElementById('mobileCurrentTab'),
        logoutBtn: document.getElementById('logoutBtn'),
        contentWrapper: document.getElementById('contentWrapper'),
        globalLoader: document.getElementById('fdGlobalLoader'),
        // Profile
        sidebarAvatar: document.getElementById('sidebarAvatar'),
        sidebarChildName: document.getElementById('sidebarChildName'),
        sidebarChildID: document.getElementById('sidebarChildID'),
        sidebarStatus: document.getElementById('sidebarStatus'),
        // 🚪 Exit Modal
        exitModal: document.getElementById('fdExitModal'),
        exitCancelBtn: document.getElementById('fdExitCancelBtn'),
        exitConfirmBtn: document.getElementById('fdExitConfirmBtn')
    };

    // ============================================================
    //  Helpers
    // ============================================================
    function getSession() {
        try {
            return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || '';
        } catch (e) {
            return '';
        }
    }

    function getChildID() {
        try {
            return sessionStorage.getItem(CHILD_ID_KEY) || localStorage.getItem(CHILD_ID_KEY) || '';
        } catch (e) {
            return '';
        }
    }

    function clearSession() {
        try {
            sessionStorage.removeItem(SESSION_KEY);
            sessionStorage.removeItem(CHILD_ID_KEY);
            sessionStorage.removeItem('family_session_expiry');
            localStorage.removeItem(SESSION_KEY);
            localStorage.removeItem(CHILD_ID_KEY);
        } catch (e) {}
    }

    function showGlobalLoader(show) {
        if (els.globalLoader) {
            els.globalLoader.style.display = show ? 'flex' : 'none';
        }
    }

    // ============================================================
    //  Initial Loader + Error State
    // ============================================================
    function hideInitialLoader() {
        const loader = document.getElementById('fdInitialLoader');
        if (loader) loader.classList.add('hidden');
    }

    function classifyError(err) {
        if (!err) {
            return {
                icon: 'fa-triangle-exclamation',
                title: 'حدث خطأ',
                message: 'تعذر تحميل البيانات. حاول مرة أخرى.'
            };
        }

        // 1️⃣ Timeout
        if (err.name === 'AbortError') {
            return {
                icon: 'fa-clock',
                title: 'انتهت مهلة الاتصال',
                message: 'تحقق من اتصالك بالإنترنت وحاول مرة أخرى.'
            };
        }

        // 2️⃣ Network Error
        if (err.name === 'TypeError' &&
            (!err.message ||
             err.message.indexOf('fetch') !== -1 ||
             err.message.indexOf('Network') !== -1 ||
             err.message.indexOf('Failed') !== -1)) {
            return {
                icon: 'fa-wifi',
                title: 'مشكلة في الاتصال',
                message: 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.'
            };
        }

        // 3️⃣ HTTP Status Codes
        if (err.status) {
            if (err.status === 401 || err.status === 403) {
                return { redirect: true };
            }
            if (err.status >= 500) {
                return {
                    icon: 'fa-server',
                    title: 'خطأ في الخادم',
                    message: 'فريقنا يعمل على حل المشكلة. حاول مرة أخرى بعد قليل.'
                };
            }
            if (err.status === 404) {
                return {
                    icon: 'fa-circle-question',
                    title: 'الخدمة غير متاحة',
                    message: 'الخدمة المطلوبة غير موجودة. حاول مرة أخرى.'
                };
            }
            return {
                icon: 'fa-triangle-exclamation',
                title: 'خطأ في الاتصال',
                message: 'كود الخطأ: ' + err.status + '. حاول مرة أخرى.'
            };
        }

        // 4️⃣ Business Error — Session Issue
        const msg = String(err.message || '').toLowerCase();
        if (msg.indexOf('صلاحية') !== -1 || msg.indexOf('جلسة') !== -1) {
            return { redirect: true };
        }

        // 5️⃣ Business Error — عام
        return {
            icon: 'fa-triangle-exclamation',
            title: 'تعذر تحميل البيانات',
            message: err.message || 'حدث خطأ غير متوقع. حاول مرة أخرى.'
        };
    }

    function handleInitialError(err) {
        console.error('❌ [Initial Load Error]', err);

        // إخفاء الـ Loader
        const loader = document.getElementById('fdInitialLoader');
        if (loader) loader.style.display = 'none';

        const errorState = document.getElementById('fdInitialError');
        if (!errorState) return;

        const info = classifyError(err);

        // 🔒 Session expired → redirect
        if (info.redirect) {
            clearSession();
            window.location.replace('/family-login');
            return;
        }

        // عرض الـ Error UI
        const iconEl = errorState.querySelector('.fd-initial-error-icon i');
        const titleEl = errorState.querySelector('.fd-initial-error-title');
        const msgEl = document.getElementById('fdInitialErrorMessage');

        if (iconEl) iconEl.className = 'fas ' + (info.icon || 'fa-triangle-exclamation');
        if (titleEl) titleEl.textContent = info.title || 'حدث خطأ';
        if (msgEl) msgEl.textContent = info.message || 'تعذر تحميل البيانات';

        errorState.style.display = 'flex';
    }

    function bindInitialRetry() {
        const btn = document.getElementById('fdInitialRetryBtn');
        if (!btn) return;

        btn.addEventListener('click', function() {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري إعادة التحميل...';
            window.location.reload();
        });
    }

    // ============================================================
    //  API Call with Timeout (للـ Initial Load فقط)
    // ============================================================
    async function apiCallWithTimeout(innerAction, payload, method, timeoutMs) {
        method = method || 'POST';
        timeoutMs = timeoutMs || 15000;

        const url = API_ENDPOINT + '&innerAction=' + encodeURIComponent(innerAction);

        const controller = new AbortController();
        const timeoutId = setTimeout(function() { controller.abort(); }, timeoutMs);

        const options = {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal
        };

        try {
            let response;

            if (method === 'POST') {
                options.body = JSON.stringify(payload || {});
                response = await fetch(url, options);
            } else {
                const params = new URLSearchParams(payload || {});
                response = await fetch(url + '&' + params.toString(), options);
            }

            // ❌ HTTP Error
            if (!response.ok) {
                const error = new Error('HTTP ' + response.status);
                error.status = response.status;
                throw error;
            }

            return await response.json();
        } finally {
            clearTimeout(timeoutId);
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

        // ============================================================
        //  🔍 كشف أخطاء الجلسة
        // ============================================================
        function isSessionError(result) {
            if (!result) return false;

            // الحالة 1: رد success-based (زي getChildDataForFamily / disableChildAccount)
            if (result.success === false) {
                const err = String(result.error || '').toLowerCase();
                return err.indexOf('جلسة') !== -1 ||
                    err.indexOf('session') !== -1 ||
                    result.code === 'invalid_session' ||
                    result.code === 'session_expired' ||
                    result.code === 'invalid_token';
            }

            // ✅ الحالة 2: رد valid-based (زي verifyFamilySession)
            //    { valid: false, error: 'الجلسة غير نشطة' } أو { valid: true, ... }
            if (result.valid === false) {
                return true; // أي valid=false = جلسة مش صالحة
            }

            return false;
        }

        // ============================================================
        //  🚨 معالج انتهاء الجلسة — يمسح كل حاجة + redirect
        // ============================================================
        function handleSessionExpired() {
            if (isRedirecting) return;
            isRedirecting = true;

            console.warn('🚫 [Session] انتهت الجلسة — تنظيف + redirect');

            // ✅ أوقف الـ Timer
            stopSessionExpiryTimer();

            // 1. امسح كل مفاتيح الجلسة
            try {
                sessionStorage.removeItem(SESSION_KEY);
                sessionStorage.removeItem(CHILD_ID_KEY);
                sessionStorage.removeItem('family_session_expiry');
                localStorage.removeItem(SESSION_KEY);
                localStorage.removeItem(CHILD_ID_KEY);
                localStorage.removeItem('family_session_expiry');   // ← جديد
            } catch (e) {}

            // 2. امسح أي مفاتيح إضافية
            try {
                Object.keys(localStorage).forEach(function(key) {
                    if (key.indexOf('family_') === 0 || key.indexOf('kc_') === 0) {
                        localStorage.removeItem(key);
                    }
                });
            } catch (e) {}

            // 3. امسح Session Storage كامل
            try { sessionStorage.clear(); } catch (e) {}

            // 4. Redirect فوري
            window.location.replace('/family-login?reason=session_expired');
        }

        // ============================================================
        //  🌐 API Call — مع فحص موحد للجلسة
        // ============================================================
        async function apiCall(innerAction, payload, method) {
            method = method || 'POST';
            const url = API_ENDPOINT + '&innerAction=' + encodeURIComponent(innerAction);

            const options = {
                method: method,
                headers: { 'Content-Type': 'application/json' }
            };

            let result;
            if (method === 'POST') {
                options.body = JSON.stringify(payload || {});
                const res = await fetch(url, options);
                result = await res.json();
            } else {
                const params = new URLSearchParams(payload || {});
                const res = await fetch(url + '&' + params.toString(), options);
                result = await res.json();
            }

            // ✅ فحص الجلسة
            if (isSessionError(result)) {
                handleSessionExpired();
                throw new Error('session_expired');
            }

            return result;
        }

    // ============================================================
    //  Router
    // ============================================================
    function getHashTab() {
        let hash = (window.location.hash || '').replace('#', '').trim().toLowerCase();
        if (!hash || VALID_TABS.indexOf(hash) === -1) {
            hash = DEFAULT_TAB;
        }
        return hash;
    }

    function switchTab(tabName) {
        if (VALID_TABS.indexOf(tabName) === -1) {
            tabName = DEFAULT_TAB;
        }
        state.currentTab = tabName;

        // 1. Hide all tabs, show active
        const tabs = document.querySelectorAll('.fd-tab');
        tabs.forEach(function(tab) {
            const t = tab.getAttribute('data-tab');
            tab.style.display = (t === tabName) ? 'block' : 'none';
        });

        // 2. Update sidebar active state
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(function(item) {
            const t = item.getAttribute('data-tab');
            if (t === tabName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // 3. Update mobile tab title
        const currentNavItem = document.querySelector('.nav-item[data-tab="' + tabName + '"]');
        if (currentNavItem && els.mobileCurrentTab) {
            const label = currentNavItem.querySelector('span');
            els.mobileCurrentTab.textContent = label ? label.textContent : '';
        }

        // 4. Update hash — بدون إضافة history entry (عشان زر الـ Back)
        if (window.location.hash !== '#' + tabName) {
            try {
                history.replaceState(null, '', '#' + tabName);
            } catch (e) {
                // Fallback (متصفحات قديمة)
                window.location.hash = '#' + tabName;
            }
        }

        // 5. Close mobile sidebar
        closeSidebar();

        // 6. Call tab-specific onActivate hook (if exists)
        if (typeof window.onTabActivate === 'function') {
            try {
                window.onTabActivate(tabName, state.childData);
            } catch (e) {
                console.warn('⚠️ onTabActivate error:', e);
            }
        }

        // 7. Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function handleHashChange() {
        const tab = getHashTab();
        if (tab !== state.currentTab) {
            switchTab(tab);
        }
    }

    // ============================================================
    //  Sidebar (Mobile Drawer)
    // ============================================================
    function openSidebar() {
        if (els.sidebar) els.sidebar.classList.add('open');
        if (els.sidebarOverlay) els.sidebarOverlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        if (els.sidebar) els.sidebar.classList.remove('open');
        if (els.sidebarOverlay) els.sidebarOverlay.classList.remove('show');
        document.body.style.overflow = '';
    }

    function toggleSidebar() {
        if (!els.sidebar) return;
        if (els.sidebar.classList.contains('open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    }

    // ============================================================
    //  Load Child Data (for Sidebar)
    // ============================================================
    async function loadChildInfo() {
        // ✅ دايماً اطلب من الخادم (Supabase أسرع بكتير)
        console.log('🔄 [Sidebar] جلب بيانات الطفل...');
        const result = await apiCallWithTimeout('getChildDataForFamily', {
            childID: state.childID
        }, 'GET', 15000);

        console.log('📩 getChildDataForFamily:', result);

        if (!result.success) {
            const error = new Error(result.error || 'فشل تحميل البيانات');
            error.dataCode = result.code;
            throw error;
        }

        state.childData = result.data;
        updateSidebarProfile(result.data);

        return result;
    }

    function updateSidebarProfile(data) {
        if (!data) return;

        // Avatar
        if (els.sidebarAvatar) {
            const strFileId = String(data.imageFileId || '').trim();
            
            // ✅ Cloudinary بس
            if (strFileId.startsWith('http')) {
                els.sidebarAvatar.innerHTML = '<img src="' + strFileId + '" alt="' + escapeHtml(data.childName || '') + '" onerror="this.parentNode.innerHTML=\'<i class=&quot;fas fa-child&quot;></i>\'">';
            } else {
                els.sidebarAvatar.innerHTML = '<i class="fas fa-child"></i>';
            }
        }

        // Name
        if (els.sidebarChildName) {
            els.sidebarChildName.textContent = data.childName || 'بدون اسم';
        }

        // ID
        if (els.sidebarChildID) {
            els.sidebarChildID.textContent = state.childID || '--';
        }

        // Status
        if (els.sidebarStatus) {
            const status = (data.status || '').toLowerCase();
            const statusMap = {
                'active': { label: '✅ نشط', cls: 'status-active' },
                'pending': { label: '⏳ قيد التفعيل', cls: 'status-pending' },
                'expired': { label: '⏰ منتهي', cls: 'status-expired' },
                'suspended': { label: '🚫 موقوف', cls: 'status-suspended' },
                'deleted': { label: '🗑️ محذوف', cls: 'status-deleted' },
                'inactive': { label: '⛔ غير نشط', cls: 'status-inactive' },
                'disabled': { label: '🚫 معطّل', cls: 'status-disabled' },
                'refunding': { label: '⏳ طلب استرداد', cls: 'status-pending' },
                'refunded': { label: '💸 مسترد', cls: 'status-deleted' }
            };

            const info = statusMap[status] || { label: status || 'غير معروف', cls: '' };
            els.sidebarStatus.className = 'profile-status ' + info.cls;
            els.sidebarStatus.innerHTML = info.label;
        }
    }

    // ============================================================
    //  Logout
    // ============================================================
    async function handleLogout() {
        try {
            showGlobalLoader(true);

            // ✅ أوقف الـ Timer
            stopSessionExpiryTimer();

            // 📡 بث فوري لباقي تابات نفس المتصفح
            broadcastSessionTerminated();

            // Call backend (best-effort)
            if (state.session) {
                await apiCall('familyLogout', { session: state.session }).catch(function() {});
            }
        } catch (e) {
            // ignore
        } finally {
            clearSession();
            window.location.href = '/family-login';
        }
    }

    // ============================================================
    //  Event Binding
    // ============================================================
    function bindEvents() {
        // Hash change — بيشتغل بس لو الـ hash اتغير من بره (مثلاً deep link)
        // ملاحظة: nav-items بتستخدم preventDefault، فمش بتفعّل الـ event ده
        window.addEventListener('hashchange', handleHashChange);

        // Nav items (عادي + mobile)
        document.querySelectorAll('.nav-item').forEach(function(item) {
            item.addEventListener('click', function(e) {
                // ✅ امنع السلوك الافتراضي دايماً (ده اللي كان بيعمل history entry)
                e.preventDefault();

                const tabName = item.getAttribute('data-tab');
                const isDisabled = item.classList.contains('nav-item-disabled');

                if (isDisabled) return;

                // لو نفس التاب — اقفل السايدبار بس
                if (tabName === state.currentTab) {
                    closeSidebar();
                    return;
                }

                // ✅ ننادي switchTab يدوياً (هيستخدم replaceState داخلياً)
                switchTab(tabName);
            });
        });

        // Mobile toggle
        if (els.mobileSidebarToggle) {
            els.mobileSidebarToggle.addEventListener('click', toggleSidebar);
        }

        // Overlay close
        if (els.sidebarOverlay) {
            els.sidebarOverlay.addEventListener('click', closeSidebar);
        }

        // Logout — نستخدم نفس المودال بتاع الـ Back
        if (els.logoutBtn) {
            els.logoutBtn.addEventListener('click', function() {
                if (!exitModalShown) {
                    showExitModal();
                }
            });
        }

        // Escape closes sidebar
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && els.sidebar && els.sidebar.classList.contains('open')) {
                closeSidebar();
            }
        });

        // Close sidebar when resizing to desktop
        window.addEventListener('resize', function() {
            if (window.innerWidth > 768) {
                closeSidebar();
            }
        });
    }

    // ============================================================
    //  Public API (for tabs to use)
    // ============================================================
    window.FD = {
        apiCall: apiCall,
        getState: function() { return state; },
        getSession: getSession,
        getChildID: function() { return state.childID; },
        showLoader: showGlobalLoader,
        escapeHtml: escapeHtml,
        broadcastSessionTerminated: broadcastSessionTerminated,
        hideInitialLoader: hideInitialLoader,
    };

    // ============================================================
    //  Init
    // ============================================================
    async function init() {
        // 0. Bind retry button (سريع + مضمون)
        bindInitialRetry();

        // 1. Auth Guard
        state.session = getSession();
        state.childID = getChildID();

        if (!state.session || !state.childID) {
            window.location.replace('/family-login');
            return;
        }

        console.log('✅ [family-dashboard] Session OK:', state.childID);

        try {
            // 2. Load child info (مع timeout)
            await loadChildInfo();

            // 3. Initial tab — الـ loader هيتشال من الـ tab نفسه بعد ما البيانات تظهر
            const initialTab = getHashTab();
            switchTab(initialTab);

            // 4. Safety fallback — لو التاب مش 'data' أو حصلت مشكلة
            setTimeout(function() {
                hideInitialLoader();
            }, 8000);

            // 5. Bind events
            bindEvents();

            state.isInitialized = true;
            console.log('✅ [family-dashboard] Initialized');

            // 6. Session Expiry Timer + Polling + Visibility check
            startSessionExpiryTimer();
            startFastSessionPolling();
            bindVisibilityCheck();

        } catch (err) {
            // ❌ فشل → عرض Error State
            handleInitialError(err);
        }

            // 🚪 Back Button Confirmation
            bindExitConfirmation();
    }

        // ============================================================
        //  🔄 Fast Polling — فحص الجلسة كل 3 ثواني (ذكي)
        //  - visible + focused: 3 ثواني
        //  - visible + not focused: 8 ثواني
        //  - hidden: تخطى (في visibility handler)
        // ============================================================
        let pollingIntervalId = null;
        let currentPollingSpeed = 0;

        function startFastSessionPolling() {
            const FAST_INTERVAL_MS = 3 * 1000;   // 3 ثواني
            const SLOW_INTERVAL_MS = 8 * 1000;   // 8 ثواني

            function scheduleNext() {
                if (isRedirecting) return;

                // اختار السرعة حسب حالة التاب
                let interval = FAST_INTERVAL_MS;
                if (!document.hidden && !document.hasFocus()) {
                    interval = SLOW_INTERVAL_MS;
                }

                // لو التاب مخفي → وقف polling
                if (document.hidden) {
                    currentPollingSpeed = 0;
                    return;
                }

                // غيّر الفاصل الزمني لو اختلف عن الحالي
                if (currentPollingSpeed !== interval) {
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                    pollingIntervalId = setInterval(checkSessionAlive, interval);
                    currentPollingSpeed = interval;
                    console.log(`✅ [Polling] كل ${interval / 1000} ثانية`);
                }
            }

            // Initial schedule
            scheduleNext();

            // أعد الجدولة عند تغير حالة الـ focus
            window.addEventListener('focus', scheduleNext);
            window.addEventListener('blur', scheduleNext);
            document.addEventListener('visibilitychange', scheduleNext);
        }

        // ============================================================
        //  فحص الجلسة — نبض سريع
        // ============================================================
        function checkSessionAlive() {
            if (!state.session || isRedirecting) return;

            // نستخدم fetch مباشر (مش apiCall) عشان نتحكم في الـ timeout
            const url = API_ENDPOINT + '&innerAction=verifyFamilySession&session=' + encodeURIComponent(state.session);

            const controller = new AbortController();
            const timeoutId = setTimeout(function() { controller.abort(); }, 5000);

            fetch(url, { signal: controller.signal })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    clearTimeout(timeoutId);
                    if (!data) return;

                    // ✅ في حالة الرد valid-based
                    if (data.valid === false) {
                        console.warn('🚫 [Polling] جلسة ميتة → redirect');
                        handleSessionExpired();
                        return;
                    }

                    // ✅ في حالة الرد success-based (احتياط)
                    if (data.success === false) {
                        const err = String(data.error || '').toLowerCase();
                        if (err.indexOf('جلسة') !== -1 || err.indexOf('session') !== -1) {
                            handleSessionExpired();
                        }
                    }
                })
                .catch(function(err) {
                    clearTimeout(timeoutId);
                    // نتجاهل أخطاء الشبكة — نحاول تاني
                    if (err.name !== 'AbortError') {
                        console.warn('⚠️ [Polling]', err.message);
                    }
                });
        }

                // ============================================================
        //  ⏱️ Session Expiry Timer — 30 دقيقة كحد أقصى
        //  - الجلسة ثابتة من وقت Login (بدون تمديد)
        //  - بعد انتهاء المدة → خروج تلقائي
        // ============================================================
        let sessionExpiryTimerId = null;

        // ✅ اقرأ expiry من sessionStorage أو localStorage
        //    القيمة لازم تكون ISO UTC (من family-login.js)
        function getSessionExpiry() {
            try {
                const stored = sessionStorage.getItem('family_session_expiry')
                             || localStorage.getItem('family_session_expiry');
                if (!stored) return null;
                const t = new Date(stored).getTime();
                return isNaN(t) ? null : t;
            } catch (e) {
                return null;
            }
        }

        function startSessionExpiryTimer() {
            // امسح أي timer قديم
            stopSessionExpiryTimer();

            // اقرأ وقت انتهاء الجلسة (sessionStorage → localStorage)
            const expiryTime = getSessionExpiry();

            // ✅ لو مفيش expiry → خروج فوري (مش تمديد!)
            if (!expiryTime) {
                console.warn('🚫 [Session Expiry] مفيش expiry محفوظ → خروج فوري');
                handleSessionExpired();
                return;
            }

            const remaining = expiryTime - Date.now();
            const remainingMin = Math.max(0, Math.round(remaining / 1000 / 60));

            console.log('⏱️ [Session Expiry] الجلسة تنتهي خلال ' + remainingMin + ' دقيقة');

            if (remaining <= 0) {
                console.warn('🚫 [Session Expiry] الجلسة منتهية بالفعل → redirect');
                handleSessionExpired();
                return;
            }

            // ✅ ضع timer
            sessionExpiryTimerId = setTimeout(function() {
                console.warn('🚫 [Session Expiry] انتهت مدة الجلسة → redirect');
                handleSessionExpired();
            }, remaining);
        }

        function stopSessionExpiryTimer() {
            if (sessionExpiryTimerId) {
                clearTimeout(sessionExpiryTimerId);
                sessionExpiryTimerId = null;
            }
        }

        // ============================================================
        //  ⏱️ فحص الوقت المتبقي — عند رجوع التاب
        // ============================================================
        function checkSessionExpiryTime() {
            if (isRedirecting) return;

            const expiryTime = getSessionExpiry();

            // ✅ لو مفيش expiry → خروج فوري
            if (!expiryTime) {
                console.warn('🚫 [Session Expiry] مفيش expiry → خروج فوري');
                handleSessionExpired();
                return;
            }

            if (Date.now() >= expiryTime) {
                console.warn('🚫 [Session Expiry] الوقت انتهى — redirect');
                handleSessionExpired();
            } else {
                // أعد ضبط الـ timer (بعد رجوع التاب)
                startSessionExpiryTimer();
            }
        }

        // ============================================================
        //  👁️ فحص فوري عند رجوع التاب
        // ============================================================
        function bindVisibilityCheck() {
            document.addEventListener('visibilitychange', function() {
                if (document.hidden) return;
                if (!state.session || isRedirecting) return;
                console.log('👁️ [Visibility] التاب رجع — فحص فوري');

                // ✅ فحص الوقت المتبقي أولاً
                checkSessionExpiryTime();

                // فحص الخادم
                if (!isRedirecting) checkSessionAlive();
            });

            window.addEventListener('focus', function() {
                if (!state.session || isRedirecting) return;
                if (document.hidden) return;
                console.log('🖱️ [Focus] فحص فوري');

                checkSessionExpiryTime();
                if (!isRedirecting) checkSessionAlive();
            });
        }

        // ============================================================
        //  🚪 Exit Confirmation — لما المستخدم يدوس Back
        //  - المودال يظهر
        //  - "بقاء" → يفضل في الصفحة
        //  - "خروج" → Logout
        // ============================================================
        let exitModalShown = false;

        function bindExitConfirmation() {
            // 1. اضغط history state عشان نمسك الـ back
            try {
                history.pushState({ page: 'dashboard' }, '', window.location.href);
            } catch (e) {}

            // 2. Event للـ Back button
            window.addEventListener('popstate', function(e) {
                if (isRedirecting) return;   // لو logout بيتنفذ
                if (!state.session) return;  // مش داخل

                // ✅ دايماً رجّع الـ state (يخلي المستخدم ما يخرجش)
                try {
                    history.pushState({ page: 'dashboard' }, '', window.location.href);
                } catch (err) {}

                // ✅ اعرض المودال (لو مش مفتوح)
                // ملاحظة: التبويبات بتستخدم replaceState، فمش بتفعّل popstate
                if (!exitModalShown) {
                    showExitModal();
                }
            });

            // 3. Bind buttons
            if (els.exitCancelBtn) {
                els.exitCancelBtn.addEventListener('click', hideExitModal);
            }
            if (els.exitConfirmBtn) {
                els.exitConfirmBtn.addEventListener('click', function() {
                    hideExitModal();
                    handleLogout();
                });
            }

            // 4. Click outside → نفس تأثير "بقاء"
            if (els.exitModal) {
                els.exitModal.addEventListener('click', function(e) {
                    if (e.target === els.exitModal) {
                        hideExitModal();
                    }
                });
            }

            // 5. Escape → "بقاء"
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && exitModalShown) {
                    hideExitModal();
                }
            });
        }

        function showExitModal() {
            if (!els.exitModal) return;
            exitModalShown = true;
            els.exitModal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }

        function hideExitModal() {
            if (!els.exitModal) return;
            exitModalShown = false;
            els.exitModal.style.display = 'none';
            document.body.style.overflow = '';
        }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();