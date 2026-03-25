/* search.js – Musik in Schaumburg
 * Client-side full-text search for ensemble cards.
 * Registers a 'search' predicate with window.EnsembleFilters.
 * Licensed under EUPL v. 1.2
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────

  const CARD_DESC_SELECTOR = '.cards .card-description';

  // Preserve the original text content of elements before any highlighting is
  // applied, so it can be restored exactly.
  const cachedTexts = new WeakMap();

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getCachedText(el) {
    if (!cachedTexts.has(el)) {
      cachedTexts.set(el, el.textContent);
    }
    return cachedTexts.get(el);
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyHighlight(descEl, query) {
    const original = getCachedText(descEl);

    if (!query) {
      descEl.textContent = original;
      return;
    }

    const re = new RegExp(escapeRegExp(query), 'gi');
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = re.exec(original)) !== null) {
      if (match[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(original.slice(lastIndex, match.index)));
      }
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = match[0];
      frag.appendChild(mark);
      lastIndex = re.lastIndex;
    }

    if (lastIndex < original.length) {
      frag.appendChild(document.createTextNode(original.slice(lastIndex)));
    }

    descEl.replaceChildren(frag);
  }

  function updateAllHighlights(query) {
    document.querySelectorAll(CARD_DESC_SELECTOR).forEach(function (el) {
      applyHighlight(el, query);
    });
  }

  // ── Search predicate ───────────────────────────────────────────────────────

  function buildSearchPredicate(query) {
    const lq = query.toLowerCase();
    return function searchPredicate(card) {
      const titleEl = card.querySelector('.card-title');
      const descEl = card.querySelector('.card-description');
      const titleText = titleEl ? getCachedText(titleEl) : '';
      const descText = descEl ? getCachedText(descEl) : '';
      const metaText = card.dataset.search || '';
      return titleText.toLowerCase().includes(lq)
        || descText.toLowerCase().includes(lq)
        || metaText.toLowerCase().includes(lq);
    };
  }

  function applySearch(query) {
    if (!window.EnsembleFilters) return;
    if (query) {
      window.EnsembleFilters.register('search', buildSearchPredicate(query));
    } else {
      window.EnsembleFilters.unregister('search');
    }
    updateAllHighlights(query);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');

    if (!searchInput) return;

    // Pre-cache original texts before any filtering modifies the DOM.
    document.querySelectorAll(CARD_DESC_SELECTOR).forEach(getCachedText);

    searchInput.addEventListener('input', function () {
      const query = searchInput.value.trim();
      if (clearBtn) clearBtn.hidden = !query;
      applySearch(query);
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        searchInput.value = '';
        clearBtn.hidden = true;
        applySearch('');
        searchInput.focus();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
