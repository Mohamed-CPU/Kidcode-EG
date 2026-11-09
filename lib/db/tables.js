// ================================================================
//  lib/db/tables.js — خريطة أسماء الجداول والأعمدة في Supabase
//  ⚠️ كل الأعمدة lowercase (حسب تصدير CSV)
// ================================================================

// ============================================================
//  📋 أسماء الجداول
// ============================================================
export const TABLES = {
  CHILDREN:          'KidCode-eg',
  MARKETERS:         'MarketersUnified',
  TEMP_TOKENS:       'TempTokens',
  PENDING_LINKS:     'TelegramPendingLinks',
  DEMO_SESSIONS:     'DemoSessions',
  FACE_FEATURES:     'FaceFeatures',
  SCAN_LOGS:         'ScanLogs',
  MISSING_REPORTS:   'MissingReports',
  NEWSLETTER:        'NewsletterSubscribers',
  FAMILY_SESSIONS:   'FamilySessions',
  LOGIN_ATTEMPTS:    'LoginAttempts',
  FAMILY_RESET_TOKENS:      'FamilyResetTokens',
  PASSWORD_RESET_ATTEMPTS:  'PasswordResetAttempts',
  CHILD_EDIT_LOG:           'ChildEditLog',
  APP_CONFIG:               'AppConfig',
  UNLINK_OTPS:              'UnlinkOTPs',
  REVOKED_CHILD_IDS:        'RevokedChildIds',
  ADMINS:               'AdminAccounts',
  ADMIN_SESSIONS:       'AdminSessions',
  ADMIN_LOGIN_ATTEMPTS: 'AdminLoginAttempts',
  ADMIN_AUDIT_LOG:      'AdminAuditLog',
  ADMIN_PASSWORD_RESETS: 'AdminPasswordResets',
  ADMIN_LOGIN_LINKS:    'AdminLoginLinks',
  ADMIN_LINK_CODES:     'AdminLinkCodes',
  ADMIN_RECOVERY_CODES: 'AdminRecoveryCodes',
  EMAIL_CAMPAIGNS:      'EmailCampaigns',
  EMAIL_QUEUE:          'EmailQueue',
  EMAIL_TEMPLATES:      'EmailTemplates',
  PAYMENTS:             'Payments',
};

// ============================================================
//  📋 أعمدة جدول KidCode-eg (كلها lowercase)
// ============================================================
export const COLS_CHILDREN = {
  timestamp: 'timestamp',
  child_id: 'child_id',
  child_token: 'child_token',
  child_link: 'child_link',
  child_name: 'child_name',
  birth_date: 'birth_date',
  age: 'age',
  child_image_url: 'child_image_url',
  google_maps: 'google_maps',
  detailed_address: 'detailed_address',
  father_phone: 'father_phone',
  mother_name: 'mother_name',
  mother_phone: 'mother_phone',
  notes: 'notes',
  email_code: 'email_code',
  plan: 'plan',
  plan_price: 'plan_price',
  status: 'status',
  expiry_date: 'expiry_date',
  registration_date: 'registration_date',
  scan_count: 'scan_count',
  last_scan: 'last_scan',
  last_location: 'last_location',
  last_location_email_sent: 'last_location_email_sent',
  last_scan_email_sent: 'last_scan_email_sent',
  qr_code_pics: 'qr_code_pics',
  marketer_id: 'marketer_id',
  email_sent: 'email_sent',
  email_retry_count: 'email_retry_count',
  payment_status: 'payment_status',
  receipt_file_id: 'receipt_file_id',
  ocr_result: 'ocr_result',
  extracted_amount: 'extracted_amount',
  discount_percent: 'discount_percent',
  original_price: 'original_price',
  telegram_linked_at: 'telegram_linked_at',
  notification_method: 'notification_method',
  telegram_chat_id: 'telegram_chat_id',
  telegram_chat_id_father: 'telegram_chat_id_father',
  telegram_chat_id_mother: 'telegram_chat_id_mother',
  telegram_linked_at_father: 'telegram_linked_at_father',
  telegram_linked_at_mother: 'telegram_linked_at_mother',
  commission_notified: 'commission_notified',
  family_password_hash: 'family_password_hash',
  family_password_set_at: 'family_password_set_at',
  court_requested: 'court_requested',
};

// ============================================================
//  📋 أعمدة جدول MarketersUnified
// ============================================================
export const COLS_MARKETERS = {
  code: 'code',
  name: 'name',
  phone: 'phone',
  email: 'email',
  governorate: 'governorate',
  password_hash: 'password_hash',
  reset_token: 'reset_token',
  reset_token_expiry: 'reset_token_expiry',
  discount_percent: 'discount_percent',
  is_active: 'is_active',
  created_at: 'created_at',
  telegram_chat_id: 'telegram_chat_id',
  telegram_linked_at: 'telegram_linked_at',
  notification_method: 'notification_method',
};

// ============================================================
//  📋 أعمدة جدول FaceFeatures
// ============================================================
export const COLS_FACE = {
  child_id: 'child_id',
  feature_vector: 'feature_vector',
  created_at: 'created_at',
  updated_at: 'updated_at',
  is_active: 'is_active',
};

// ============================================================
//  📋 أعمدة جدول AppConfig
// ============================================================
export const COLS_APPCONFIG = {
  key: 'key',
  value: 'value',
  created_at: 'created_at',
};

// ============================================================
//  📋 أعمدة جدول EmailTemplates (✅ جديد)
// ============================================================
export const COLS_EMAIL_TEMPLATES = {
  id: 'id',
  name: 'name',
  category: 'category',
  subject: 'subject',
  body_html: 'body_html',
  is_active: 'is_active',
  created_by: 'created_by',
  created_at: 'created_at',
  updated_at: 'updated_at'
};