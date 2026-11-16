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

  // ✅ 0. منع الحلقة اللانهائية (Infinite Loop)
  // إذا كان الطلب قادماً من fetch داخل الـ middleware نفسه، نتجاهله
  if (request.headers.get('x-middleware-subrequest')) {
    return undefined;
  }

  // ✅ 1. توليد Nonce لكل طلب (باستخدام Web Crypto API)
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  
  // ✅ 2. إعداد ترويسة CORS ديناميكية
  const origin = request.headers.get('origin') || '';
  const isAllowedOrigin = origin === 'https://www.kidcode-eg.com' || origin === 'https://kidcode-eg.com' || origin.includes('localhost');
  const allowedOrigin = isAllowedOrigin ? origin : 'https://www.kidcode-eg.com';

  // ✅ 3. بناء سياسة CSP ديناميكية (بدون unsafe-inline)
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://www.googletagmanager.com https://www.google-analytics.com;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com;
    font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com;
    img-src 'self' data: https://res.cloudinary.com https://www.google-analytics.com https://www.googletagmanager.com;
    connect-src 'self' https://api.kidcode-eg.com https://www.google-analytics.com https://*.supabase.co;
    frame-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'self';
  `.replace(/\s{2,}/g, ' ').trim();

  // ✅ 4. دالة لحقن الـ nonce في صفحات الـ HTML قبل إرسالها للمتصفح
  const injectNonce = async (request, nonce, allowedOrigin, cspHeader) => {
    const fetchHeaders = new Headers(request.headers);
    // ✅ إضافة هذا الهيدر لتخطي الـ middleware أثناء جلب الصفحة الأصلية
    fetchHeaders.set('x-middleware-subrequest', '1');

    const response = await fetch(request.url, { headers: fetchHeaders });
    const contentType = response.headers.get('content-type') || '';
    
    // نطبق التعديل فقط على صفحات الـ HTML
    if (!contentType.includes('text/html')) {
      return response;
    }

    let html = await response.text();
    
    // نضيف الـ nonce لكل وسم <script> لا يحتوي عليه مسبقاً
    html = html.replace(/<script(?![^>]*nonce=)/g, `<script nonce="${nonce}"`);

    const newResponse = new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });

    newResponse.headers.set('Content-Security-Policy', cspHeader);
    newResponse.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    newResponse.headers.set('X-Content-Type-Options', 'nosniff');
    
    return newResponse;
  };

  // ─── 5. التعامل مع طلبات OPTIONS (CORS Preflight) ───
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // ─── 1. المسارات العامة (خارج الحماية) ───
  if (path.startsWith('/css/') || path.startsWith('/js/') || path.startsWith('/assets/')) return undefined;

  // ─── 2. Emergency unlock دايماً مسموح (لا يحتاج بوابة مفتوحة) ───
  if (path === '/admin/emergency-unlock.html') {
    return await injectNonce(request, nonce, allowedOrigin, cspHeader);
  }

  // ─── 3. البوابة مقفولة → 404 لكل المسارات المحمية ───
  const panelOpen = await isPanelOpen();

  // ─── 4. حماية /admin/* ───
  if (path.startsWith('/admin')) {
    const hasToken = hasSessionToken(request);

    // 4أ. صفحة enter → تحتاج بوابة مفتوحة
    if (path === '/admin/enter.html') {
      if (!panelOpen) return notFound();
      return await injectNonce(request, nonce, allowedOrigin, cspHeader);
    }

    // 4ب. صفحة login (index) → مسموحة دايماً
    if (PUBLIC_ADMIN_PAGES.includes(path)) {
      return await injectNonce(request, nonce, allowedOrigin, cspHeader);
    }

    // 4ج. باقي الصفحات:
    //     لو فيه cookie → مسموح (حتى لو البوابة مقفولة)
    if (hasToken) {
      return await injectNonce(request, nonce, allowedOrigin, cspHeader);
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

  // ─── 6. الباقي → مرور عادي (مع حقن الـ nonce للـ HTML) ───
  const acceptHeader = request.headers.get('accept') || '';
  if (acceptHeader.includes('text/html')) {
    return await injectNonce(request, nonce, allowedOrigin, cspHeader);
  }

  return undefined;
}

// ================================================================
//  ⚙️ Matcher + Runtime
// ================================================================
export const config = {
  runtime: 'nodejs',
  matcher: [
    '/((?!_next/static|_vercel|favicon.ico|assets|css|js|images|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)'
  ]
};