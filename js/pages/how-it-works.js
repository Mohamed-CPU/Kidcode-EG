// ================================================================
//  how-it-works.js - منطق صفحة "مميزات الخدمة"
//  - البحث الفوري
//  - فلاتر التصنيف
//  - إخفاء/إظهار النتائج
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  Constants
    // ============================================================
    const SEARCH_INPUT_ID = 'hiwSearchInput';
    const CLEAR_BTN_ID = 'hiwClearBtn';
    const NO_RESULTS_ID = 'hiwNoResults';

    // ============================================================
    //  DOM References
    // ============================================================
    const searchInput = document.getElementById(SEARCH_INPUT_ID);
    const clearBtn = document.getElementById(CLEAR_BTN_ID);
    const noResults = document.getElementById(NO_RESULTS_ID);

    if (!searchInput) {
        console.warn('⚠️ [how-it-works.js] searchInput not found');
        return;
    }

    // ============================================================
    //  State
    // ============================================================
    let currentFilter = 'all';
    let currentSearch = '';

    // ============================================================
    //  Helpers
    // ============================================================

    /**
     * تطبيع النص العربي (للبحث الأفضل)
     */
    function normalizeArabic(text) {
        if (!text) return '';
        let normalized = String(text).toLowerCase().trim();
        // إزالة التشكيل
        normalized = normalized.replace(/[\u064B-\u065F\u0670]/g, '');
        // توحيد الألف
        normalized = normalized.replace(/[أإآٱٲٳ]/g, 'ا');
        // توحيد الياء
        normalized = normalized.replace(/[ىئي]/g, 'ي');
        // توحيد التاء المربوطة
        normalized = normalized.replace(/ة/g, 'ه');
        // إزالة المسافات المتعددة
        normalized = normalized.replace(/\s+/g, ' ');
        return normalized;
    }

    /**
     * هل النص يحتوي على كلمة البحث؟
     */
    function matchesSearch(text, searchTerm) {
        if (!searchTerm) return true;
        const normalizedText = normalizeArabic(text);
        const normalizedSearch = normalizeArabic(searchTerm);
        return normalizedText.includes(normalizedSearch);
    }

    // ============================================================
    //  Main Filter Logic
    // ============================================================

    /**
     * تطبيق الفلتر + البحث
     */
    function applyFilters() {
        const sections = document.querySelectorAll('.hiw-section');
        let totalVisibleSections = 0;
        let totalVisibleItems = 0;

        sections.forEach(section => {
            const category = section.dataset.category || '';
            const items = section.querySelectorAll('.hiw-item');
            let visibleItemsInSection = 0;

            // ===== فلترة العناصر داخل القسم =====
            items.forEach(item => {
                const titleEl = item.querySelector('.hiw-item-title');
                const contentEl = item.querySelector('.hiw-item-content');

                const titleText = titleEl ? titleEl.textContent : '';
                const contentText = contentEl ? contentEl.textContent : '';
                const fullText = titleText + ' ' + contentText;

                // فحص الفلتر
                const passesFilter = currentFilter === 'all' || category === currentFilter;

                // فحص البحث
                const passesSearch = matchesSearch(fullText, currentSearch);

                // إظهار/إخفاء
                if (passesFilter && passesSearch) {
                    item.classList.remove('hiw-hidden');
                    visibleItemsInSection++;
                } else {
                    item.classList.add('hiw-hidden');
                    // إغلاق العنصر لو مخفي
                    item.removeAttribute('open');
                }
            });

            // ===== إظهار/إخفاء القسم نفسه =====
            if (visibleItemsInSection > 0) {
                section.classList.remove('hiw-hidden');
                totalVisibleSections++;
                totalVisibleItems += visibleItemsInSection;
            } else {
                section.classList.add('hiw-hidden');
            }
        });

        // ===== رسالة "لا توجد نتائج" =====
        if (noResults) {
            if (totalVisibleItems === 0) {
                noResults.style.display = 'block';
            } else {
                noResults.style.display = 'none';
            }
        }

        console.log(`🔍 [how-it-works] Filter: ${currentFilter} | Search: "${currentSearch}" | Visible: ${totalVisibleSections} sections / ${totalVisibleItems} items`);
    }

    // ============================================================
    //  Search Input Handler
    // ============================================================
    let searchDebounceTimer = null;

    searchInput.addEventListener('input', function() {
        currentSearch = this.value.trim();

        // إظهار/إخفاء زر المسح
        if (clearBtn) {
            if (currentSearch.length > 0) {
                clearBtn.style.display = 'block';
            } else {
                clearBtn.style.display = 'none';
            }
        }

        // Debounce بسيط (200ms) لأداء أفضل
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            applyFilters();
        }, 200);
    });

    // ============================================================
    //  Clear Search
    // ============================================================
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            searchInput.value = '';
            currentSearch = '';
            clearBtn.style.display = 'none';
            searchInput.focus();
            applyFilters();
        });
    }

    // ============================================================
    //  Filter Chips
    // ============================================================
    const filterChips = document.querySelectorAll('.hiw-filter-chip');

    filterChips.forEach(chip => {
        chip.addEventListener('click', function() {
            const filterValue = this.dataset.filter || 'all';

            // إزالة active من كل الـ chips
            filterChips.forEach(c => c.classList.remove('active'));

            // إضافة active للـ chip المختار
            this.classList.add('active');

            // تحديث الفلتر وتطبيقه
            currentFilter = filterValue;
            applyFilters();
        });
    });

    // ============================================================
    //  ESC Key = Clear Search
    // ============================================================
    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && currentSearch) {
            if (clearBtn) clearBtn.click();
        }
    });

    // ============================================================
    //  Init
    // ============================================================
    function init() {
        // كل الـ accordions مغلقة افتراضياً (already by default in HTML)
        // نضمن إزالة open من أي عنصر
        document.querySelectorAll('.hiw-item[open]').forEach(item => {
            item.removeAttribute('open');
        });

        // تطبيق الفلاتر الأولية
        applyFilters();

        console.log('✅ [how-it-works.js] initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();