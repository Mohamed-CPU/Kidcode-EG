// ================================================================
//  lib/db/email-templates.js — CRUD قوالب البريد + Seed
//  - getEmailTemplates / getEmailTemplateDetails
//  - createEmailTemplate / updateEmailTemplate / deleteEmailTemplate
//  - seedDefaultTemplates (6 قوالب جاهزة)
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES } from './tables.js';

// ============================================================
//  📋 getEmailTemplates — قائمة القوالب (بدون body_html)
// ============================================================
export async function getEmailTemplates(filters) {
  try {
    const f = filters || {};
    let query = supabaseAdmin
      .from(TABLES.EMAIL_TEMPLATES)
      .select('id,name,category,subject,is_active,created_by,created_at,updated_at')
      .order('created_at', { ascending: true });

    if (f.category) query = query.eq('category', f.category);
    if (f.activeOnly) query = query.eq('is_active', 'نعم');

    const { data, error } = await query;
    if (error) return { success: false, error: error.message };

    return { success: true, list: data || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔍 getEmailTemplateDetails — القالب كامل (مع body_html)
// ============================================================
export async function getEmailTemplateDetails(id) {
  try {
    const cleanId = parseInt(id, 10);
    if (!cleanId || cleanId <= 0) {
      return { success: false, error: 'invalid_id' };
    }

    const { data, error } = await supabaseAdmin
      .from(TABLES.EMAIL_TEMPLATES)
      .select('*')
      .eq('id', cleanId)
      .maybeSingle();

    if (error) return { success: false, error: error.message };
    if (!data) return { success: false, error: 'not_found' };

    return { success: true, template: data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  ➕ createEmailTemplate
// ============================================================
export async function createEmailTemplate(params) {
  try {
    const name = String(params.name || '').trim();
    const category = String(params.category || 'general').trim();
    const subject = String(params.subject || '').trim();
    const bodyHtml = String(params.bodyHtml || '').trim();
    const createdBy = String(params.createdBy || 'unknown').trim();

    if (!name) return { success: false, error: 'missing_name', message: 'اسم القالب مطلوب' };
    if (name.length > 80) return { success: false, error: 'name_too_long', message: 'اسم القالب طويل جدًا' };
    if (!bodyHtml) return { success: false, error: 'missing_body', message: 'محتوى القالب مطلوب' };

    // فحص الاسم
    const { data: existing } = await supabaseAdmin
      .from(TABLES.EMAIL_TEMPLATES)
      .select('id')
      .eq('name', name)
      .maybeSingle();

    if (existing) {
      return { success: false, error: 'name_exists', message: 'يوجد قالب بهذا الاسم بالفعل' };
    }

    const { data, error } = await supabaseAdmin
      .from(TABLES.EMAIL_TEMPLATES)
      .insert({
        name,
        category,
        subject,
        body_html: bodyHtml,
        is_active: 'نعم',
        created_by: createdBy
      })
      .select()
      .single();

    if (error) return { success: false, error: error.message };

    return { success: true, template: data, message: 'تم إنشاء القالب بنجاح' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  ✏️ updateEmailTemplate
// ============================================================
export async function updateEmailTemplate(params) {
  try {
    const cleanId = parseInt(params.id, 10);
    if (!cleanId || cleanId <= 0) {
      return { success: false, error: 'invalid_id' };
    }

    const raw = params.updates || {};
    const updates = {};

    if (raw.name !== undefined) {
      const name = String(raw.name).trim();
      if (!name) return { success: false, error: 'invalid_name' };

      const { data: existing } = await supabaseAdmin
        .from(TABLES.EMAIL_TEMPLATES)
        .select('id')
        .eq('name', name)
        .neq('id', cleanId)
        .maybeSingle();

      if (existing) return { success: false, error: 'name_exists' };
      updates.name = name;
    }
    if (raw.category !== undefined) updates.category = String(raw.category).trim();
    if (raw.subject !== undefined) updates.subject = String(raw.subject).trim();
    if (raw.bodyHtml !== undefined) {
      const bodyHtml = String(raw.bodyHtml).trim();
      if (!bodyHtml) return { success: false, error: 'invalid_body' };
      updates.body_html = bodyHtml;
    }
    if (raw.isActive !== undefined) {
      updates.is_active = raw.isActive ? 'نعم' : 'لا';
    }

    if (Object.keys(updates).length === 0) {
      return { success: true, message: 'لا توجد تغييرات' };
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from(TABLES.EMAIL_TEMPLATES)
      .update(updates)
      .eq('id', cleanId)
      .select()
      .single();

    if (error) return { success: false, error: error.message };

    return { success: true, template: data, message: 'تم التحديث بنجاح' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🗑️ deleteEmailTemplate
// ============================================================
export async function deleteEmailTemplate(params) {
  try {
    const cleanId = parseInt(params.id, 10);
    if (!cleanId || cleanId <= 0) {
      return { success: false, error: 'invalid_id' };
    }

    const { error } = await supabaseAdmin
      .from(TABLES.EMAIL_TEMPLATES)
      .delete()
      .eq('id', cleanId);

    if (error) return { success: false, error: error.message };
    return { success: true, message: 'تم حذف القالب' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🌱 seedDefaultTemplates — إدراج 6 قوالب افتراضية
//  - يُستدعى مرة واحدة عند أول فتح للصفحة
//  - لا يفعل شيئًا إذا كانت القوالب موجودة
// ============================================================
export async function seedDefaultTemplates() {
  try {
    const { count, error: countError } = await supabaseAdmin
      .from(TABLES.EMAIL_TEMPLATES)
      .select('id', { count: 'exact', head: true });

    if (countError) return { success: false, error: countError.message };
    if (count && count > 0) {
      return { success: true, message: 'already_seeded', count };
    }

    const defaults = buildDefaultTemplates();
    const { data, error } = await supabaseAdmin
      .from(TABLES.EMAIL_TEMPLATES)
      .insert(defaults)
      .select();

    if (error) return { success: false, error: error.message };

    console.log('✅ [seed] تم إدراج ' + (data ? data.length : 0) + ' قالب افتراضي');
    return { success: true, count: data ? data.length : 0 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📦 buildDefaultTemplates — القوالب الستة الجاهزة
//  جميعها: RTL + responsive + 13-14px + عربية فصحى
// ============================================================
function buildDefaultTemplates() {
  return [
    // 1) ترحيب
    {
      name: 'ترحيب بعميل جديد',
      category: 'welcome',
      subject: '🎉 مرحباً بك في كيدكود-إيجي',
      body_html: `<div dir="rtl" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;max-width:520px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#22559F,#1A437C);padding:24px 20px;text-align:center;border-radius:16px 16px 0 0;">
    <div style="font-size:11px;color:#A5C4E8;letter-spacing:2px;font-weight:700;margin-bottom:6px;">KIDCODE-EG</div>
    <div style="font-size:20px;color:#FFFFFF;font-weight:900;">🎉 مرحباً بك</div>
  </div>
  <div style="background:#FFFFFF;padding:22px;border-radius:0 0 16px 16px;border:1px solid #E2E8F0;border-top:none;">
    <p style="font-size:14px;color:#1E293B;font-weight:700;margin:0 0 12px;">عزيزي {name}،</p>
    <p style="font-size:13px;color:#475569;line-height:1.8;margin:0 0 16px;">
      يسعدنا أن نرحب بكم في <strong style="color:#22559F;">كيدكود-إيجي</strong>، المنصة المصرية الأولى لحماية وتتبع الأطفال بتقنية QR Code.
    </p>
    <div style="background:#EFF6FF;border-right:4px solid #22559F;border-radius:10px;padding:14px 16px;margin:14px 0;">
      <p style="margin:0 0 6px;font-size:12px;color:#1E3A8A;font-weight:800;">بيانات حسابكم:</p>
      <p style="margin:4px 0;font-size:12.5px;color:#1E3A8A;"><strong>الكود:</strong> <code style="background:#FFFFFF;padding:2px 8px;border-radius:4px;font-family:monospace;">{code}</code></p>
      <p style="margin:4px 0;font-size:12.5px;color:#1E3A8A;"><strong>البريد:</strong> {email}</p>
    </div>
    <p style="font-size:13px;color:#475569;line-height:1.8;margin:0 0 16px;">
      يمكنكم الآن الدخول إلى لوحة تحكم الأسرة وإدارة بيانات طفلكم بكل سهولة.
    </p>
    <div style="text-align:center;margin:20px 0;">
      <a href="https://www.kidcode-eg.com/family-login" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#22559F,#1A437C);color:#FFFFFF;text-decoration:none;border-radius:30px;font-size:13px;font-weight:900;">📊 دخول لوحة التحكم</a>
    </div>
    <hr style="border:0;border-top:1px solid #E2E8F0;margin:18px 0;">
    <p style="font-size:11.5px;color:#94A3B8;text-align:center;margin:0;">للتواصل: <a href="https://wa.me/201004135973" style="color:#22559F;text-decoration:none;font-weight:700;">واتساب الدعم</a></p>
  </div>
</div>`,
      created_by: 'system'
    },

    // 2) عرض ترويجي
    {
      name: 'عرض ترويجي',
      category: 'promotion',
      subject: '🎁 خصم حصري لفترة محدودة',
      body_html: `<div dir="rtl" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;max-width:520px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#F59E0B,#DC2626);padding:24px 20px;text-align:center;border-radius:16px 16px 0 0;">
    <div style="font-size:11px;color:#FEF3C7;letter-spacing:2px;font-weight:700;margin-bottom:6px;">عرض خاص</div>
    <div style="font-size:22px;color:#FFFFFF;font-weight:900;">🎁 خصم حصري</div>
  </div>
  <div style="background:#FFFFFF;padding:22px;border-radius:0 0 16px 16px;border:1px solid #E2E8F0;border-top:none;">
    <p style="font-size:14px;color:#1E293B;font-weight:700;margin:0 0 12px;">عزيزي {name}،</p>
    <p style="font-size:13px;color:#475569;line-height:1.8;margin:0 0 16px;">
      يسعدنا أن نقدم لكم عرضاً حصرياً لفترة محدودة على جميع باقات كيدكود-إيجي.
    </p>
    <div style="background:linear-gradient(135deg,#FEF3C7,#FDE68A);border-radius:12px;padding:20px;margin:16px 0;text-align:center;">
      <p style="margin:0 0 8px;font-size:12px;color:#92400E;font-weight:700;">خصم يصل إلى</p>
      <p style="margin:0;font-size:32px;font-weight:900;color:#DC2626;">20%</p>
    </div>
    <p style="font-size:13px;color:#475569;line-height:1.8;margin:0 0 16px;">
      استفد من العرض الآن قبل انتهاء المدة.
    </p>
    <div style="text-align:center;margin:20px 0;">
      <a href="https://www.kidcode-eg.com/reg" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#F59E0B,#DC2626);color:#FFFFFF;text-decoration:none;border-radius:30px;font-size:13px;font-weight:900;">🎯 اغتنم العرض الآن</a>
    </div>
    <hr style="border:0;border-top:1px solid #E2E8F0;margin:18px 0;">
    <p style="font-size:11.5px;color:#94A3B8;text-align:center;margin:0;">للاستفسار: <a href="https://wa.me/201004135973" style="color:#22559F;text-decoration:none;font-weight:700;">واتساب الدعم</a></p>
  </div>
</div>`,
      created_by: 'system'
    },

    // 3) إعلان ميزة جديدة
    {
      name: 'إعلان ميزة جديدة',
      category: 'announcement',
      subject: '✨ ميزة جديدة في كيدكود-إيجي',
      body_html: `<div dir="rtl" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;max-width:520px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#22559F,#1A437C);padding:24px 20px;text-align:center;border-radius:16px 16px 0 0;">
    <div style="font-size:11px;color:#A5C4E8;letter-spacing:2px;font-weight:700;margin-bottom:6px;">KIDCODE-EG</div>
    <div style="font-size:22px;color:#FFFFFF;font-weight:900;">✨ ميزة جديدة</div>
  </div>
  <div style="background:#FFFFFF;padding:22px;border-radius:0 0 16px 16px;border:1px solid #E2E8F0;border-top:none;">
    <p style="font-size:14px;color:#1E293B;font-weight:700;margin:0 0 12px;">عزيزي {name}،</p>
    <p style="font-size:13px;color:#475569;line-height:1.8;margin:0 0 16px;">
      يسعدنا أن نعلن لكم عن إطلاق ميزة جديدة في منصة كيدكود-إيجي، تهدف إلى تحسين تجربتكم وتسهيل استخدامكم للخدمة.
    </p>
    <div style="background:#ECFDF5;border-right:4px solid #10B981;border-radius:12px;padding:14px 16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-size:13px;color:#065F46;font-weight:900;">✨ ما الجديد؟</p>
      <p style="margin:0;font-size:12.5px;color:#047857;line-height:1.8;">[وصف الميزة الجديدة هنا]</p>
    </div>
    <div style="text-align:center;margin:20px 0;">
      <a href="https://www.kidcode-eg.com/family-login" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#22559F,#1A437C);color:#FFFFFF;text-decoration:none;border-radius:30px;font-size:13px;font-weight:900;">🔗 جرّب الميزة الآن</a>
    </div>
    <hr style="border:0;border-top:1px solid #E2E8F0;margin:18px 0;">
    <p style="font-size:11.5px;color:#94A3B8;text-align:center;margin:0;">مع تحيات فريق كيدكود-إيجي</p>
  </div>
</div>`,
      created_by: 'system'
    },

    // 4) تنبيه انتهاء اشتراك
    {
      name: 'تنبيه انتهاء اشتراك',
      category: 'expiry_reminder',
      subject: '⏰ اشتراكك على وشك الانتهاء',
      body_html: `<div dir="rtl" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;max-width:520px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#F59E0B,#92400E);padding:24px 20px;text-align:center;border-radius:16px 16px 0 0;">
    <div style="font-size:11px;color:#FEF3C7;letter-spacing:2px;font-weight:700;margin-bottom:6px;">تنبيه مهم</div>
    <div style="font-size:20px;color:#FFFFFF;font-weight:900;">⏰ اشتراكك على وشك الانتهاء</div>
  </div>
  <div style="background:#FFFFFF;padding:22px;border-radius:0 0 16px 16px;border:1px solid #E2E8F0;border-top:none;">
    <p style="font-size:14px;color:#1E293B;font-weight:700;margin:0 0 12px;">عزيزي {name}،</p>
    <p style="font-size:13px;color:#475569;line-height:1.8;margin:0 0 16px;">
      نود تذكيركم بأن اشتراك الطفل <strong style="color:#22559F;">{child_id}</strong> على وشك الانتهاء.
    </p>
    <div style="background:#FEF3C7;border-right:4px solid #F59E0B;border-radius:12px;padding:14px 16px;margin:16px 0;">
      <p style="margin:0;font-size:12.5px;color:#78350F;line-height:1.8;">
        <strong>⚠️ تنبيه:</strong> لضمان استمرار حماية طفلكم، يرجى تجديد الاشتراك قبل انتهاء المدة.
      </p>
    </div>
    <div style="text-align:center;margin:20px 0;">
      <a href="https://www.kidcode-eg.com/family-dashboard" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#F59E0B,#92400E);color:#FFFFFF;text-decoration:none;border-radius:30px;font-size:13px;font-weight:900;">🔄 جدّد الآن</a>
    </div>
    <hr style="border:0;border-top:1px solid #E2E8F0;margin:18px 0;">
    <p style="font-size:11.5px;color:#94A3B8;text-align:center;margin:0;">للاستفسار: <a href="https://wa.me/201004135973" style="color:#22559F;text-decoration:none;font-weight:700;">واتساب الدعم</a></p>
  </div>
</div>`,
      created_by: 'system'
    },

    // 5) إشعار أمني
    {
      name: 'إشعار أمني',
      category: 'security_alert',
      subject: '🔒 تنبيه أمني هام',
      body_html: `<div dir="rtl" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;max-width:520px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#DC2626,#991B1B);padding:24px 20px;text-align:center;border-radius:16px 16px 0 0;">
    <div style="font-size:11px;color:#FECACA;letter-spacing:2px;font-weight:700;margin-bottom:6px;">إشعار أمني</div>
    <div style="font-size:22px;color:#FFFFFF;font-weight:900;">🔒 تنبيه أمني هام</div>
  </div>
  <div style="background:#FFFFFF;padding:22px;border-radius:0 0 16px 16px;border:1px solid #E2E8F0;border-top:none;">
    <p style="font-size:14px;color:#1E293B;font-weight:700;margin:0 0 12px;">عزيزي {name}،</p>
    <p style="font-size:13px;color:#475569;line-height:1.8;margin:0 0 16px;">
      نود إبلاغكم بحدوث نشاط أمني على حسابكم، ونحرص على إعلامكم فوراً لضمان سلامتكم.
    </p>
    <div style="background:#FEF2F2;border-right:4px solid #DC2626;border-radius:12px;padding:14px 16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-size:13px;color:#991B1B;font-weight:900;">🚨 تفاصيل النشاط:</p>
      <p style="margin:0;font-size:12.5px;color:#7F1D1D;line-height:1.8;">[وصف النشاط الأمني هنا]</p>
    </div>
    <p style="font-size:13px;color:#475569;line-height:1.8;margin:0 0 16px;">
      إذا لم تقوموا بهذا النشاط، يرجى التواصل معنا فوراً.
    </p>
    <div style="text-align:center;margin:20px 0;">
      <a href="https://wa.me/201004135973" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#DC2626,#991B1B);color:#FFFFFF;text-decoration:none;border-radius:30px;font-size:13px;font-weight:900;">📞 تواصل مع الدعم</a>
    </div>
    <hr style="border:0;border-top:1px solid #E2E8F0;margin:18px 0;">
    <p style="font-size:11.5px;color:#94A3B8;text-align:center;margin:0;">مع تحيات فريق الأمان</p>
  </div>
</div>`,
      created_by: 'system'
    },

    // 6) تقرير دوري
    {
      name: 'تقرير دوري',
      category: 'report',
      subject: '📊 تقريرك الدوري من كيدكود-إيجي',
      body_html: `<div dir="rtl" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;max-width:520px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#22559F,#1A437C);padding:24px 20px;text-align:center;border-radius:16px 16px 0 0;">
    <div style="font-size:11px;color:#A5C4E8;letter-spacing:2px;font-weight:700;margin-bottom:6px;">KIDCODE-EG</div>
    <div style="font-size:22px;color:#FFFFFF;font-weight:900;">📊 تقريرك الدوري</div>
  </div>
  <div style="background:#FFFFFF;padding:22px;border-radius:0 0 16px 16px;border:1px solid #E2E8F0;border-top:none;">
    <p style="font-size:14px;color:#1E293B;font-weight:700;margin:0 0 12px;">عزيزي {name}،</p>
    <p style="font-size:13px;color:#475569;line-height:1.8;margin:0 0 16px;">
      نقدم لكم ملخص النشاط الأخير لحسابكم في منصة كيدكود-إيجي.
    </p>
    <div style="background:#EFF6FF;border-right:4px solid #22559F;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-size:13px;color:#1E3A8A;font-weight:900;">📈 ملخص الأداء:</p>
      <p style="margin:4px 0;font-size:12.5px;color:#1E3A8A;">• [البند الأول]</p>
      <p style="margin:4px 0;font-size:12.5px;color:#1E3A8A;">• [البند الثاني]</p>
      <p style="margin:4px 0;font-size:12.5px;color:#1E3A8A;">• [البند الثالث]</p>
    </div>
    <div style="text-align:center;margin:20px 0;">
      <a href="https://www.kidcode-eg.com/family-dashboard" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#22559F,#1A437C);color:#FFFFFF;text-decoration:none;border-radius:30px;font-size:13px;font-weight:900;">📊 فتح لوحة التحكم</a>
    </div>
    <hr style="border:0;border-top:1px solid #E2E8F0;margin:18px 0;">
    <p style="font-size:11.5px;color:#94A3B8;text-align:center;margin:0;">مع تحيات فريق كيدكود-إيجي</p>
  </div>
</div>`,
      created_by: 'system'
    }
  ];
}