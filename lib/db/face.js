// ================================================================
//  lib/db/face.js — منطق بصمة الوجه (Supabase + Vision API)
//  ⚠️ بعد Migration: FaceFeatures.created_at/updated_at = timestamptz
//  ✅ الكتابة: nowUTC() فقط
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN, COLS_FACE } from './tables.js';
import { sendFaceDataChangeEmail } from '../email/brevo.js';

// ============================================================
//  🕐 دوال الوقت
// ============================================================
function nowUTC() {
  // ⚠️ للكتابة في timestamptz — UTC ISO
  return new Date().toISOString();
}

// ============================================================
//  📸 extractFaceFeatures — استخراج المتجه من الصورة
//  يستخدم Google Cloud Vision API (FACE_DETECTION)
// ============================================================
export async function extractFaceFeatures(base64Image) {
  try {
    // 1. التحقق من المدخلات
    if (!base64Image) {
      return { success: false, error: 'الصورة مطلوبة' };
    }

    // 2. تنظيف base64 (إزالة prefix "data:image/...;base64,")
    let cleanBase64 = base64Image;
    if (base64Image.includes(',')) {
      cleanBase64 = base64Image.split(',')[1];
    }

    // 3. اقرأ مفتاح Vision API
    const apiKey = process.env.VISION_API_KEY;
    if (!apiKey) {
      console.error('❌ [extractFaceFeatures] VISION_API_KEY غير موجود');
      return { success: false, error: 'مفتاح Vision API غير موجود في Environment Variables' };
    }

    // 4. جهّز الـ payload
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
    const payload = {
      requests: [{
        image: { content: cleanBase64 },
        features: [{ type: 'FACE_DETECTION', maxResults: 10 }]
      }]
    };

    // 5. ابعت الطلب
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return { success: false, error: 'Vision API رد غير صالح' };
    }

    // 6. فحص الأخطاء
    if (!response.ok) {
      console.error(`❌ [Vision API] ${response.status}: ${responseText}`);
      return { success: false, error: `Vision API error: ${responseText}` };
    }

    if (!data.responses || data.responses.length === 0) {
      return { success: false, error: 'لم يتم العثور على أي وجه في الصورة' };
    }

    const faceData = data.responses[0];
    if (!faceData.faceAnnotations || faceData.faceAnnotations.length === 0) {
      return { success: false, error: 'لم يتم اكتشاف وجه في الصورة' };
    }

    const face = faceData.faceAnnotations[0];

    // ============================================================
    //  ✅ فحوصات الجودة الإضافية
    // ============================================================

    // 1. فحص عدد الوجوه (يجب ان يكون وجه واحد فقط)
    const faceCount = faceData.faceAnnotations.length;
    if (faceCount > 1) {
      return {
        success: false,
        error: `الصورة فيها ${faceCount} وجوه — يرجى استخدام صورة فيها وجه واحد فقط.`
      };
    }

    // 2. فحص دقة الـ landmarks
    const landmarkingConf = face.landmarkingConfidence || 0;
    if (landmarkingConf < 0.5) {
      return {
        success: false,
        error: 'جودة معالم الوجه منخفضة — يرجى استخدام صورة أوضح.'
      };
    }

    // 3. فحص الضبابية
    const blurred = String(face.blurredLikelihood || '').toUpperCase();
    if (blurred === 'LIKELY' || blurred === 'VERY_LIKELY') {
      return {
        success: false,
        error: 'الصورة ضبابية — يرجى استخدام صورة أوضح.'
      };
    }

    // 4. فحص الإضاءة
    const underExposed = String(face.underExposedLikelihood || '').toUpperCase();
    if (underExposed === 'LIKELY' || underExposed === 'VERY_LIKELY') {
      return {
        success: false,
        error: 'الصورة معتمة أو الإضاءة ضعيفة — يرجى استخدام صورة أوضح.'
      };
    }

    // 5. فحص غطاء الرأس
    const headwear = String(face.headwearLikelihood || '').toUpperCase();
    if (headwear === 'LIKELY' || headwear === 'VERY_LIKELY') {
      return {
        success: false,
        error: 'الوجه مغطى (قبعة/شال) — يرجى رفع أي غطاء عن الوجه.'
      };
    }

    // 6. فحص النظارة السوداء
    const darkGlasses = String(face.darkGlassesLikelihood || '').toUpperCase();
    if (darkGlasses === 'LIKELY' || darkGlasses === 'VERY_LIKELY') {
      return {
        success: false,
        error: 'توجد نظارة سوداء — يرجى إزالتها لرؤية العينين.'
      };
    }

    // 7. فحص زوايا الوجه
    const rollAngle = Math.abs(face.rollAngle || 0);
    const panAngle = Math.abs(face.panAngle || 0);
    const tiltAngle = Math.abs(face.tiltAngle || 0);

    if (rollAngle > 30 || panAngle > 30 || tiltAngle > 30) {
      return {
        success: false,
        error: 'الوجه مائل بزاوية كبيرة — يرجى النظر مباشرة للكاميرا.'
      };
    }

    // 8. استخراج المعالم
    const landmarks = face.landmarks || [];
    const landmarkMap = {};
    landmarks.forEach(lm => {
      landmarkMap[lm.type] = lm.position;
    });

    // 9. التحقق من النقاط المطلوبة
    const requiredPoints = [
      'LEFT_EYE', 'RIGHT_EYE', 'MIDPOINT_BETWEEN_EYES',
      'NOSE_TIP', 'MOUTH_CENTER', 'MOUTH_LEFT', 'MOUTH_RIGHT',
      'CHIN_GNATHION', 'FOREHEAD_GLABELLA'
    ];

    for (let point of requiredPoints) {
      if (!landmarkMap[point]) {
        return { success: false, error: `النقطة ${point} غير موجودة في معالم الوجه` };
      }
    }

    // 10. دالة حساب المسافة الإقليدية
    function distance(p1, p2) {
      return Math.sqrt(
        Math.pow(p1.x - p2.x, 2) +
        Math.pow(p1.y - p2.y, 2) +
        Math.pow(p1.z - p2.z, 2)
      );
    }

    const eyeLeft = landmarkMap['LEFT_EYE'];
    const eyeRight = landmarkMap['RIGHT_EYE'];
    const midEye = landmarkMap['MIDPOINT_BETWEEN_EYES'];
    const noseTip = landmarkMap['NOSE_TIP'];
    const mouthCenter = landmarkMap['MOUTH_CENTER'];
    const mouthLeft = landmarkMap['MOUTH_LEFT'];
    const mouthRight = landmarkMap['MOUTH_RIGHT'];
    const chin = landmarkMap['CHIN_GNATHION'];
    const forehead = landmarkMap['FOREHEAD_GLABELLA'];

    const distEyes = distance(eyeLeft, eyeRight);
    if (distEyes === 0) {
      return { success: false, error: 'المسافة بين العينين صفر، صورة غير صالحة' };
    }

    // 11. حساب المتجه (8 أبعاد)
    const d1 = distance(midEye, noseTip);
    const d2 = distance(noseTip, mouthCenter);
    const d3 = distance(mouthCenter, chin);
    const d4 = distance(midEye, forehead);
    const d5 = distance(mouthLeft, mouthRight);

    const v1 = d1 / distEyes;
    const v2 = d2 / distEyes;
    const v3 = d3 / distEyes;
    const v4 = d4 / distEyes;
    const v5 = d5 / distEyes;

    const v6 = face.rollAngle || 0;
    const v7 = face.panAngle || 0;
    const v8 = face.tiltAngle || 0;

    const featureVector = [v1, v2, v3, v4, v5, v6, v7, v8];

    // 12. رجّع النتيجة
    return {
      success: true,
      featureVector: featureVector,
      featureVectorJSON: JSON.stringify(featureVector),
      detectionConfidence: face.detectionConfidence || 0,
      landmarkingConfidence: face.landmarkingConfidence || 0,
      rollAngle: v6,
      panAngle: v7,
      tiltAngle: v8
    };

  } catch (err) {
    console.error(`❌ [extractFaceFeatures] ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  💾 saveFaceFeatures — حفظ/تحديث بصمة الوجه
//  ✅ created_at / updated_at = UTC ISO
// ============================================================
export async function saveFaceFeatures(params) {
  // 1. الباراميترز
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const base64Image = String(params.faceImage || '').trim();

  if (!cleanID || !base64Image) {
    return { success: false, error: 'childID والصورة مطلوبان' };
  }

  const t0 = Date.now();

  // 2. استخراج المتجه
  const extractResult = await extractFaceFeatures(base64Image);
  if (!extractResult.success) {
    return { success: false, error: `فشل استخراج المعالم: ${extractResult.error}` };
  }

  // 3. تحقق إن الطفل موجود
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(COLS_CHILDREN.child_id)
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [saveFaceFeatures] child read (${Date.now() - t0}ms)`, childError.message);
    return { success: false, error: childError.message };
  }
  if (!child) {
    return { success: false, error: 'الطفل غير موجود' };
  }

  // 4. شوف لو فيه صف موجود
  const { data: existingRow, error: readError } = await supabaseAdmin
    .from(TABLES.FACE_FEATURES)
    .select('child_id,created_at')
    .eq(COLS_FACE.child_id, cleanID)
    .maybeSingle();

  if (readError) {
    console.error(`❌ [saveFaceFeatures] face read (${Date.now() - t0}ms)`, readError.message);
    return { success: false, error: readError.message };
  }

  // ✅ UTC ISO — timestamptz يفهمها صح
  const now = nowUTC();

  // 5. INSERT أو UPDATE
  if (!existingRow) {
    // INSERT جديد
    const { error: insertError } = await supabaseAdmin
      .from(TABLES.FACE_FEATURES)
      .insert({
        child_id: cleanID,
        feature_vector: extractResult.featureVectorJSON,
        created_at: now,
        updated_at: now,
        is_active: 'نعم'
      });

    if (insertError) {
      console.error(`❌ [saveFaceFeatures] insert (${Date.now() - t0}ms)`, insertError.message);
      return { success: false, error: insertError.message };
    }

    console.log(`✅ [saveFaceFeatures] INSERT ${cleanID} (${Date.now() - t0}ms)`);
    return {
      success: true,
      message: 'تم إضافة البيانات بنجاح',
      featureVector: extractResult.featureVector,
      childID: cleanID,
      action: 'insert'
    };

  } else {
    // UPDATE
    const { error: updateError } = await supabaseAdmin
      .from(TABLES.FACE_FEATURES)
      .update({
        feature_vector: extractResult.featureVectorJSON,
        updated_at: now,
        is_active: 'نعم'
        // created_at يُحفظ كما هو
      })
      .eq(COLS_FACE.child_id, cleanID);

    if (updateError) {
      console.error(`❌ [saveFaceFeatures] update (${Date.now() - t0}ms)`, updateError.message);
      return { success: false, error: updateError.message };
    }

    console.log(`✅ [saveFaceFeatures] UPDATE ${cleanID} (${Date.now() - t0}ms)`);
    return {
      success: true,
      message: 'تم تحديث البيانات بنجاح',
      featureVector: extractResult.featureVector,
      childID: cleanID,
      action: 'update'
    };
  }
}

