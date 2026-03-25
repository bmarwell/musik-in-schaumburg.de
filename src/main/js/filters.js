/* filters.js – Musik in Schaumburg
 * Client-side filtering for ensemble cards.
 * Licensed under EUPL v. 1.2
 *
 * Architecture – named-predicate registry:
 *   Each filter dimension registers a named predicate function.
 *   A card is visible only when ALL registered predicates return true.
 *
 * Extending from another script (e.g. a search bar for #102):
 *
 *   window.EnsembleFilters.register('search', card => {
 *     const q = document.getElementById('search-input').value.trim().toLowerCase();
 *     return !q || card.textContent.toLowerCase().includes(q);
 *   });
 *
 *   Call window.EnsembleFilters.apply() after updating the predicate to
 *   refresh card visibility without touching this file.
 */

(function () {
  'use strict';

  // ── Predicate registry ─────────────────────────────────────────────────────
  // Maps filter dimension name → (card) => boolean.
  // All predicates must return true for a card to be visible.

  const predicates = {};

  // ── Core ───────────────────────────────────────────────────────────────────

  function applyFilters() {
    const cards = document.querySelectorAll('.cards .card');
    const fns = Object.values(predicates);

    let visibleCount = 0;
    cards.forEach(function (card) {
      const visible = fns.every(function (fn) { return fn(card); });
      card.hidden = !visible;
      if (visible) visibleCount++;
    });

    updateEmptyState(visibleCount);
  }

  // ── Status filter ──────────────────────────────────────────────────────────

  let currentStatus = 'all';

  function readHashFilter() {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'active' || hash === 'inactive') return hash;
    return 'all';
  }

  function buildStatusPredicate(filter) {
    if (filter === 'active') return function (card) { return card.dataset.active === 'true'; };
    if (filter === 'inactive') return function (card) { return card.dataset.active === 'false'; };
    return function () { return true; };
  }

  function setStatusFilter(filter) {
    predicates['status'] = buildStatusPredicate(filter);
    history.replaceState(null, '', filter === 'all' ? window.location.pathname : '#' + filter);
    applyFilters();
  }

  function renderStatusWidget() {
    const valueEl = document.getElementById('filter-status-value');
    if (!valueEl) return;
    const options = document.querySelectorAll('#filter-status-listbox .ms-option');
    const selected = Array.from(options).find(function (o) { return o.dataset.value === currentStatus; });
    valueEl.textContent = selected ? selected.textContent : 'Alle';
    if (currentStatus === 'all') {
      valueEl.classList.add('is-placeholder');
    } else {
      valueEl.classList.remove('is-placeholder');
    }
    options.forEach(function (opt) {
      opt.setAttribute('aria-selected', String(opt.dataset.value === currentStatus));
    });
  }

  function selectStatus(value) {
    currentStatus = value;
    setStatusFilter(value);
    renderStatusWidget();
    closeStatusListbox();
  }

  function openStatusListbox() {
    const listbox = document.getElementById('filter-status-listbox');
    const widget = document.getElementById('filter-status-widget');
    if (!listbox || !widget) return;
    listbox.hidden = false;
    widget.setAttribute('aria-expanded', 'true');
  }

  function closeStatusListbox() {
    const listbox = document.getElementById('filter-status-listbox');
    const widget = document.getElementById('filter-status-widget');
    if (!listbox || !widget) return;
    listbox.hidden = true;
    widget.setAttribute('aria-expanded', 'false');
  }

  function toggleStatusListbox() {
    const listbox = document.getElementById('filter-status-listbox');
    if (!listbox) return;
    if (listbox.hidden) {
      openStatusListbox();
    } else {
      closeStatusListbox();
    }
  }

  // ── Type multiselect combobox ──────────────────────────────────────────────

  const selectedTypes = new Set();

  function syncTypePredicate() {
    if (selectedTypes.size === 0) {
      delete predicates['type'];
      return;
    }
    predicates['type'] = function typeFilter(card) { return selectedTypes.has(card.dataset.type); };
  }

  function getLabelForType(type) {
    const options = document.querySelectorAll('#filter-type-listbox .ms-option');
    for (let i = 0; i < options.length; i++) {
      if (options[i].dataset.type === type) return options[i].dataset.label;
    }
    return type;
  }

  function buildTag(type) {
    const tag = document.createElement('span');
    tag.className = 'ms-tag';
    tag.dataset.tagType = type;

    const text = document.createTextNode(getLabelForType(type));
    tag.appendChild(text);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ms-tag-remove';
    removeBtn.setAttribute('aria-label', getLabelForType(type) + ' entfernen');
    removeBtn.textContent = '\u00d7';
    removeBtn.addEventListener('click', function (evt) {
      evt.stopPropagation();
      deselectType(type);
    });
    tag.appendChild(removeBtn);
    return tag;
  }

  function renderTypeTags() {
    const field = document.getElementById('filter-type-field');
    const placeholder = document.getElementById('filter-type-placeholder');
    const clearBtn = document.getElementById('filter-type-clear');
    if (!field) return;

    field.querySelectorAll('.ms-tag').forEach(function (t) { t.remove(); });

    if (selectedTypes.size === 0) {
      if (placeholder) placeholder.hidden = false;
      if (clearBtn) clearBtn.hidden = true;
      return;
    }

    if (placeholder) placeholder.hidden = true;
    if (clearBtn) clearBtn.hidden = false;
    selectedTypes.forEach(function (type) {
      field.appendChild(buildTag(type));
    });
  }

  function renderTypeOptions() {
    document.querySelectorAll('#filter-type-listbox .ms-option').forEach(function (opt) {
      opt.setAttribute('aria-selected', String(selectedTypes.has(opt.dataset.type)));
    });
  }

  function updateTypeWidget() {
    renderTypeTags();
    renderTypeOptions();
  }

  function deselectType(type) {
    selectedTypes.delete(type);
    syncTypePredicate();
    updateTypeWidget();
    applyFilters();
  }

  function toggleType(type) {
    if (selectedTypes.has(type)) {
      selectedTypes.delete(type);
    } else {
      selectedTypes.add(type);
    }
    syncTypePredicate();
    updateTypeWidget();
    applyFilters();
  }

  function clearTypeFilter() {
    selectedTypes.clear();
    syncTypePredicate();
    updateTypeWidget();
    applyFilters();
  }

  function openTypeListbox() {
    const listbox = document.getElementById('filter-type-listbox');
    const widget = document.getElementById('filter-type-widget');
    if (!listbox || !widget) return;
    listbox.hidden = false;
    widget.setAttribute('aria-expanded', 'true');
  }

  function closeTypeListbox() {
    const listbox = document.getElementById('filter-type-listbox');
    const widget = document.getElementById('filter-type-widget');
    if (!listbox || !widget) return;
    listbox.hidden = true;
    widget.setAttribute('aria-expanded', 'false');
  }

  function toggleTypeListbox() {
    const listbox = document.getElementById('filter-type-listbox');
    if (!listbox) return;
    if (listbox.hidden) {
      openTypeListbox();
    } else {
      closeTypeListbox();
    }
  }

  function onDocumentClick(evt) {
    const typeWidget = document.getElementById('filter-type-widget');
    if (!typeWidget || !typeWidget.contains(evt.target)) {
      closeTypeListbox();
    }
    const statusWidget = document.getElementById('filter-status-widget');
    if (!statusWidget || !statusWidget.contains(evt.target)) {
      closeStatusListbox();
    }
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────

  function updateEmptyState(visibleCount) {
    const existing = document.getElementById('filter-empty-state');
    if (visibleCount > 0) {
      if (existing) existing.hidden = true;
      return;
    }
    if (existing) {
      existing.hidden = false;
      return;
    }
    const cards = document.querySelector('.cards');
    if (!cards) return;
    const msg = document.createElement('p');
    msg.id = 'filter-empty-state';
    msg.className = 'filter-empty-state';
    msg.textContent = 'Keine Ensembles für diesen Filter gefunden.';
    cards.insertAdjacentElement('afterend', msg);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    const statusWidget = document.getElementById('filter-status-widget');
    const statusOptions = document.querySelectorAll('#filter-status-listbox .ms-option');
    const typeWidget = document.getElementById('filter-type-widget');
    const typeClearBtn = document.getElementById('filter-type-clear');
    const typeOptions = document.querySelectorAll('#filter-type-listbox .ms-option');

    currentStatus = readHashFilter();
    renderStatusWidget();
    setStatusFilter(currentStatus);

    if (statusWidget) {
      statusWidget.addEventListener('click', function (evt) {
        evt.stopPropagation();
        toggleStatusListbox();
      });

      statusWidget.addEventListener('keydown', function (evt) {
        const listbox = document.getElementById('filter-status-listbox');
        if (evt.key === 'Escape') {
          closeStatusListbox();
          return;
        }
        if (evt.key === 'Enter' || evt.key === ' ') {
          if (!listbox || listbox.hidden) {
            evt.preventDefault();
            openStatusListbox();
            const first = listbox.querySelector('.ms-option');
            if (first) first.focus();
          }
          return;
        }
        if (evt.key === 'ArrowDown' && listbox && listbox.hidden) {
          evt.preventDefault();
          openStatusListbox();
          const first = listbox.querySelector('.ms-option');
          if (first) first.focus();
        }
      });
    }

    statusOptions.forEach(function (opt) {
      opt.addEventListener('click', function (evt) {
        evt.stopPropagation();
        selectStatus(opt.dataset.value);
      });
      opt.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          selectStatus(opt.dataset.value);
          return;
        }
        if (evt.key === 'Escape') {
          closeStatusListbox();
          const field = document.getElementById('filter-status-field');
          if (field) field.focus();
          return;
        }
        if (evt.key === 'ArrowDown') {
          evt.preventDefault();
          const next = opt.nextElementSibling;
          if (next) next.focus();
          return;
        }
        if (evt.key === 'ArrowUp') {
          evt.preventDefault();
          const prev = opt.previousElementSibling;
          if (prev) prev.focus();
        }
      });
    });

    if (typeWidget) {
      typeWidget.addEventListener('click', function (evt) {
        if (evt.target.closest('.ms-tag-remove')) return;
        if (evt.target.closest('.ms-clear-btn')) return;
        evt.stopPropagation();
        toggleTypeListbox();
      });

      typeWidget.addEventListener('keydown', function (evt) {
        const listbox = document.getElementById('filter-type-listbox');
        if (evt.key === 'Escape') {
          closeTypeListbox();
          return;
        }
        if (evt.key === 'Enter' || evt.key === ' ') {
          if (!listbox || listbox.hidden) {
            evt.preventDefault();
            openTypeListbox();
            const first = listbox.querySelector('.ms-option');
            if (first) first.focus();
          }
          return;
        }
        if (evt.key === 'ArrowDown' && listbox && listbox.hidden) {
          evt.preventDefault();
          openTypeListbox();
          const first = listbox.querySelector('.ms-option');
          if (first) first.focus();
        }
      });
    }

    if (typeClearBtn) {
      typeClearBtn.addEventListener('click', function (evt) {
        evt.stopPropagation();
        clearTypeFilter();
      });
    }

    typeOptions.forEach(function (opt) {
      opt.addEventListener('click', function (evt) {
        evt.stopPropagation();
        toggleType(opt.dataset.type);
      });
      opt.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          toggleType(opt.dataset.type);
          return;
        }
        if (evt.key === 'Escape') {
          closeTypeListbox();
          const field = document.getElementById('filter-type-field');
          if (field) field.focus();
          return;
        }
        if (evt.key === 'ArrowDown') {
          evt.preventDefault();
          const next = opt.nextElementSibling;
          if (next) next.focus();
          return;
        }
        if (evt.key === 'ArrowUp') {
          evt.preventDefault();
          const prev = opt.previousElementSibling;
          if (prev) prev.focus();
        }
      });
    });

    document.addEventListener('click', onDocumentClick);

    window.addEventListener('hashchange', function () {
      selectStatus(readHashFilter());
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  // Exposed so other scripts (e.g. a search bar) can register filter
  // predicates without modifying this file.

  window.EnsembleFilters = {
    /**
     * Register (or replace) a named filter predicate.
     * Immediately re-applies all filters.
     * @param {string} name – dimension identifier, e.g. 'search', 'type'
     * @param {function(HTMLElement): boolean} predicate
     */
    register: function (name, predicate) {
      predicates[name] = predicate;
      applyFilters();
    },
    /** Remove a named filter predicate and re-apply. */
    unregister: function (name) {
      delete predicates[name];
      applyFilters();
    },
    /** Re-apply all registered predicates (call after updating external state). */
    apply: applyFilters,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
