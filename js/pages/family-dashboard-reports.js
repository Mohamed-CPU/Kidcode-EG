// ================================================================
//  family-dashboard-reports.js - تقارير نشاط QR
//  - فلتر تاريخي (quick + custom)
//  - Summary + Chart + Tables
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  State
    // ============================================================
    const state = {
        isInitialized: false,
        currentRange: 7, // default: آخر 7 أيام
        currentFrom: null,
        currentTo: null,
        isLoading: false,
        locationLogsExpanded: false
    };

    // ✅ حد العرض الافتراضي
    const INITIAL_ROWS_LIMIT = 10;

    // ============================================================
    //  DOM References
    // ============================================================
    const els = {
        // Header
        reloadReportsBtn: document.getElementById('reloadReportsBtn'),

        // Filters
        quickBtns: document.querySelectorAll('.fd-quick-btn'),
        customRange: document.getElementById('reportsCustomRange'),
        fromDate: document.getElementById('reportsFromDate'),
        toDate: document.getElementById('reportsToDate'),
        applyCustomRangeBtn: document.getElementById('applyCustomRangeBtn'),
        periodText: document.getElementById('reportsPeriodText'),

        // Summary
        statTotalScans: document.getElementById('statTotalScans'),
        statLastScan: document.getElementById('statLastScan'),
        statDaysRemaining: document.getElementById('statDaysRemaining'),
        statStatus: document.getElementById('statStatus'),

        // Chart
        chartLoading: document.getElementById('reportsChartLoading'),
        chart: document.getElementById('reportsChart'),
        chartScroll: document.getElementById('reportsChartScroll'),
        chartEmpty: document.getElementById('reportsChartEmpty'),

        // Location Logs
        locationLogsLoading: document.getElementById('locationLogsLoading'),
        locationLogsTable: document.getElementById('locationLogsTable'),
        locationLogsBody: document.getElementById('locationLogsBody'),
        locationLogsEmpty: document.getElementById('locationLogsEmpty'),
        locationLogsCountBadge: document.getElementById('locationLogsCountBadge'),
        locationLogsToggleBtn: document.getElementById('locationLogsToggleBtn')
    };

    // ============================================================
    //  Helpers
    // ============================================================
    function getFD() { return window.FD; }
    function getChildID() {
        return (getFD() && getFD().getChildID && getFD().getChildID()) || '';
    }
    function getSession() {
        return (getFD() && getFD().getSession && getFD().getSession()) || '';
    }
    function apiCall(innerAction, payload, method) {
        return getFD().apiCall(innerAction, payload, method);
    }
    function showLoader(show) {
        if (getFD() && getFD().showLoader) getFD().showLoader(show);
    }
    function escapeHtml(str) {
        return (getFD() && getFD().escapeHtml) ? getFD().escapeHtml(str) : String(str || '');
    }

    // ============================================================
    //  Date Helpers
    // ============================================================

    /**
     * formatCairoDateStr — تُنسّق Date object كـ "YYYY-MM-DD" بتوقيت Cairo
     * ✅ DST-aware (Africa/Cairo) — لا Local TZ
     * @param {Date} d
     * @returns {string} "YYYY-MM-DD"
     */
    function formatDate(d) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Cairo',
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(d);
        const y = parts.find(p => p.type === 'year').value;
        const m = parts.find(p => p.type === 'month').value;
        const dd = parts.find(p => p.type === 'day').value;
        return y + '-' + m + '-' + dd;
    }

    /**
     * getRangeDates — تُرجع { from, to } بصيغة "YYYY-MM-DD" بتوقيت Cairo
     * ✅ DST-aware:
     *  1. جيب "Cairo today" عبر Intl (Africa/Cairo)
     *  2. احسب from/to في UTC (لتجنب DST بين الأيام)
     *  3. صيغها كـ "YYYY-MM-DD" مباشرة (لا إعادة تحويل عبر Cairo)
     * @param {number} rangeDays — عدد الأيام (inclusive)
     * @returns {{from: string, to: string}}
     */
    function getRangeDates(rangeDays) {
        // ✅ تخصيص: لو المستخدم طالب 30 يوم أو 90 يوم (شهور)، نستخدم setMonth عشان تبقى دقيقة
        if (rangeDays === 30 || rangeDays === 90) {
            const to = new Date();
            const from = new Date();
            // 30 يوم = شهر تقويمي / 90 يوم = 3 شهور تقويمية
            from.setMonth(from.getMonth() - (rangeDays / 30)); 
            
            return {
                from: formatDate(from),
                to: formatDate(to)
            };
        }

        // الافتراضي (7 أيام)
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - rangeDays + 1); // inclusive

        return {
            from: formatDate(from),
            to: formatDate(to)
        };
    }

    function formatDateForDisplay(dateStr) {
        if (!dateStr) return '--';

        // ✅ صيغة عربية كاملة: "الأربعاء، 11 نوفمبر 2026"
        if (window.Utils && typeof Utils.formatCairoDate === 'function') {
            try {
                const formatted = Utils.formatCairoDate(dateStr);
                if (formatted && formatted !== String(dateStr)) return formatted;
            } catch (e) {}
        }

        // Fallback: dd/mm/yyyy
        const parts = String(dateStr).split('-');
        if (parts.length === 3) {
            return parts[2] + '/' + parts[1] + '/' + parts[0];
        }
        return dateStr;
    }

    function formatShortDate(dateStr) {
        // yyyy-MM-dd → dd/mm
        const parts = String(dateStr).split('-');
        if (parts.length === 3) {
            return parts[2] + '/' + parts[1];
        }
        return dateStr;
    }

    // ✅ formatTime — الوقت بالصيغة العربية الكاملة: "02:35:00 مساءً"
    function formatTime(timestamp) {
        if (!timestamp) return '--';

        // ✅ صيغة عربية كاملة (مع ثواني): "02:35:00 مساءً"
        if (window.Utils && typeof Utils.formatCairoTimeLong === 'function') {
            try {
                const formatted = Utils.formatCairoTimeLong(timestamp);
                if (formatted) return formatted;
            } catch (e) {}
        }

        // Fallback: القديم
        const str = String(timestamp).trim();
        const ampmMatch = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i);
        if (ampmMatch) {
            return ampmMatch[1] + ':' + ampmMatch[2] + ':' + (ampmMatch[3] || '00') + ' ' + ampmMatch[4].toUpperCase();
        }
        return str;
    }

    // ============================================================
    //  صياغة العدد مع الوحدة الزمنية وفق قواعد العربية
    //  - 1 → "شهر"
    //  - 2 → "شهران"
    //  - 3 إلى 10 → "3 شهور"
    //  - 11 فأكثر → "11 شهر"
    // ============================================================
    function formatArabicCount(count, forms) {
        if (count === 1) return forms.singular;
        if (count === 2) return forms.dual;
        if (count >= 3 && count <= 10) return count + ' ' + forms.plural;
        return count + ' ' + forms.singular;
    }

    // ============================================================
    //  📅 حساب المدة المتبقية بالتقويم الفعلي
    //  Input:  "2027-04-07" (expiryDate — Cairo calendar date)
    //  Output: { expired: bool, text: "6 شهور" }
    //
    //  ✅ DST-aware: Cairo "today" via Intl
    //  ✅ مقارنة "تواريخ تقويمية" (calendar dates) — ليس لحظات (moments)
    //     السبب: الاشتراك ينتهي في "منتصف ليل Cairo" — لا علاقة له بلحظة UTC
    // ============================================================
    function calculateRemainingDuration(expiryDateStr) {
        if (!expiryDateStr) return { expired: false, text: 'غير متاح' };

        // 1️⃣ استخرج "Cairo calendar date" من الـ expiry
        const datePart = String(expiryDateStr).trim().split(/[\sT]/)[0];
        const parts = datePart.split('-');
        if (parts.length !== 3) return { expired: false, text: 'غير متاح' };

        const expiryYear = parseInt(parts[0], 10);
        const expiryMonth = parseInt(parts[1], 10) - 1;  // 0-indexed
        const expiryDay = parseInt(parts[2], 10);

        if (isNaN(expiryYear) || isNaN(expiryMonth) || isNaN(expiryDay)) {
            return { expired: false, text: 'غير متاح' };
        }

        // 2️⃣ جيب "Cairo today" عبر Intl — DST-aware
        const todayParts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Cairo',
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date());
        const getP = (t) => parseInt(todayParts.find(p => p.type === t).value, 10);
        const todayYear = getP('year');
        const todayMonth = getP('month') - 1;  // 0-indexed
        const todayDay = getP('day');

        // 3️⃣ مقارنة "calendar dates" في UTC
        //    (Date.UTC() آمن — لا DST بين التواريخ، فبيمثل "calendar date")
        const todayUTC = Date.UTC(todayYear, todayMonth, todayDay);
        const expiryUTC = Date.UTC(expiryYear, expiryMonth, expiryDay);

        if (expiryUTC <= todayUTC) {
            return { expired: true, text: '⛔ منتهي' };
        }

        // 4️⃣ فرق تقويمي فعلي (بالسنوات/الشهور/الأيام)
        let years = expiryYear - todayYear;
        let months = expiryMonth - todayMonth;
        let days = expiryDay - todayDay;

        // لو الأيام سالبة → استلف من الشهور
        if (days < 0) {
            months--;
            // آخر يوم في الشهر اللي قبل expiry — احسبها في UTC لتفادي DST
            const prevMonthDays = new Date(Date.UTC(expiryYear, expiryMonth, 0)).getUTCDate();
            days += prevMonthDays;
        }
        // لو الشهور سالبة → استلف من السنين
        if (months < 0) {
            years--;
            months += 12;
        }

        // 5️⃣ لو الناتج كله صفر
        if (years === 0 && months === 0 && days === 0) {
            return { expired: false, text: 'أقل من يوم' };
        }

        // 6️⃣ بناء النص وفق قواعد العدد العربية
        const textParts = [];

        if (years > 0) {
            textParts.push(formatArabicCount(years, {
                singular: 'سنة',
                dual: 'سنتان',
                plural: 'سنوات'
            }));
        }

        if (months > 0) {
            textParts.push(formatArabicCount(months, {
                singular: 'شهر',
                dual: 'شهران',
                plural: 'شهور'
            }));
        }

        if (days > 0) {
            textParts.push(formatArabicCount(days, {
                singular: 'يوم',
                dual: 'يومان',
                plural: 'أيام'
            }));
        }

        if (textParts.length === 0) return { expired: false, text: 'أقل من يوم' };
        return { expired: false, text: textParts.join(' و ') };
    }

    // ============================================================
    //  📊 loadReports — بدون Cache (كل ضغطة تجيب من الخادم)
    // ============================================================
    async function loadReports(fromDate, toDate) {
        // ✅ لو فيه طلب شغّال — تجاهل
        if (state.isLoading) {
            console.warn('⚠️ [Reports] طلب شغّال بالفعل — تجاهل');
            return null;
        }

        state.isLoading = true;
        showLoadingState();

        const t0 = Date.now();

        try {
            const params = {
                childID: getChildID(),
                session: getSession()
            };
            if (fromDate) params.fromDate = fromDate;
            if (toDate) params.toDate = toDate;

            const result = await apiCall('getFamilyReports', params, 'GET');
            const elapsed = Date.now() - t0;

            console.log('📩 getFamilyReports (' + elapsed + 'ms):', result);

            if (!result.success) {
                showErrorState(result.error || 'فشل تحميل التقارير');
                return null;
            }

            renderAll(result);

            return result;

        } catch (err) {
            console.error('❌ loadReports error:', err);
            showErrorState('تعذر الاتصال بالخادم');
            return null;
        } finally {
            state.isLoading = false;
        }
    }

    // ============================================================
    //  📊 Initial State — قبل ما المستخدم يختار الفترة
    // ============================================================
    function showInitialState() {
        // Period text
        if (els.periodText) {
            els.periodText.textContent = '👆 اختر الفترة الزمنية لعرض التقرير';
        }

        // Chart
        if (els.chartLoading) els.chartLoading.style.display = 'none';
        if (els.chart) els.chart.style.display = 'none';
        if (els.chartEmpty) {
            els.chartEmpty.style.display = 'block';
            const p = els.chartEmpty.querySelector('p');
            if (p) p.textContent = 'اختر الفترة الزمنية لعرض الرسم البياني';
        }

        // Location logs
        if (els.locationLogsLoading) els.locationLogsLoading.style.display = 'none';
        if (els.locationLogsTable) els.locationLogsTable.style.display = 'none';
        if (els.locationLogsEmpty) {
            els.locationLogsEmpty.style.display = 'block';
            const p = els.locationLogsEmpty.querySelector('p');
            if (p) p.textContent = 'اختر الفترة الزمنية لعرض السجل';
        }
        if (els.locationLogsCountBadge) els.locationLogsCountBadge.textContent = '0';

        // Summary cards — تصفير
        if (els.statTotalScans) els.statTotalScans.textContent = '--';
        if (els.statLastScan) els.statLastScan.textContent = '--';
        if (els.statDaysRemaining) els.statDaysRemaining.textContent = '--';
        if (els.statStatus) els.statStatus.textContent = '--';
    }

    function showLoadingState() {
        // Chart
        els.chartLoading.style.display = 'block';
        els.chart.style.display = 'none';
        els.chartEmpty.style.display = 'none';

        // Location logs
        els.locationLogsLoading.style.display = 'block';
        els.locationLogsTable.style.display = 'none';
        els.locationLogsEmpty.style.display = 'none';
    }

    function showErrorState(message) {
        els.periodText.textContent = '⚠️ ' + message;

        els.chartLoading.style.display = 'none';
        els.chartEmpty.style.display = 'block';
        els.chartEmpty.querySelector('p').textContent = message;

        els.locationLogsLoading.style.display = 'none';
        els.locationLogsEmpty.style.display = 'block';
    }

    // ============================================================
    //  Render All
    // ============================================================
    function renderAll(data) {
        renderPeriod(data.period);
        renderSummary(data.summary);
        renderChart(data.dailyStats);
        renderLocationLogs(data.locationLogs);
    }

    // ============================================================
    //  Period Display
    // ============================================================
    function renderPeriod(period) {
        if (!period) return;
        els.periodText.textContent =
            'من ' + formatDateForDisplay(period.from) +
            ' إلى ' + formatDateForDisplay(period.to) +
            ' (' + period.days + ' يوم)';
    }

    // ============================================================
    //  Summary
    // ============================================================
    function renderSummary(summary) {
        if (!summary) return;

        els.statTotalScans.textContent = summary.totalScans || 0;

        els.statLastScan.textContent = summary.lastScan
            ? formatShortDateTime(summary.lastScan)
            : 'لا يوجد';

        // ✅ Days Remaining — بالتقويم الفعلي من expiryDate
        if (summary.expiryDate) {
            const dur = calculateRemainingDuration(summary.expiryDate);
            els.statDaysRemaining.textContent = dur.text;
        } else if (summary.daysRemaining !== null && summary.daysRemaining !== undefined) {
            // fallback: لو مفيش expiryDate
            if (summary.daysRemaining <= 0) {
                els.statDaysRemaining.textContent = '⛔ منتهي';
            } else {
                els.statDaysRemaining.textContent = summary.daysRemaining + ' يوم';
            }
        } else {
            els.statDaysRemaining.textContent = 'غير متاح';
        }

        // Status
        const statusMap = {
            'active': '✅ نشط',
            'pending': '⏳ قيد التفعيل',
            'expired': '⏰ منتهي',
            'suspended': '🚫 موقوف',
            'deleted': '🗑️ محذوف',
            'inactive': '⛔ غير نشط'
        };
        els.statStatus.textContent = statusMap[summary.status] || summary.status || '--';
    }

    // ✅ الصيغة العربية الكاملة: "الأربعاء، 11 نوفمبر 2026 - 02:00 مساءً"
    function formatShortDateTime(dt) {
        if (!dt) return '--';

        // ✅ صيغة عربية كاملة (بدون ثواني)
        if (window.Utils && typeof Utils.formatCairoDateTime === 'function') {
            try {
                const formatted = Utils.formatCairoDateTime(dt);
                if (formatted) return formatted;
            } catch (e) {}
        }

        // Fallback
        try {
            return Utils.formatDateTime(dt) || String(dt);
        } catch (e) {
            return String(dt);
        }
    }

    // ============================================================
    //  Chart
    // ============================================================
    function renderChart(dailyStats) {
        els.chartLoading.style.display = 'none';

        if (!dailyStats || dailyStats.length === 0) {
            els.chart.style.display = 'none';
            els.chartEmpty.style.display = 'block';
            return;
        }

        // Find max value for scaling
        const maxVal = Math.max(
            1,
            ...dailyStats.map(function(d) {
                return Math.max(d.scans || 0, d.locations || 0);
            })
        );

        const maxBarHeight = 150;

        // Build chart
        els.chartScroll.innerHTML = '';

        dailyStats.forEach(function(day) {
            const scans = day.scans || 0;
            const locations = day.locations || 0;

            const scansHeight = scans > 0 ? Math.max(2, Math.round((scans / maxVal) * maxBarHeight)) : 2;
            const locationsHeight = locations > 0 ? Math.max(2, Math.round((locations / maxVal) * maxBarHeight)) : 2;

            const dayEl = document.createElement('div');
            dayEl.className = 'chart-day';
            dayEl.innerHTML =
                '<div class="chart-bars">' +
                    '<div class="chart-bar scans" ' +
                        'style="height: ' + scansHeight + 'px;" ' +
                        'title="' + formatDateForDisplay(day.date) + ' - مسحات: ' + scans + '"></div>' +
                    '<div class="chart-bar locations" ' +
                        'style="height: ' + locationsHeight + 'px;" ' +
                        'title="' + formatDateForDisplay(day.date) + ' - مواقع: ' + locations + '"></div>' +
                '</div>' +
                '<div class="chart-day-label">' + formatShortDate(day.date) + '</div>';

            els.chartScroll.appendChild(dayEl);
        });

        els.chart.style.display = 'block';
        els.chartEmpty.style.display = 'none';

        // Scroll to end (latest day)
        setTimeout(function() {
            if (els.chartScroll) {
                els.chartScroll.scrollLeft = els.chartScroll.scrollWidth;
            }
        }, 100);
    }

    // ============================================================
    //  Helper: تحديث نص زرار Toggle (للمواقع)
    // ============================================================
    function updateToggleText(btn, expanded, remainingCount) {
        if (!btn) return;
        const textEl = btn.querySelector('.toggle-text');
        if (!textEl) return;

        if (expanded) {
            textEl.textContent = 'عرض أقل';
        } else {
            textEl.textContent = 'عرض المزيد (' + remainingCount + ' إضافي)';
        }
    }

    // ============================================================
    //  Location Logs
    // ============================================================
        function renderLocationLogs(logs) {
        els.locationLogsLoading.style.display = 'none';
        els.locationLogsCountBadge.textContent = (logs && logs.length) || 0;

        if (!logs || logs.length === 0) {
            els.locationLogsTable.style.display = 'none';
            els.locationLogsEmpty.style.display = 'block';
            return;
        }

        // ✅ Reset الـ toggle
        state.locationLogsExpanded = false;

        els.locationLogsBody.innerHTML = '';

        logs.forEach(function(log, index) {
            const tr = document.createElement('tr');

            // ✅ إخفاء الصفوف بعد الـ 10
            if (index >= INITIAL_ROWS_LIMIT) {
                tr.className = 'row-hidden';
            }

            const addressText = log.address
                ? escapeHtml(log.address.substring(0, 80))
                : 'غير متاح';

            const mapsLink = log.mapsLink
                ? '<a href="' + escapeHtml(log.mapsLink) + '" target="_blank" rel="noopener" class="cell-link">' +
                    '<i class="fas fa-map"></i> عرض' +
                  '</a>'
                : '—';

            tr.innerHTML =
                '<td class="cell-num">' + (index + 1) + '</td>' +
                '<td class="cell-time">' + escapeHtml(
                    (window.Utils && typeof Utils.formatCairoDateTime === 'function')
                        ? (Utils.formatCairoDateTime(log.timestamp) || '--')
                        : (Utils.formatDateTime(log.timestamp) || '--')
                ) + '</td>' +
                '<td class="cell-address">' + addressText + '</td>' +
                '<td>' + mapsLink + '</td>';

            els.locationLogsBody.appendChild(tr);
        });

        // ✅ إظهار/إخفاء زرار Toggle
        if (logs.length > INITIAL_ROWS_LIMIT) {
            els.locationLogsToggleBtn.style.display = 'flex';
            els.locationLogsToggleBtn.classList.remove('expanded');
            updateToggleText(els.locationLogsToggleBtn, false, logs.length - INITIAL_ROWS_LIMIT);
        } else {
            els.locationLogsToggleBtn.style.display = 'none';
        }

        els.locationLogsTable.style.display = 'block';
        els.locationLogsEmpty.style.display = 'none';
    }

    function handleQuickFilter(range, btn) {
        // Update active state
        els.quickBtns.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');

        if (range === 'custom') {
            els.customRange.style.display = 'block';
            const rangeDates = getRangeDates(30);
            if (!els.fromDate.value) els.fromDate.value = rangeDates.from;
            if (!els.toDate.value) els.toDate.value = rangeDates.to;
            return;
        }

        els.customRange.style.display = 'none';

        const rangeDays = parseInt(range, 10);
        const dates = getRangeDates(rangeDays);

        state.currentRange = rangeDays;
        state.currentFrom = dates.from;
        state.currentTo = dates.to;

        // ✅ loadReports هتستخدم Cache لو متاح
        loadReports(dates.from, dates.to);
    }

    function handleApplyCustomRange() {
        const from = els.fromDate.value;
        const to = els.toDate.value;

        if (!from || !to) {
            alert('⚠️ يرجى تحديد تاريخ البداية والنهاية');
            return;
        }

        if (from > to) {
            alert('⚠️ يجب أن يكون تاريخ البداية قبل تاريخ النهاية');
            return;
        }

        state.currentFrom = from;
        state.currentTo = to;
        state.currentRange = 'custom';

        loadReports(from, to);
    }

    // ============================================================
    //  Toggle Rows Visibility (للمواقع فقط)
    // ============================================================
    function toggleLocationLogsRows() {
        state.locationLogsExpanded = !state.locationLogsExpanded;

        const rows = els.locationLogsBody.querySelectorAll('tr');
        const total = rows.length;

        rows.forEach(function(tr, index) {
            if (index < INITIAL_ROWS_LIMIT) return;

            if (state.locationLogsExpanded) {
                tr.classList.remove('row-hidden');
            } else {
                tr.classList.add('row-hidden');
            }
        });

        if (els.locationLogsToggleBtn) {
            if (state.locationLogsExpanded) {
                els.locationLogsToggleBtn.classList.add('expanded');
                updateToggleText(els.locationLogsToggleBtn, true, 0);
            } else {
                els.locationLogsToggleBtn.classList.remove('expanded');
                updateToggleText(els.locationLogsToggleBtn, false, total - INITIAL_ROWS_LIMIT);
            }
        }
    }

    // ============================================================
    //  Event Binding
    // ============================================================
    function bindEvents() {
        // Quick buttons
        els.quickBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                const range = btn.getAttribute('data-range');
                handleQuickFilter(range, btn);
            });
        });

        // Apply custom range
        if (els.applyCustomRangeBtn) {
            els.applyCustomRangeBtn.addEventListener('click', handleApplyCustomRange);
        }

        // Reload button
        if (els.reloadReportsBtn) {
            els.reloadReportsBtn.addEventListener('click', async function() {
                showLoader(true);

                try {
                    const dates = getRangeDates(state.currentRange === 'custom' ? 30 : state.currentRange);
                    const from = state.currentRange === 'custom' ? state.currentFrom : dates.from;
                    const to = state.currentRange === 'custom' ? state.currentTo : dates.to;

                    await loadReports(from, to);
                } finally {
                    showLoader(false);
                }
            });
        }

        // ✅ Toggle button (للمواقع)
        if (els.locationLogsToggleBtn) {
            els.locationLogsToggleBtn.addEventListener('click', toggleLocationLogsRows);
        }
    }

    // ============================================================
    //  Tab Activation
    // ============================================================
    const originalOnTabActivate = window.onTabActivate;

    window.onTabActivate = function(tabName, data) {
        if (typeof originalOnTabActivate === 'function') {
            originalOnTabActivate(tabName, data);
        }

        if (tabName !== 'reports') return;

        // ✅ أول مرة فقط: حمّل "آخر 7 أيام" تلقائياً
        if (!state.isInitialized) {
            state.isInitialized = true;
            bindEvents();

            console.log('📊 [Reports] أول فتح — تحميل تلقائي لآخر 7 أيام');

            // فعّل زر "آخر 7 أيام" شكلياً
            els.quickBtns.forEach(function(b) {
                if (b.getAttribute('data-range') === '7') {
                    b.classList.add('active');
                } else {
                    b.classList.remove('active');
                }
            });
            if (els.customRange) els.customRange.style.display = 'none';

            // احسب التواريخ + نادِ loadReports
            const dates = getRangeDates(7);
            state.currentRange = 7;
            state.currentFrom = dates.from;
            state.currentTo = dates.to;

            loadReports(dates.from, dates.to);
        }
        // ✅ المرات الجاية: مفيش تحميل تلقائي — المستخدم يختار
    };

    console.log('✅ family-dashboard-reports.js loaded');

})();