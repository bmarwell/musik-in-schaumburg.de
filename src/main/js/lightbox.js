/* Lightbox — musik-in-schaumburg.de
 * Licensed under EUPL v. 1.2
 *
 * Opens images in a full-screen overlay when clicked.
 * Images must have data-lightbox="true" (or be inside .orchestra-hero).
 */
(function () {
  'use strict';

  function createOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'lightbox-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Bildvorschau');

    var closeBtn = document.createElement('button');
    closeBtn.id = 'lightbox-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Schließen');

    var img = document.createElement('img');
    img.id = 'lightbox-img';
    img.setAttribute('alt', '');

    overlay.appendChild(closeBtn);
    overlay.appendChild(img);
    document.body.appendChild(overlay);

    return { overlay: overlay, img: img, closeBtn: closeBtn };
  }

  function openLightbox(src, alt) {
    var els = document.getElementById('lightbox-overlay')
      ? {
          overlay: document.getElementById('lightbox-overlay'),
          img: document.getElementById('lightbox-img'),
          closeBtn: document.getElementById('lightbox-close'),
        }
      : createOverlay();

    els.img.src = src;
    els.img.alt = alt || '';
    els.overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    els.closeBtn.focus();
  }

  function closeLightbox() {
    var overlay = document.getElementById('lightbox-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    createOverlay();

    var overlay = document.getElementById('lightbox-overlay');
    var closeBtn = document.getElementById('lightbox-close');

    // Close on overlay click or close button
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target === closeBtn) {
        closeLightbox();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeLightbox();
      }
    });

    // Bind click events to lightbox images
    var images = document.querySelectorAll('[data-lightbox]');
    images.forEach(function (el) {
      el.style.cursor = 'zoom-in';
      el.addEventListener('click', function () {
        var src = el.dataset.lightboxSrc || el.src || el.currentSrc;
        var alt = el.alt || el.dataset.lightboxAlt || '';
        if (src) {
          openLightbox(src, alt);
        }
      });
    });
  });
})();
