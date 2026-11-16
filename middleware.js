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
    cachedPanelOpen = false;
    cacheTimestamp = now;
    return false;
  }
}

// ================================================================
//  🎫 hasSessionToken — فحص وجود cookie أو Authorization header
// ================================================================
function hasSessionToken(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  if (/(?:^|;\s*)admin_session=([^;]+)/.test(cookieHeader)) {
    return true;
  }

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

    if (path === '/admin/enter.html') {
      if (!panelOpen) return notFound();
      return undefined;
    }

    if (PUBLIC_ADMIN_PAGES.includes(path)) {
      return undefined;
    }

    if (hasToken) {
      return undefined;
    }

    if (!panelOpen) {
      return notFound();
    }

    return Response.redirect(new URL('/admin/', request.url), 302);
  }

  // ─── 5. حماية /api?action=admin ───
  if (path === '/api') {
    const action = url.searchParams.get('action');
    if (action !== 'admin') return undefined;

    const inner = url.searchParams.get('innerAction') || '';
    const hasToken = hasSessionToken(request);

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

    if (hasToken) {
      return undefined;
    }

    if (PUBLIC_ADMIN_ACTIONS.includes(inner)) {
      if (!panelOpen) {
        return new Response(
          JSON.stringify({ success: false, error: 'panel_closed', message: 'اللوحة مقفولة مؤقتًا' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return undefined;
    }

    if (!panelOpen) {
      return new Response(
        JSON.stringify({ success: false, error: 'panel_closed' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return undefined;
  }

  // ─── 6. الباقي → مرور عادي ───
  return undefined;
}

// ================================================================
//  ⚙️ Matcher + Runtime
// ================================================================
export const config = {
  runtime: 'nodejs',
  matcher: [
    '/admin/:path*',
    '/api'
  ]
};