// ================================================================
//  lib/supabase.js — Supabase Clients
//  - supabaseAdmin: للـ Backend (Bypass RLS) ⚠️ سري جداً
//  - supabasePublic: للقراءات العامة (مع RLS)
//
//  ⚠️ Supabase 2026: keys جديدة
//  - Publishable key = بديل anon
//  - Secret key = بديل service_role
// ================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

// ✅ التحقق من وجود المتغيرات
const missingVars = [];
if (!SUPABASE_URL) missingVars.push('SUPABASE_URL');
if (!SUPABASE_PUBLISHABLE_KEY) missingVars.push('SUPABASE_PUBLISHABLE_KEY');
if (!SUPABASE_SECRET_KEY) missingVars.push('SUPABASE_SECRET_KEY');

if (missingVars.length > 0) {
  console.error('❌ [Supabase] Environment Variables ناقصة: ' + missingVars.join(', '));
  throw new Error('Supabase env vars missing: ' + missingVars.join(', '));
}

// ============================================================
//  Client للـ Backend — يتجاوز RLS
//  ⚠️ لا تستخدمه في الفرونت أبداً
// ============================================================
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  db: {
    schema: 'public',
  },
});

// ============================================================
//  Client للقراءات العامة (يخضع لـ RLS)
// ============================================================
export const supabasePublic = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  db: {
    schema: 'public',
  },
});

console.log('✅ [Supabase] Clients initialized');