// ================================================================
//  lib/cloudinary.js — تكامل Cloudinary (رفع/حذف/تحويل)
//  - fetch مباشر (بدون SDK)
//  - Signature SHA1 موثّق
//  - يدعم image + raw (PDF/Word/Excel)
// ================================================================

import crypto from 'crypto';

const CLOUDINARY_BASE = 'https://api.cloudinary.com/v1_1';

// ============================================================
//  🔧 getConfig — قراءة env vars
// ============================================================
function getConfig() {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();
  if (!cloudName || !apiKey || !apiSecret) {
    return null;
  }
  return { cloudName, apiKey, apiSecret };
}

// ============================================================
//  ✅ isCloudinaryConfigured — فحص عام
// ============================================================
export function isCloudinaryConfigured() {
  return getConfig() !== null;
}

// ============================================================
//  🔐 signParams — توليد signature (SHA1)
//  - المعاملات تُرتَّب أبجدياً
//  - تُدمج بـ & ثم يُضاف api_secret
//  - الناتج hex
// ============================================================
function signParams(params, apiSecret) {
  const sorted = Object.keys(params)
    .sort()
    .map(k => k + '=' + params[k])
    .join('&');
  return crypto.createHash('sha1').update(sorted + apiSecret).digest('hex');
}

// ============================================================
//  🎯 detectResourceType — تحديد نوع المورد
//  - صورة → image
//  - غير ذلك → raw (PDF/Word/Excel)
// ============================================================
export function detectResourceType(fileName, mimeType) {
  const name = String(fileName || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) {
    return 'image';
  }
  return 'raw';
}

// ============================================================
//  📤 uploadToCloudinary — رفع ملف
//  - base64 (data URL أو نص base64)
//  - يعيد { url, publicId, bytes, format, resourceType }
// ============================================================
export async function uploadToCloudinary({ base64, resourceType, fileName, folder, tags }) {
  try {
    const config = getConfig();
    if (!config) {
      console.error('[cloudinary] متغيرات البيئة ناقصة');
      return { success: false, error: 'cloudinary_config_missing' };
    }

    if (!base64) {
      return { success: false, error: 'missing_file' };
    }

    // 1. النوع
    const resource = resourceType === 'raw' ? 'raw' : 'image';

    // 2. المجلد الافتراضي
    const targetFolder = folder || (
      resource === 'image'
        ? 'kidcode/emails/images'
        : 'kidcode/emails/files'
    );

    // 3. public_id آمن
    let publicIdBase = '';
    if (fileName) {
      publicIdBase = String(fileName)
        .replace(/\.[^.]+$/, '')
        .replace(/[^\w-]/g, '_')
        .substring(0, 60);
    }
    
    // ✅ لو صور أطفال أو QR، نستخدم الاسم بس من غير suffix عشان نمنع التكرار
    const isFixedName = targetFolder.includes('children') || targetFolder.includes('qr_codes');
    let publicId;
    
    if (isFixedName && publicIdBase) {
      publicId = publicIdBase; // KC-31102
    } else {
      const uniqueSuffix = Date.now().toString(36);
      publicId = publicIdBase ? publicIdBase + '_' + uniqueSuffix : 'file_' + uniqueSuffix;
    }

    const timestamp = Math.floor(Date.now() / 1000);

    // 4. التواقيع
    const signedParams = {
      folder: targetFolder,
      public_id: publicId,
      timestamp
    };

    // ✅ لو الاسم ثابت، نضيف overwrite عشان نستبدل القديم
    if (isFixedName) {
      signedParams.overwrite = true;
    }
    if (tags) signedParams.tags = tags;

    const signature = signParams(signedParams, config.apiSecret);

    // 5. جسم الطلب
    // ✅ إضافة المقدمة لو مش موجودة عشان Cloudinary ميفتكرش إنه URL
    let fileData = String(base64);
    if (!fileData.startsWith('data:')) {
      fileData = 'data:image/jpeg;base64,' + fileData;
    }

    const body = {
      file: fileData,
      api_key: config.apiKey,
      timestamp,
      signature,
      folder: targetFolder,
      public_id: publicId
    };
    if (tags) body.tags = tags;
    if (isFixedName) body.overwrite = true; // ✅

    // 6. الإرسال
    const url = CLOUDINARY_BASE + '/' + config.cloudName + '/' + resource + '/upload';

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    let data = {};
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { __rawText: text.substring(0, 500) };
    }

    if (!response.ok) {
      console.error('[cloudinary] upload failed:', {
        status: response.status,
        error: data.error
      });
      return {
        success: false,
        error: (data.error && data.error.message) || 'upload_failed',
        status: response.status
      };
    }

    console.log('✅ [cloudinary] uploaded:', data.public_id, '(', data.bytes, 'bytes )');

    return {
      success: true,
      url: data.secure_url,
      publicId: data.public_id,
      bytes: data.bytes,
      format: data.format || '',
      resourceType: data.resource_type,
      originalName: fileName || ''
    };

  } catch (e) {
    console.error('[cloudinary] upload exception:', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🗑️ deleteFromCloudinary — حذف ملف
// ============================================================
export async function deleteFromCloudinary({ publicId, resourceType }) {
  try {
    const config = getConfig();
    if (!config) {
      return { success: false, error: 'cloudinary_config_missing' };
    }
    if (!publicId) {
      return { success: false, error: 'missing_public_id' };
    }

    const resource = resourceType === 'raw' ? 'raw' : 'image';
    const timestamp = Math.floor(Date.now() / 1000);

    const signedParams = { public_id: publicId, timestamp };
    const signature = signParams(signedParams, config.apiSecret);

    const url = CLOUDINARY_BASE + '/' + config.cloudName + '/' + resource + '/destroy';

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_id: publicId,
        api_key: config.apiKey,
        timestamp,
        signature
      })
    });

    const data = await response.json();

    if (!response.ok || data.result !== 'ok') {
      console.warn('[cloudinary] delete failed:', data.result || data.error);
      return { success: false, error: data.result || 'delete_failed' };
    }

    console.log('✅ [cloudinary] deleted:', publicId);
    return { success: true };

  } catch (e) {
    console.error('[cloudinary] delete exception:', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🖼️ buildOptimizedImageUrl — تحسين رابط الصورة
//  - يضيف w_, q_auto, f_auto تلقائياً
//  - إذا لم يكن Cloudinary URL → يعيد كما هو
// ============================================================
export function buildOptimizedImageUrl(url, width) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('/image/upload/')) return url;
  const w = parseInt(width, 10) || 600;
  return url.replace(
    '/image/upload/',
    '/image/upload/w_' + w + ',q_auto,f_auto/'
  );
}

// ============================================================
//  🔍 extractPublicId — استخراج public_id من رابط Cloudinary
//  مثال: https://res.cloudinary.com/.../upload/v123/kidcode/children/KC-1.jpg
//  الناتج: kidcode/children/KC-1
// ============================================================
export function extractPublicId(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.includes('cloudinary.com')) return null;
  
  const parts = url.split('/upload/');
  if (parts.length !== 2) return null;
  
  let path = parts[1];
  
  // إزالة رقم الإصدار لو موجود (زي v1794141365/)
  if (path.startsWith('v')) {
    const slashIndex = path.indexOf('/');
    if (slashIndex !== -1) {
      path = path.substring(slashIndex + 1);
    }
  }
  
  // إزالة الامتداد (زي .jpg أو .png)
  const dotIndex = path.lastIndexOf('.');
  if (dotIndex !== -1) {
    path = path.substring(0, dotIndex);
  }
  
  return path;
}