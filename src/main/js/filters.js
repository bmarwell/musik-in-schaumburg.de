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

  // ── Status filter (built-in dimension) ────────────────────────────────────

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
    updateFilterButtons(filter);
    applyFilters();
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────

  function updateFilterButtons(activeFilter) {
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(function (btn) {
      const selected = btn.dataset.filter === activeFilter;
      btn.classList.toggle('filter-btn--selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }

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

  // ── Event handling ─────────────────────────────────────────────────────────

  function onFilterButtonClick(evt) {
    const btn = evt.currentTarget;
    const filter = btn.dataset.filter;
    if (!filter) return;
    setStatusFilter(filter);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    const buttons = document.querySelectorAll('.filter-btn');
    if (buttons.length) {
      buttons.forEach(function (btn) {
        btn.addEventListener('click', onFilterButtonClick);
      });
    }

    window.addEventListener('hashchange', function () {
      const filter = readHashFilter();
      setStatusFilter(filter);
    });

    setStatusFilter(readHashFilter());
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