// ============================================================
//  💾 saveFaceFeaturesFromFamily — wrapper + إيميل إشعار
// ============================================================
export async function saveFaceFeaturesFromFamily(params) {
  const cleanID = String(params.childID || '').trim().toUpperCase();

  if (!cleanID) {
    return { success: false, error: 'بيانات غير كاملة' };
  }

  const t0 = Date.now();

  // 1. جيب الطفل (محتاجينه للإيميل)
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) return { success: false, error: childError.message };
  if (!child) return { success: false, error: 'الطفل غير موجود' };

  // 2. شوف لو فيه صف قديم (عشان نحدد نوع الإشعار)
  const { data: existingRow } = await supabaseAdmin
    .from(TABLES.FACE_FEATURES)
    .select('child_id')
    .eq(COLS_FACE.child_id, cleanID)
    .maybeSingle();

  const isExisting = !!existingRow;

  // 3. احفظ
  const result = await saveFaceFeatures(params);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  // 4. ابعت إيميل إشعار (best-effort)
  try {
    const changeType = isExisting ? 'update' : 'add';
    await sendFaceDataChangeEmail(child, changeType, 'تم تحديث بيانات الوجه بنجاح.');
  } catch (e) {
    console.error('⚠️ [saveFaceFeaturesFromFamily] email error:', e.message);
  }

  console.log(`✅ [saveFaceFeaturesFromFamily] ${cleanID} (${Date.now() - t0}ms)`);

  return {
    success: true,
    message: 'تم حفظ بيانات الوجه بنجاح',
    action: result.action
  };
}