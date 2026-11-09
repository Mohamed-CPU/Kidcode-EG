// ================================================================
//  middleware.js — حماية /admin/* و /api?action=admin
//  - Vercel Edge Middleware (يعمل قبل تحميل الصفحة)
//  - فحص حالة البوابة من Supabase (Cache 30 ثانية)
//  - فحص وجود Cookie الجلسة
//  - مسارات مستثناة: enter.html, emergency-unlock.html, login page, static
// ================================================================

// ================================================================
//  🔧 الثوابت
// ================================================================
const CACHE_TTL_MS = 5 * 1000;

// مسارات مسموحة بدون Cookie
const PUBLIC_ADMIN_PAGES = [
  '/admin/',
  '/admin/index.html',
  '/admin/enter.html',
  '/admin/emergency-unlock.html'
];

// innerActions مسموحة بدون Cookie
const PUBLIC_ADMIN_ACTIONS = [
  'login',
  'verify',
  'checkStatus',
  'consumeLoginLink',
  'emergencyUnlock',
  'initSuperAdmin',
  'health',
  'requestPasswordChange',
  'changePasswordWithToken',
  'iDidntRequest'
];

// ================================================================
//  🗃️ Cache في الذاكرة
// ================================================================
let cachedPanelOpen = null;
let cacheTimestamp = 0;

// ================================================================
//  🔍 isPanelOpen — قراءة حالة البوابة من Supabase REST
// ================================================================
async function isPanelOpen() {
  const now = Date.now();

  if (cachedPanelOpen !== null && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedPanelOpen;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Fail-Close: لو الإعدادات ناقصة → مقفولة
    cachedPanelOpen = false;
    cacheTimestamp = now;
    return false;
  }

  try {
    const url = supabaseUrl +
      '/rest/v1/AppConfig?key=eq.admin_panel_enabled&select=value';

    const res = await fetch(url, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey
      }
    });

    if (!res.ok) {
      cachedPanelOpen = false;
      cacheTimestamp = now;
      return false;
    }

    const data = await res.json();
    const value = (Array.isArray(data) && data[0])
      ? String(data[0].value || '').trim()
      : '';

    cachedPanelOpen = (value === 'نعم');
    cacheTimestamp = now;
    return cachedPanelOpen;
  } catch (e) {
    // Fail-Close على أي خطأ
    cachedPanelOpen = false;
    cacheTimestamp = now;
    return false;
  }
}

// ================================================================
//  🎫 hasSessionToken — فحص وجود cookie أو Authorization header
//  - Cookie: بيجي تلقائيًا مع same-origin requests
//  - Authorization: core.js بيبعته مع كل API call
//  ملاحظة: نفحص الاتنين، لأن بعض المتصفحات بتحجب الـ cookies
//           أو الـ SameSite=Strict بيمنعها في بعض الحالات
// ================================================================
function hasSessionToken(request) {
  // 1. Cookie
  const cookieHeader = request.headers.get('cookie') || '';
  if (/(?:^|;\s*)admin_session=([^;]+)/.test(cookieHeader)) {
    return true;
  }

  // 2. Authorization: Bearer <token>
  const authHeader = request.headers.get('authorization') || '';
  if (/^Bearer\s+\S+/i.test(authHeader)) {
    return true;
  }

  return false;
}

// ================================================================
//  🚫 notFound — رد 404 موحد (إخفاء الوجود)
// ================================================================
function notFound() {
  return new Response(
    '<!DOCTYPE html><html><head><title>404</title></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding:60px;">' +
    '<h1>404</h1><p>الصفحة غير موجودة</p></body></html>',
    {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    }
  );
}

