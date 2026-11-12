// ================================================================
//  marketer-dashboard.js - لوحة تحكم المسوق (2026-09-19)
//  مع دعم إشعارات تليجرام (QR + Open Telegram) زي الأسرة
// ================================================================

const Utils = window.Utils || {};

if (!window.Utils) {
    console.warn('⚠️ utils.js لم يتم تحميله، استخدام دوال احتياطية');
    window.Utils = {
        checkMarketerSession: function() {
            const code = localStorage.getItem('marketerCode');
            if (!code) {
                window.location.href = '/marketer-login';
                return null;
            }
            return code;
        },
        updateMarketerName: function() {
            const name = localStorage.getItem('marketerName');
            const nameEl = document.getElementById('marketerName');
            if (nameEl) {
                const code = localStorage.getItem('marketerCode') || '';
                nameEl.textContent = name ? 'مرحباً، ' + name : 'مرحباً، مسوق ' + code;
            }
        }
    };
}

// ============================================================
//  Marketer Telegram State
// ============================================================
let marketerTelegramStatus = {
    isLinked: false,
    chatId: null,
    linkedAt: null,
    notificationMethod: 'email'
};
let marketerTelegramPollingInterval = null;
let marketerCountdownInterval = null;
let marketerLinkExpiry = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('📌 marketer-dashboard.js تم تحميله');

    // ============================================================
    //  1. Session Check
    // ============================================================
    const code = (typeof Utils.checkMarketerSession === 'function')
        ? Utils.checkMarketerSession()
        : window.Utils.checkMarketerSession();

    if (!code) return;

    if (typeof Utils.updateMarketerName === 'function') {
        Utils.updateMarketerName();
    } else {
        window.Utils.updateMarketerName();
    }

    // ============================================================
    //  2. Logout
    // ============================================================
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            localStorage.removeItem('marketerCode');
            localStorage.removeItem('marketerName');
            window.location.href = '/marketer-login';
        });
    }

    // ============================================================
    //  3. Load Dashboard
    // ============================================================
    const loadingScreen = document.getElementById('loadingScreen');
    const statsGrid = document.getElementById('statsGrid');
    const ordersSection = document.getElementById('ordersSection');
    const totalChildrenEl = document.getElementById('totalChildren');
    const earnedCommissionEl = document.getElementById('earnedCommission');
    const pendingCommissionEl = document.getElementById('pendingCommission');
    const ordersBody = document.getElementById('ordersBody');

    async function loadDashboard() {
        try {
            const response = await fetch(`/api?action=marketer&innerAction=getMarketerStats&code=${encodeURIComponent(code)}`);
            const result = await response.json();

            loadingScreen.style.display = 'none';

            if (result.success) {
                const stats = result.stats;
                totalChildrenEl.textContent = stats.totalChildren;
                earnedCommissionEl.textContent = stats.totalEarnedCommission + ' ج.م';
                pendingCommissionEl.textContent = stats.totalPendingCommission + ' ج.م';
                statsGrid.style.display = 'grid';
                ordersSection.style.display = 'block';

                if (stats.orders && stats.orders.length > 0) {
                    let html = '';
                    stats.orders.forEach(order => {
                        const badgeClass = order.isEarned ? 'badge-earned' : 'badge-pending';
                        const badgeText = order.isEarned ? '✅ مستحق' : '⏳ معلق';
                        html += `
                            <tr>
                                <td><strong>${order.childID}</strong></td>
                                <td>${order.childName}</td>
                                <td>${order.plan}</td>
                                <td>${order.originalPrice}</td>
                                <td>${order.finalPrice}</td>
                                <td><strong>${order.commission}</strong></td>
                                <td>${order.registrationDate}</td>
                                <td>${order.daysAgo} يوم</td>
                                <td><span class="${badgeClass}">${badgeText}</span></td>
                            </tr>
                        `;
                    });
                    ordersBody.innerHTML = html;
                } else {
                    ordersBody.innerHTML = '<tr><td colspan="9" class="no-orders">لا توجد طلبات حتى الآن</td></tr>';
                }
            } else {
                alert('❌ فشل تحميل البيانات: ' + (result.error || 'خطأ غير معروف'));
            }
        } catch (err) {
            console.error('❌ خطأ في تحميل لوحة المسوق:', err);
            loadingScreen.style.display = 'none';
            statsGrid.style.display = 'grid';
            ordersSection.style.display = 'block';
            totalChildrenEl.textContent = '⚠️';
            earnedCommissionEl.textContent = '⚠️';
            pendingCommissionEl.textContent = '⚠️';
            ordersBody.innerHTML = '<tr><td colspan="9" class="no-orders">حدث خطأ في الاتصال</td></tr>';
        }
    }

    // ============================================================
    //  4. Delete Account
    // ============================================================
    const deleteBtn = document.getElementById('deleteAccountBtn');
    const deleteModal = document.getElementById('deleteConfirmModal');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const deleteInput = document.getElementById('deleteConfirmInput');
    const deleteMessage = document.getElementById('deleteMessage');

    if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
            deleteModal.style.display = 'flex';
            deleteInput.value = '';
            deleteMessage.className = 'message-box';
            deleteMessage.textContent = '';
            deleteMessage.style.display = 'none';
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> تأكيد الحذف';
        });
    }

    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', function() {
            deleteModal.style.display = 'none';
        });
    }

    if (deleteModal) {
        deleteModal.addEventListener('click', function(e) {
            if (e.target === deleteModal) deleteModal.style.display = 'none';
        });
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async function() {
            const codeLS = localStorage.getItem('marketerCode');
            const confirmText = deleteInput.value.trim().toUpperCase();

            if (confirmText !== 'DELETE') {
                deleteMessage.className = 'message-box error';
                deleteMessage.textContent = '⚠️ يرجى كتابة DELETE (أحرف كبيرة) للتأكيد.';
                deleteMessage.style.display = 'block';
                return;
            }

            confirmDeleteBtn.disabled = true;
            confirmDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحذف...';
            deleteMessage.style.display = 'none';

            try {
            const response = await fetch('/api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'marketerDeleteAccount',
                    code: codeLS,
                    confirm: 'DELETE'
                })
            });

                const result = await response.json();

                if (result.success) {
                    deleteMessage.className = 'message-box success';
                    deleteMessage.textContent = '✅ ' + result.message;
                    deleteMessage.style.display = 'block';
                    confirmDeleteBtn.innerHTML = '✅ تم الحذف';

                    setTimeout(() => {
                        localStorage.removeItem('marketerCode');
                        localStorage.removeItem('marketerName');
                        window.location.href = '/marketer-login';
                    }, 2500);
                } else {
                    deleteMessage.className = 'message-box error';
                    deleteMessage.textContent = '❌ ' + (result.error || 'حدث خطأ.');
                    deleteMessage.style.display = 'block';
                    confirmDeleteBtn.disabled = false;
                    confirmDeleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> تأكيد الحذف';
                }
            } catch (err) {
                deleteMessage.className = 'message-box error';
                deleteMessage.textContent = '⚠️ حدث خطأ في الاتصال.';
                deleteMessage.style.display = 'block';
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> تأكيد الحذف';
            }
        });
    }

    // ============================================================
    //  5. Telegram Functions
    // ============================================================

    const telegramBadge = document.getElementById('marketerTelegramBadge');
    const notLinkedView = document.getElementById('marketerNotLinkedView');
    const linkedView = document.getElementById('marketerLinkedView');
    const startLinkBtn = document.getElementById('marketerStartLinkBtn');
    const emailOnlyBtn = document.getElementById('marketerEmailOnlyBtn');
    const unlinkBtn = document.getElementById('marketerUnlinkBtn');
    const telegramMsg = document.getElementById('marketerTelegramMessage');
    const chatDetail = document.getElementById('marketerChatDetail');
    const sinceDetail = document.getElementById('marketerSinceDetail');
    const methodTelegramRadio = document.getElementById('marketerMethodTelegram');
    const methodEmailRadio = document.getElementById('marketerMethodEmail');

    // Modal elements
    const linkModal = document.getElementById('marketerTelegramLinkModal');
    const closeLinkModalBtn = document.getElementById('marketerCloseLinkModalBtn');
    const qrImage = document.getElementById('marketerQrImage');
    const qrLoading = document.getElementById('marketerQrLoading');
    const openTelegramLink = document.getElementById('marketerOpenTelegramLink');
    const linkingStatusText = document.getElementById('marketerLinkingStatusText');
    const countdownEl = document.getElementById('marketerLinkCountdown');
    const linkErrorBox = document.getElementById('marketerTelegramLinkError');

    // ✅ تحميل حالة الربط
    async function loadMarketerTelegramStatus() {
        try {
            const response = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'getMarketerTelegramStatus',
                    marketerCode: code
                })
            });

            const data = await response.json();
            console.log('📩 getMarketerTelegramStatus:', data);

            if (!data.success) {
                telegramBadge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> خطأ';
                telegramBadge.style.background = '#fee2e2';
                telegramBadge.style.color = 'var(--danger-color)';
                return;
            }

            marketerTelegramStatus = {
                isLinked: data.isLinked,
                chatId: data.chatId,
                linkedAt: data.linkedAt,
                notificationMethod: data.notificationMethod || 'email'
            };

            if (data.isLinked) {
                // ===== مربوط =====
                telegramBadge.innerHTML = '<i class="fas fa-check-circle"></i> مربوط';
                telegramBadge.style.background = '#e8f5ee';
                telegramBadge.style.color = 'var(--secondary-dark)';

                notLinkedView.style.display = 'none';
                linkedView.style.display = 'block';

                const masked = data.chatId
                    ? data.chatId.toString().replace(/(\d{4})\d+(\d{3})/, '$1***$2')
                    : '*******';
                chatDetail.textContent = 'Chat ID: ' + masked;

                if (data.linkedAt) {
                    sinceDetail.textContent = 'منذ: ' + formatShortDate(data.linkedAt);
                }

                if (data.notificationMethod === 'telegram') methodTelegramRadio.checked = true;
                else methodEmailRadio.checked = true;
            } else {
                // ===== غير مربوط =====
                if (data.notificationMethod === 'telegram') {
                    telegramBadge.innerHTML = '<i class="fas fa-hourglass-half"></i> بانتظار الربط';
                    telegramBadge.style.background = '#fef3c7';
                    telegramBadge.style.color = '#92400e';
                } else {
                    telegramBadge.innerHTML = '<i class="fas fa-envelope"></i> البريد';
                    telegramBadge.style.background = '#f3f4f6';
                    telegramBadge.style.color = 'var(--text-secondary)';
                }

                notLinkedView.style.display = 'block';
                linkedView.style.display = 'none';
            }
        } catch (err) {
            console.error('❌ loadMarketerTelegramStatus:', err);
            telegramBadge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> خطأ';
        }
    }

