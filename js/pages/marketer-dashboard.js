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
    try {
        // ✅ تحويل من UTC لتوقيت القاهرة
        const parts = Utils.getCairoTimeParts(dateStr);
        if (!parts) return String(dateStr);

        const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
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