// ================================================================
//  🚀 middleware — الدالة الرئيسية
// ================================================================
export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // ─── 1. المسارات العامة (خارج الحماية) ───
  if (path.startsWith('/css/')) return undefined;
  if (path.startsWith('/js/')) return undefined;
  if (path.startsWith('/admin/css/')) return undefined;
  if (path.startsWith('/admin/js/')) return undefined;

  // ─── 2. Emergency unlock دايماً مسموح (لا يحتاج بوابة مفتوحة) ───
  if (path === '/admin/emergency-unlock.html') return undefined;

  // ─── 3. البوابة مقفولة → 404 لكل المسارات المحمية ───
  const panelOpen = await isPanelOpen();

  // ─── 4. حماية /admin/* ───
  if (path.startsWith('/admin')) {
    const hasToken = hasSessionToken(request);

    // ✅ القاعدة الجديدة:
    //   - البوابة مقفولة + مفيش cookie → 404 (منع دخول جديد)
    //   - البوابة مقفولة + فيه cookie  → مسموح (الجلسة النشطة مستمرة)
    //   - الصفحات العامة (login) → مسموحة دايماً
    //   - صفحة enter → تحتاج بوابة مفتوحة

    // 4أ. صفحة enter → تحتاج بوابة مفتوحة
    if (path === '/admin/enter.html') {
      if (!panelOpen) return notFound();
      return undefined;
    }

    // 4ب. صفحة login (index) → مسموحة دايماً
    if (PUBLIC_ADMIN_PAGES.includes(path)) {
      return undefined;
    }

    // 4ج. باقي الصفحات:
    //     لو فيه cookie → مسموح (حتى لو البوابة مقفولة)
    if (hasToken) {
      return undefined;
    }

    // 4د. مفيش cookie + البوابة مقفولة → 404 (إخفاء)
    if (!panelOpen) {
      return notFound();
    }

    // 4هـ. مفيش cookie + البوابة مفتوحة → redirect للـ login
    return Response.redirect(new URL('/admin/', request.url), 302);
  }

  // ─── 5. حماية /api?action=admin ───
  if (path === '/api') {
    const action = url.searchParams.get('action');
    if (action !== 'admin') return undefined;

    const inner = url.searchParams.get('innerAction') || '';
    const hasToken = hasSessionToken(request);

    // ✅ 5أ. Actions دايماً مسموحة (بغض النظر عن حالة البوابة)
    //  - verify/checkStatus : للتحقق من الجلسة الحالية + freeze polling
    //                          ⚠️ لا يجوز حجبها لأنها بتُستخدم للجلسات النشطة
    //  - health             : للمراقبة
    //  - initSuperAdmin     : للتهيئة الأولى
    //  - emergencyUnlock    : للطوارئ
    //  - requestPasswordChange / changePasswordWithToken / iDidntRequest
    //                        : من حالة freeze أو من البريد — لا علاقة بالبوابة
    const ALWAYS_ALLOWED_ACTIONS = [
      'verify',
      'checkStatus',
      'health',
      'initSuperAdmin',
      'emergencyUnlock',
      'requestPasswordChange',
      'changePasswordWithToken',
      'iDidntRequest'
    ];
    if (ALWAYS_ALLOWED_ACTIONS.includes(inner)) {
      return undefined;
    }

    // ✅ 5ب. عندك token صالح → مسموح (الجلسة النشطة مستمرة حتى لو البوابة مقفولة)
    if (hasToken) {
      return undefined;
    }

    // ─── من هنا: مفيش token ───

    // ✅ 5ج. Actions عامة (login, consumeLoginLink) — تحتاج البوابة مفتوحة
    if (PUBLIC_ADMIN_ACTIONS.includes(inner)) {
      if (!panelOpen) {
        return new Response(
          JSON.stringify({ success: false, error: 'panel_closed', message: 'اللوحة مقفولة مؤقتًا' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return undefined;
    }

    //     ب) مفيش cookie + البوابة مقفولة → 404
    if (!panelOpen) {
      return new Response(
        JSON.stringify({ success: false, error: 'panel_closed' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    //     - البوابة مفتوحة → نعدي للـ router (الـ router بيرجع 401 بنفسه)
    //     السبب: لو الـ middleware رجع 401، core.js بيعمل logout فوراً
    //             حتى لو المشكلة كانت مؤقتة (race condition / cookie issue)
    //             الـ router أذكى — بيرجع رسائل مفصّلة وبيراعي حالات الجلسة
    return undefined;
  }

  // ─── 6. الباقي → مرور عادي ───
  return undefined;
}

// ================================================================
//  ⚙️ Matcher + Runtime
//  - runtime: 'nodejs' → لتجنب تحذير Vercel (Edge runtime deprecated)
//  - matcher: المسارات اللي يشتغل عليها
// ================================================================
export const config = {
  runtime: 'nodejs',
  matcher: [
    '/admin/:path*',
    '/api'
  ]
};