function formatShortDate(dateStr) {
    if (!dateStr) return '--';

    // ✅ صيغة عربية موحدة: "الأربعاء، 11 نوفمبر 2026"
    if (window.Utils && typeof Utils.formatCairoDate === 'function') {
        try {
            const formatted = Utils.formatCairoDate(dateStr);
            if (formatted && formatted !== String(dateStr)) return formatted;
        } catch (e) {}
    }

    // Fallback: صيغة مختصرة (بدون يوم الأسبوع)
    try {
        const parts = Utils.getCairoTimeParts(dateStr);
        if (!parts) return String(dateStr);

        // ✅ نفس قائمة Utils (بدون همزات)
        const months = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو',
                        'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];
        const d = parseInt(parts.day, 10);
        const m = parseInt(parts.month, 10) - 1;
        const y = parts.year;
        return `${d} ${months[m]} ${y}`;
    } catch (e) {}
    return String(dateStr);
}

    // ✅ بدء الربط
    async function startMarketerTelegramLink() {
        if (startLinkBtn) {
            startLinkBtn.disabled = true;
            startLinkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحضير...';
        }

        try {
            const response = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'generateMarketerLinkToken',
                    marketerCode: code
                })
            });

            const data = await response.json();
            console.log('📩 generateMarketerLinkToken:', data);

            if (!data.success) {
                if (data.error === 'already_linked') {
                    alert('⚠️ ' + (data.message || 'حسابك مربوط بالفعل'));
                    await loadMarketerTelegramStatus();
                } else {
                    alert('❌ ' + (data.message || data.error || 'فشل توليد الرابط'));
                }
                return;
            }

            showMarketerTelegramModal(data.deepLink, data.expiresAt);
        } catch (err) {
            console.error('❌ startMarketerTelegramLink:', err);
            alert('⚠️ خطأ في الاتصال');
        } finally {
            if (startLinkBtn) {
                startLinkBtn.disabled = false;
                startLinkBtn.innerHTML = '<i class="fab fa-telegram"></i> ربط تليجرام الآن';
            }
        }
    }

    // ✅ عرض Modal
    function showMarketerTelegramModal(deepLink, expiresAt) {
        if (!linkModal) return;

        linkErrorBox.style.display = 'none';
        qrImage.style.display = 'none';
        qrLoading.style.display = 'block';
        linkingStatusText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> في انتظار الربط...';

        openTelegramLink.href = deepLink;
        openTelegramLink.style.display = 'flex';

        // QR Code
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(deepLink)}`;
        qrImage.onload = () => {
            qrLoading.style.display = 'none';
            qrImage.style.display = 'block';
        };
        qrImage.onerror = () => {
            qrLoading.innerHTML = '<p style="color: var(--danger-color);">⚠️ فشل تحميل QR</p>';
        };
        qrImage.src = qrUrl;

        linkModal.style.display = 'flex';
        linkModal.classList.add('show');

        marketerLinkExpiry = new Date(expiresAt).getTime();
        startMarketerCountdown();
        startMarketerPolling();
    }

    // ✅ العد التنازلي
    function startMarketerCountdown() {
        if (marketerCountdownInterval) clearInterval(marketerCountdownInterval);

        function tick() {
            const remaining = marketerLinkExpiry - Date.now();
            if (remaining <= 0) {
                countdownEl.textContent = '00:00';
                clearInterval(marketerCountdownInterval);
                marketerCountdownInterval = null;
                stopMarketerPolling();
                linkingStatusText.innerHTML = '<span style="color: var(--danger-color);">⏰ انتهت صلاحية الرابط</span>';
                return;
            }
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            countdownEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
        }
        tick();
        marketerCountdownInterval = setInterval(tick, 1000);
    }

    // ✅ Polling
    function startMarketerPolling() {
        stopMarketerPolling();
        marketerTelegramPollingInterval = setInterval(async () => {
            try {
                const response = await fetch('/api?action=telegram', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        innerAction: 'getMarketerTelegramStatus',
                        marketerCode: code
                    })
                });
                const data = await response.json();

                if (data.success && data.isLinked) {
                    stopMarketerPolling();
                    if (marketerCountdownInterval) clearInterval(marketerCountdownInterval);

                    linkingStatusText.innerHTML = '<span style="color: var(--secondary-color); font-size: 1.1rem;">✅ تم الربط بنجاح!</span>';

                    setTimeout(async () => {
                        closeMarketerTelegramModal();
                        await loadMarketerTelegramStatus();

                        if (telegramMsg) {
                            telegramMsg.className = 'message success';
                            telegramMsg.textContent = '✅ تم ربط حسابك بتليجرام بنجاح!';
                            telegramMsg.style.display = 'block';
                            setTimeout(() => { telegramMsg.style.display = 'none'; }, 5000);
                        }
                    }, 1200);
                }
            } catch (err) {
                console.warn('⚠️ polling error:', err);
            }
        }, 3000);
    }

    function stopMarketerPolling() {
        if (marketerTelegramPollingInterval) {
            clearInterval(marketerTelegramPollingInterval);
            marketerTelegramPollingInterval = null;
        }
    }

    function closeMarketerTelegramModal() {
        if (linkModal) {
            linkModal.classList.remove('show');
            linkModal.style.display = 'none';
        }
        stopMarketerPolling();
        if (marketerCountdownInterval) {
            clearInterval(marketerCountdownInterval);
            marketerCountdownInterval = null;
        }
    }

    // ✅ فك الربط
    async function unlinkMarketerTelegram() {
        const confirmed = confirm(
            '⚠️ هل أنت متأكد من فك الربط؟\n\n' +
            'لن تتمكن من استقبال الإشعارات عبر تليجرام حتى تعيد الربط.\n' +
            'ستستمر في استقبال الإشعارات عبر البريد الإلكتروني.'
        );
        if (!confirmed) return;

        if (unlinkBtn) {
            unlinkBtn.disabled = true;
            unlinkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري فك الربط...';
        }

        try {
            const response = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'unlinkMarketerTelegram',
                    marketerCode: code
                })
            });

            const data = await response.json();

            if (data.success) {
                if (telegramMsg) {
                    telegramMsg.className = 'message success';
                    telegramMsg.textContent = '✅ ' + (data.message || 'تم فك الربط');
                    telegramMsg.style.display = 'block';
                }
                await loadMarketerTelegramStatus();
                setTimeout(() => { if (telegramMsg) telegramMsg.style.display = 'none'; }, 5000);
            } else {
                alert('❌ ' + (data.error || 'فشل فك الربط'));
            }
        } catch (err) {
            console.error('❌ unlinkMarketerTelegram:', err);
            alert('⚠️ خطأ في الاتصال');
        } finally {
            if (unlinkBtn) {
                unlinkBtn.disabled = false;
                unlinkBtn.innerHTML = '<i class="fas fa-unlink"></i> فك الربط';
            }
        }
    }

    // ✅ تغيير طريقة الإشعارات
    async function changeMarketerNotificationMethod(newMethod) {
        try {
            const response = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'setMarketerNotificationMethod',
                    marketerCode: code,
                    method: newMethod
                })
            });

            const data = await response.json();

            if (data.success) {
                marketerTelegramStatus.notificationMethod = newMethod;
                if (telegramMsg) {
                    telegramMsg.className = 'message success';
                    telegramMsg.textContent = newMethod === 'telegram'
                        ? '✅ سيتم استقبال الإشعارات عبر تليجرام'
                        : '✅ سيتم استقبال الإشعارات عبر البريد الإلكتروني';
                    telegramMsg.style.display = 'block';
                    setTimeout(() => { telegramMsg.style.display = 'none'; }, 4000);
                }
            } else {
                if (telegramMsg) {
                    telegramMsg.className = 'message error';
                    telegramMsg.textContent = '❌ ' + (data.error || 'فشل التحديث');
                    telegramMsg.style.display = 'block';
                }
                // رجع الاختيار
                if (marketerTelegramStatus.notificationMethod === 'telegram') methodTelegramRadio.checked = true;
                else methodEmailRadio.checked = true;
            }
        } catch (err) {
            console.error('❌ changeMarketerNotificationMethod:', err);
        }
    }

    // "المتابعة بالإيميل فقط"
    function switchToEmailOnly() {
        const confirmed = confirm(
            'سيتم استقبال الإشعارات على بريدك الإلكتروني.\n\n' +
            'يمكنك تفعيل تليجرام لاحقاً من هذه الصفحة في أي وقت.\n\n' +
            'هل تريد المتابعة؟'
        );
        if (!confirmed) return;

        if (notLinkedView) {
            notLinkedView.innerHTML = `
                <div class="telegram-benefits-box" style="background: #f3f4f6; border-right-color: var(--text-secondary);">
                    <p class="benefits-title" style="color: var(--text-primary);">✉️ وضع البريد الإلكتروني مفعّل</p>
                    <ul>
                        <li>ستصلك الإشعارات على بريدك المسجل</li>
                        <li>يمكنك تفعيل تليجرام في أي وقت</li>
                    </ul>
                </div>
                <button id="marketerReenableBtn" class="btn btn-primary btn-block" style="margin-top: 12px;">
                    <i class="fab fa-telegram"></i> تفعيل الإشعارات عبر تليجرام
                </button>
            `;
            document.getElementById('marketerReenableBtn').addEventListener('click', () => location.reload());
        }
        if (telegramBadge) {
            telegramBadge.innerHTML = '<i class="fas fa-envelope"></i> البريد';
            telegramBadge.style.background = '#f3f4f6';
            telegramBadge.style.color = 'var(--text-secondary)';
        }
    }

    // ============================================================
    //  Event Listeners — Telegram
    // ============================================================
    if (startLinkBtn) startLinkBtn.addEventListener('click', startMarketerTelegramLink);
    if (unlinkBtn) unlinkBtn.addEventListener('click', unlinkMarketerTelegram);
    if (emailOnlyBtn) emailOnlyBtn.addEventListener('click', switchToEmailOnly);
    if (closeLinkModalBtn) closeLinkModalBtn.addEventListener('click', closeMarketerTelegramModal);

    if (linkModal) {
        linkModal.addEventListener('click', function(e) {
            if (e.target === this) closeMarketerTelegramModal();
        });
    }

    if (methodTelegramRadio) {
        methodTelegramRadio.addEventListener('change', function() {
            if (this.checked) changeMarketerNotificationMethod('telegram');
        });
    }
    if (methodEmailRadio) {
        methodEmailRadio.addEventListener('change', function() {
            if (this.checked) changeMarketerNotificationMethod('email');
        });
    }

    // ============================================================
    //  6. Load All Data
    // ============================================================
    loadDashboard();
    loadMarketerTelegramStatus();

    // 🆕 Expose functions for reload buttons (IIFE #2)
    window.MD = {
        loadDashboard: loadDashboard,
        loadMarketerTelegramStatus: loadMarketerTelegramStatus
    };

    // ============================================================
    //  7. Deep Link: ?open=notifications
    // ============================================================
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('open') === 'notifications') {
        setTimeout(() => {
            const telegramSection = document.getElementById('telegramSection');
            if (telegramSection) {
                telegramSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            // فتح Modal الربط تلقائياً
            setTimeout(() => {
                startMarketerTelegramLink();
            }, 800);
        }, 500);
    }

        // ============================================================
    //  8. Referral Link + QR
    // ============================================================
    initReferralLink();

    function initReferralLink() {
        const marketerCode = localStorage.getItem('marketerCode');
        if (!marketerCode) return;

        const refLink = window.location.origin + '/reg.html?ref=' + encodeURIComponent(marketerCode);
        const refLinkInput = document.getElementById('marketerRefLink');
        const copyBtn = document.getElementById('copyRefLinkBtn');
        const shareBtn = document.getElementById('shareRefLinkBtn');
        const showQrBtn = document.getElementById('showRefQrBtn');
        const qrModal = document.getElementById('refQrModal');
        const closeQrBtn = document.getElementById('closeRefQrBtn');
        const qrImageContainer = document.getElementById('refQrImage');
        const qrCodeText = document.getElementById('refQrCodeText');
        const downloadQrBtn = document.getElementById('downloadRefQrBtn');

        if (refLinkInput) refLinkInput.value = refLink;
        if (qrCodeText) qrCodeText.textContent = marketerCode;

        // نسخ
        if (copyBtn) {
            copyBtn.addEventListener('click', function() {
                copyToClipboardSimple(refLink);
                copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                copyBtn.style.background = '#10B981';
                copyBtn.style.color = '#FFFFFF';
                setTimeout(function() {
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
                    copyBtn.style.background = '';
                    copyBtn.style.color = '';
                }, 2000);
            });
        }

        // مشاركة
        if (shareBtn) {
            shareBtn.addEventListener('click', async function() {
                const shareText = 'سجل طفلك في KidCode-EG واحصل على خصم مع كودي: ' + marketerCode + '\n' + refLink;

                if (navigator.share) {
                    try {
                        await navigator.share({
                            title: 'KidCode-EG',
                            text: 'سجل طفلك في KidCode-EG واحصل على خصم',
                            url: refLink
                        });
                    } catch (e) {
                        // المستخدم ألغى — صامت
                    }
                } else {
                    copyToClipboardSimple(shareText);
                    alert('✅ تم نسخ الرابط والنص — شاركهما على واتساب أو فيسبوك أو أي تطبيق');
                }
            });
        }

        // عرض QR
        if (showQrBtn) {
            showQrBtn.addEventListener('click', function() {
                const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(refLink);

                qrImageContainer.innerHTML = '<img src="' + qrUrl + '" alt="QR Code" style="max-width: 280px; width: 100%; border-radius: 12px; border: 2px solid var(--secondary-color); padding: 8px; background: white;">';
                qrModal.style.display = 'flex';
                qrModal.classList.add('show');
            });
        }

        // إغلاق QR
        if (closeQrBtn) {
            closeQrBtn.addEventListener('click', function() {
                qrModal.style.display = 'none';
                qrModal.classList.remove('show');
            });
        }
        if (qrModal) {
            qrModal.addEventListener('click', function(e) {
                if (e.target === qrModal) {
                    qrModal.style.display = 'none';
                    qrModal.classList.remove('show');
                }
            });
        }

        // تحميل QR
        if (downloadQrBtn) {
            downloadQrBtn.addEventListener('click', async function() {
                const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=' + encodeURIComponent(refLink);
                try {
                    const response = await fetch(qrUrl);
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = marketerCode + '_qr.png';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (e) {
                    alert('⚠️ تعذر تحميل QR. يمكنك أخذ لقطة شاشة بدلاً من ذلك.');
                }
            });
        }
    }

    // نسخ بسيط
    function copyToClipboardSimple(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function() { fallbackCopySimple(text); });
        } else {
            fallbackCopySimple(text);
        }
    }
    function fallbackCopySimple(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }

    console.log('✅ marketer-dashboard.js جاهز');
});

// ================================================================
//  🆕 TABS + WITHDRAW + CHANGE PASSWORD + DELETE WARNINGS
//  (يُضاف بعد نهاية كود الملف الحالي — لا يحذف أي شيء)
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  Helpers
    // ============================================================
    function getMarketerCode() {
        try { return localStorage.getItem('marketerCode') || ''; } catch (e) { return ''; }
    }
    function getMarketerName() {
        try { return localStorage.getItem('marketerName') || ''; } catch (e) { return ''; }
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
    function readNumberFromEl(id) {
        const el = document.getElementById(id);
        if (!el) return 0;
        const raw = (el.textContent || '').replace(/[^\d.]/g, '');
        const num = parseFloat(raw);
        return isNaN(num) ? 0 : num;
    }
    function showMessage(el, type, text) {
        if (!el) return;
        el.className = 'md-message ' + type;
        el.textContent = text;
        el.style.display = 'block';
    }
    function hideMessage(el) {
        if (!el) return;
        el.style.display = 'none';
        el.textContent = '';
    }

    // ============================================================
    //  1. Tabs + Sidebar
    // ============================================================
    const VALID_TABS = ['children', 'notifications', 'referral', 'withdraw', 'settings'];

    function openSidebar() {
        const sidebar = document.getElementById('mdSidebar');
        const overlay = document.getElementById('mdOverlay');
        if (sidebar) sidebar.classList.add('open');
        if (overlay) overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        const sidebar = document.getElementById('mdSidebar');
        const overlay = document.getElementById('mdOverlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.style.overflow = '';
    }

    function switchTab(tabName, updateHash) {
        if (VALID_TABS.indexOf(tabName) === -1) tabName = 'children';

        // Nav buttons
        document.querySelectorAll('.md-tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });

        // Panels
        document.querySelectorAll('.md-tab-panel').forEach(function(panel) {
            panel.classList.toggle('active', panel.getAttribute('data-tab') === tabName);
        });

        // Mobile title
        const currentBtn = document.querySelector('.md-tab-btn[data-tab="' + tabName + '"]');
        const mobileTitle = document.getElementById('mdMobileTitle');
        if (mobileTitle && currentBtn) {
            const span = currentBtn.querySelector('span');
            if (span) mobileTitle.textContent = span.textContent;
        }

        // Hash
        if (updateHash !== false) {
            try { history.replaceState(null, '', '#' + tabName); } catch (e) {}
        }

        // Close sidebar (mobile)
        closeSidebar();

        // Per-tab hooks
        if (tabName === 'withdraw') {
            setTimeout(refreshWithdrawData, 50);
        } else if (tabName === 'settings') {
            setTimeout(refreshChannelInfo, 50);
        }
    }

    function initTabs() {
        document.querySelectorAll('.md-tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                switchTab(btn.getAttribute('data-tab'));
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });

        const initialTab = (window.location.hash || '').replace('#', '');
        if (initialTab && VALID_TABS.indexOf(initialTab) !== -1) {
            switchTab(initialTab, false);
        }

        window.addEventListener('hashchange', function() {
            const hashTab = (window.location.hash || '').replace('#', '');
            if (hashTab && VALID_TABS.indexOf(hashTab) !== -1) {
                switchTab(hashTab, false);
            }
        });
    }

    function initSidebarToggle() {
        const hamburger = document.getElementById('mdHamburgerBtn');
        const overlay = document.getElementById('mdOverlay');

        if (hamburger) {
            hamburger.addEventListener('click', function() {
                const sidebar = document.getElementById('mdSidebar');
                if (sidebar && sidebar.classList.contains('open')) {
                    closeSidebar();
                } else {
                    openSidebar();
                }
            });
        }

        if (overlay) {
            overlay.addEventListener('click', closeSidebar);
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeSidebar();
        });

        window.addEventListener('resize', function() {
            if (window.innerWidth > 768) closeSidebar();
        });
    }

    function initReloadButtons() {
        const handlers = {
            reloadChildrenBtn: async function() {
                if (window.MD && window.MD.loadDashboard) {
                    await window.MD.loadDashboard();
                }
            },
            reloadNotificationsBtn: async function() {
                if (window.MD && window.MD.loadMarketerTelegramStatus) {
                    await window.MD.loadMarketerTelegramStatus();
                }
            },
            reloadReferralBtn: async function() {
                const refInput = document.getElementById('marketerRefLink');
                const code = getMarketerCode();
                if (refInput && code) {
                    refInput.value = window.location.origin + '/reg.html?ref=' + encodeURIComponent(code);
                }
            },
            reloadWithdrawBtn: async function() {
                refreshWithdrawData();
            },
            reloadSettingsBtn: async function() {
                await refreshChannelInfo();
            }
        };

        Object.keys(handlers).forEach(function(id) {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', async function() {
                if (btn.disabled) return;
                btn.disabled = true;
                btn.classList.add('loading');
                try {
                    await handlers[id]();
                } catch (e) {
                    console.warn('⚠️ Reload error:', e);
                } finally {
                    setTimeout(function() {
                        btn.disabled = false;
                        btn.classList.remove('loading');
                    }, 400);
                }
            });
        });
    }

    // ============================================================
    //  2. Withdraw
    // ============================================================
    function refreshWithdrawData() {
        const code = getMarketerCode();
        const name = getMarketerName();

        const codeInput = document.getElementById('withdrawCode');
        const nameInput = document.getElementById('withdrawName');
        if (codeInput) codeInput.value = code;
        if (nameInput) nameInput.value = name;

        // Max = earned commission (from Children tab)
        const max = readNumberFromEl('earnedCommission');

        const balanceEl = document.getElementById('withdrawAvailableBalance');
        if (balanceEl) balanceEl.textContent = max + ' ج.م';

        const hintEl = document.getElementById('withdrawAmountHint');
        if (hintEl) hintEl.textContent = 'الحد الأقصى: ' + max + ' ج.م';

        const amountInput = document.getElementById('withdrawAmount');
        if (amountInput && max > 0) {
            amountInput.max = String(max);
        }
    }

    function initWithdraw() {
        const form = document.getElementById('withdrawForm');
        if (!form) return;

        const statsGrid = document.getElementById('statsGrid');
        if (statsGrid && typeof MutationObserver !== 'undefined') {
            const obs = new MutationObserver(function() {
                if (statsGrid.style.display !== 'none') {
                    refreshWithdrawData();
                }
            });
            obs.observe(statsGrid, { attributes: true, attributeFilter: ['style'] });
        }

        const amountInput = document.getElementById('withdrawAmount');
        const transferInput = document.getElementById('withdrawTransferNumber');
        const transferHint = document.getElementById('withdrawTransferNumberHint');
        const amountError = document.getElementById('withdrawAmountError');
        const transferError = document.getElementById('withdrawTransferNumberError');
        const methodError = document.getElementById('withdrawMethodError');
        const messageEl = document.getElementById('withdrawMessage');

        function clearError(el) {
            if (el) el.classList.remove('show');
        }

        function showError(el, text) {
            if (!el) return;
            el.textContent = text;
            el.classList.add('show');
        }

        if (amountInput) {
            amountInput.addEventListener('input', function() {
                clearError(amountError);
            });
        }

        if (transferInput) {
            transferInput.addEventListener('input', function(e) {
                e.target.value = e.target.value.replace(/[^\d]/g, '').slice(0, 11);
                clearError(transferError);
            });
        }

        form.querySelectorAll('input[name="withdrawMethod"]').forEach(function(radio) {
            radio.addEventListener('change', function() {
                clearError(methodError);
                if (transferHint) {
                    transferHint.textContent = radio.value === 'instapay'
                        ? 'رقم الهاتف المسجل على حساب انستاباي'
                        : 'رقم الهاتف المسجل على المحفظة الإلكترونية';
                }
            });
        });

        form.addEventListener('submit', async function(e) {
            e.preventDefault();

            const code = getMarketerCode();
            const max = readNumberFromEl('earnedCommission');
            const amount = parseInt(amountInput ? amountInput.value : '0', 10);
            const methodRadio = form.querySelector('input[name="withdrawMethod"]:checked');
            const method = methodRadio ? methodRadio.value : '';
            const transferNumber = (transferInput ? transferInput.value : '').trim();

            hideMessage(messageEl);
            clearError(amountError);
            clearError(methodError);
            clearError(transferError);

            // 1. Validate amount
            if (!amount || amount < 1) {
                showError(amountError, 'أدخل مبلغاً صحيحاً (رقم أكبر من 0)');
                return;
            }
            if (amount > max) {
                showError(amountError, 'المبلغ يتجاوز الرصيد المتاح (' + max + ' ج.م)');
                return;
            }

            // 2. Validate method
            if (!method) {
                showError(methodError, 'اختر طريقة الاستلام');
                return;
            }

            // 3. Validate transfer number (Egyptian mobile)
            if (!transferNumber) {
                showError(transferError, 'رقم التحويل مطلوب');
                return;
            }
            if (!/^01[0125]\d{8}$/.test(transferNumber)) {
                showError(transferError, 'رقم هاتف غير صحيح (11 رقم يبدأ بـ 010/011/012/015)');
                return;
            }

            // 4. Submit
            const btn = document.getElementById('submitWithdrawBtn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';
            }

            try {
                const res = await fetch('/api?action=marketer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        innerAction: 'submitWithdrawRequest',
                        marketerCode: code,
                        amount: amount,
                        method: method,
                        transferNumber: transferNumber
                    })
                });
                const data = await res.json();

                if (data.success) {
                    showMessage(messageEl, 'success',
                        '✅ تم إرسال طلبك بنجاح. رقم الطلب: ' + (data.requestId || '—') +
                        ' — سيتم التواصل معك خلال 48 ساعة عبر البريد أو الهاتف.');

                    // Reset form fields (except readonly)
                    if (amountInput) amountInput.value = '';
                    if (transferInput) transferInput.value = '';
                    form.querySelectorAll('input[name="withdrawMethod"]').forEach(function(r) {
                        r.checked = false;
                    });
                    if (transferHint) {
                        transferHint.textContent = 'رقم الهاتف المسجل على وسيلة الاستلام';
                    }
                    refreshWithdrawData();
                } else {
                    const errMsg = data.message || data.error || 'فشل إرسال الطلب';
                    showMessage(messageEl, 'error', '❌ ' + errMsg);
                }
            } catch (err) {
                console.error('withdraw submit error:', err);
                showMessage(messageEl, 'error', '⚠️ تعذر الاتصال بالخادم. حاول مرة أخرى.');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-paper-plane"></i> إرسال طلب السحب';
                }
            }
        });

        refreshWithdrawData();
    }

    // ============================================================
    //  3. Change Password (OTP flow)
    // ============================================================
    let otpCountdownInterval = null;
    let currentChannelMethod = 'email';

    async function refreshChannelInfo() {
        const code = getMarketerCode();
        if (!code) return;

        try {
            const res = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'getMarketerTelegramStatus',
                    marketerCode: code
                })
            });
            const data = await res.json();

            const method = data.notificationMethod || 'email';
            const isLinked = !!data.isLinked;
            currentChannelMethod = method;

            const warningBox = document.getElementById('channelWarningBox');
            const infoBox = document.getElementById('channelInfoBox');
            const channelDisplay = document.getElementById('currentChannelDisplay');
            const sendBtn = document.getElementById('sendOtpBtn');

            if (method === 'telegram' && !isLinked) {
                // Warning: Telegram chosen but not linked
                if (warningBox) warningBox.style.display = 'flex';
                if (infoBox) infoBox.style.display = 'none';
                if (sendBtn) sendBtn.disabled = true;
            } else {
                if (warningBox) warningBox.style.display = 'none';
                if (infoBox) infoBox.style.display = 'flex';
                if (channelDisplay) {
                    channelDisplay.textContent = (method === 'telegram') ? 'تليجرام' : 'البريد الإلكتروني';
                }
                if (sendBtn) sendBtn.disabled = false;
            }
        } catch (err) {
            console.warn('⚠️ refreshChannelInfo:', err);
        }
    }

    function validatePassword(pwd) {
        return pwd.length >= 8
            && /[A-Za-z]/.test(pwd)
            && /[0-9]/.test(pwd)
            && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(pwd)
            && !/[\u0600-\u06FF]/.test(pwd);
    }

    function startOtpCountdown(seconds) {
        const countdownEl = document.getElementById('otpCountdown');
        if (!countdownEl) return;

        if (otpCountdownInterval) clearInterval(otpCountdownInterval);

        let remaining = seconds || 300;
        function tick() {
            if (remaining <= 0) {
                countdownEl.textContent = '00:00';
                clearInterval(otpCountdownInterval);
                otpCountdownInterval = null;
                return;
            }
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            countdownEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
            remaining--;
        }
        tick();
        otpCountdownInterval = setInterval(tick, 1000);
    }

    function initChangePassword() {
        const sendBtn = document.getElementById('sendOtpBtn');
        const confirmBtn = document.getElementById('confirmChangePasswordBtn');
        const otpInput = document.getElementById('otpInput');

        // Link: go to telegram tab
        const goTelegramLink = document.getElementById('goToTelegramLink');
        if (goTelegramLink) {
            goTelegramLink.addEventListener('click', function(e) {
                e.preventDefault();
                switchTab('notifications');
            });
        }

        // Link: switch to email
        const switchEmailLink = document.getElementById('switchToEmailChannel');
        if (switchEmailLink) {
            switchEmailLink.addEventListener('click', async function(e) {
                e.preventDefault();
                const code = getMarketerCode();
                try {
                    const res = await fetch('/api?action=telegram', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            innerAction: 'setMarketerNotificationMethod',
                            marketerCode: code,
                            method: 'email'
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        await refreshChannelInfo();
                    } else {
                        alert('❌ ' + (data.error || 'فشل التحويل للبريد'));
                    }
                } catch (err) {
                    alert('⚠️ خطأ في الاتصال');
                }
            });
        }

        if (sendBtn) {
            sendBtn.addEventListener('click', async function() {
                const current = (document.getElementById('mdCurrentPassword').value || '').trim();
                const newPwd = (document.getElementById('mdNewPassword').value || '').trim();
                const confirm = (document.getElementById('mdConfirmPassword').value || '').trim();

                // Reset errors
                ['mdCurrentPasswordError', 'mdNewPasswordError', 'mdConfirmPasswordError'].forEach(function(id) {
                    const el = document.getElementById(id);
                    if (el) el.classList.remove('show');
                });
                hideMessage(document.getElementById('changePasswordMessage'));

                let hasError = false;
                if (!current) {
                    const el = document.getElementById('mdCurrentPasswordError');
                    if (el) { el.textContent = 'كلمة السر الحالية مطلوبة'; el.classList.add('show'); }
                    hasError = true;
                }
                if (!newPwd) {
                    const el = document.getElementById('mdNewPasswordError');
                    if (el) { el.textContent = 'كلمة السر الجديدة مطلوبة'; el.classList.add('show'); }
                    hasError = true;
                } else if (!validatePassword(newPwd)) {
                    const el = document.getElementById('mdNewPasswordError');
                    if (el) { el.textContent = 'كلمة السر لا تحقق الشروط (8+ أحرف، حرف + رقم + رمز)'; el.classList.add('show'); }
                    hasError = true;
                } else if (newPwd === current) {
                    const el = document.getElementById('mdNewPasswordError');
                    if (el) { el.textContent = 'كلمة السر الجديدة يجب أن تكون مختلفة'; el.classList.add('show'); }
                    hasError = true;
                }
                if (confirm !== newPwd) {
                    const el = document.getElementById('mdConfirmPasswordError');
                    if (el) { el.textContent = 'كلمة السر غير متطابقة'; el.classList.add('show'); }
                    hasError = true;
                }
                if (hasError) return;

                const code = getMarketerCode();
                sendBtn.disabled = true;
                sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';

                try {
                    const res = await fetch('/api?action=marketer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            innerAction: 'requestPasswordChangeOTP',
                            marketerCode: code,
                            currentPassword: current,
                            newPassword: newPwd
                        })
                    });
                    const data = await res.json();

                    if (data.success) {
                        const otpSection = document.getElementById('otpSection');
                        if (otpSection) otpSection.style.display = 'block';
                        startOtpCountdown(data.expiresInSeconds || 300);
                        if (otpInput) { otpInput.value = ''; otpInput.focus(); }

                        showMessage(document.getElementById('changePasswordMessage'),
                            'success',
                            '✅ تم إرسال رمز التحقق عبر ' +
                            (currentChannelMethod === 'telegram' ? 'تليجرام' : 'البريد الإلكتروني'));
                    } else {
                        showMessage(document.getElementById('changePasswordMessage'),
                            'error',
                            '❌ ' + (data.error || data.message || 'فشل إرسال رمز التحقق'));
                    }
                } catch (err) {
                    showMessage(document.getElementById('changePasswordMessage'),
                        'error',
                        '⚠️ تعذر الاتصال بالخادم');
                } finally {
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> إعادة إرسال رمز التحقق';
                }
            });
        }

        if (otpInput) {
            otpInput.addEventListener('input', function() {
                this.value = this.value.replace(/[^\d]/g, '').slice(0, 6);
                const err = document.getElementById('otpError');
                if (err) err.classList.remove('show');
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', async function() {
                const code = getMarketerCode();
                const otp = (otpInput ? otpInput.value : '').trim();
                const newPwd = (document.getElementById('mdNewPassword').value || '').trim();
                const errEl = document.getElementById('otpError');
                const msgEl = document.getElementById('changePasswordMessage');

                if (otp.length !== 6) {
                    if (errEl) { errEl.textContent = 'أدخل 6 أرقام'; errEl.classList.add('show'); }
                    return;
                }

                confirmBtn.disabled = true;
                confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التأكيد...';
                hideMessage(msgEl);

                try {
                    const res = await fetch('/api?action=marketer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            innerAction: 'confirmPasswordChange',
                            marketerCode: code,
                            otp: otp,
                            newPassword: newPwd
                        })
                    });
                    const data = await res.json();

                    if (data.success) {
                        showMessage(msgEl, 'success',
                            '✅ تم تغيير كلمة السر بنجاح. سيتم تسجيل الخروج...');
                        if (otpCountdownInterval) clearInterval(otpCountdownInterval);
                        setTimeout(function() {
                            localStorage.removeItem('marketerCode');
                            localStorage.removeItem('marketerName');
                            window.location.href = '/marketer-login';
                        }, 2000);
                    } else {
                        showMessage(msgEl, 'error',
                            '❌ ' + (data.error || data.message || 'فشل التأكيد'));
                    }
                } catch (err) {
                    showMessage(msgEl, 'error', '⚠️ تعذر الاتصال بالخادم');
                } finally {
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = '<i class="fas fa-check"></i> تأكيد تغيير كلمة السر';
                }
            });
        }
    }

    // ============================================================
    //  4. Delete Warnings
    // ============================================================
    function populateDeleteWarnings() {
        const box = document.getElementById('deleteWarningsBox');
        if (!box) return;

        const earned = readNumberFromEl('earnedCommission');
        const pending = readNumberFromEl('pendingCommission');

        const lines = [];
        if (earned > 0) {
            lines.push('لديك <strong>' + earned + ' ج.م</strong> عمولات مستحقة — ستفقدها نهائياً عند الحذف.');
        }
        if (pending > 0) {
            lines.push('لديك <strong>' + pending + ' ج.م</strong> عمولات معلقة — لن تحصل عليها بعد الحذف.');
        }

        if (lines.length === 0) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        box.innerHTML =
            '<p class="dw-title"><i class="fas fa-triangle-exclamation"></i> تحذير هام</p>' +
            '<ul class="dw-list">' +
                lines.map(function(l) { return '<li>• ' + l + '</li>'; }).join('') +
            '</ul>';
        box.style.display = 'block';
    }

    function initDeleteWarnings() {
        const deleteBtn = document.getElementById('deleteAccountBtn');
        if (!deleteBtn) return;

        // Fire AFTER existing handler (which shows the modal)
        deleteBtn.addEventListener('click', function() {
            setTimeout(populateDeleteWarnings, 0);
        });

        // Also update when statsGrid changes
        const statsGrid = document.getElementById('statsGrid');
        if (statsGrid && typeof MutationObserver !== 'undefined') {
            const obs = new MutationObserver(function() {
                if (statsGrid.style.display !== 'none') {
                    // If modal is open, refresh
                    const modal = document.getElementById('deleteConfirmModal');
                    if (modal && modal.style.display === 'flex') {
                        populateDeleteWarnings();
                    }
                }
            });
            obs.observe(statsGrid, { attributes: true, attributeFilter: ['style'] });
        }
    }

    // ============================================================
    //  Init
    // ============================================================
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
            initSidebarToggle();
            initTabs();
            initWithdraw();
            initChangePassword();
            initDeleteWarnings();
            initReloadButtons();
            console.log('✅ marketer-dashboard extras loaded (sidebar + tabs + withdraw + password + warnings + reload)');
        }, 0);
    });

})();