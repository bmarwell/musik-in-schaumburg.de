/* filters.js – Musik in Schaumburg
 * Client-side filtering for ensemble cards.
 * Designed to be extended with further filter dimensions (e.g. search, type).
 * Licensed under EUPL v. 1.2
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────

  const state = {
    activeFilter: readHashFilter(),
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function readHashFilter() {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'active' || hash === 'inactive') return hash;
    return 'all';
  }

  function cardMatchesFilter(card, filter) {
    if (filter === 'all') return true;
    const isActive = card.dataset.active === 'true';
    if (filter === 'active') return isActive;
    if (filter === 'inactive') return !isActive;
    return true;
  }

  // ── DOM update ─────────────────────────────────────────────────────────────

  function applyFilters() {
    const cards = document.querySelectorAll('.cards .card');
    const filter = state.activeFilter;

    let visibleCount = 0;
    cards.forEach(function (card) {
      const visible = cardMatchesFilter(card, filter);
      card.hidden = !visible;
      if (visible) visibleCount++;
    });

    updateFilterButtons(filter);
    updateEmptyState(visibleCount);
  }

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
    state.activeFilter = filter;
    history.replaceState(null, '', filter === 'all' ? window.location.pathname : '#' + filter);
    applyFilters();
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    const buttons = document.querySelectorAll('.filter-btn');
    if (!buttons.length) return;

    buttons.forEach(function (btn) {
      btn.addEventListener('click', onFilterButtonClick);
    });

    window.addEventListener('hashchange', function () {
      state.activeFilter = readHashFilter();
      applyFilters();
    });

    applyFilters();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
