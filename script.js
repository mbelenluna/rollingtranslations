document.addEventListener('DOMContentLoaded', () => {
  // ===== Cookie Banner + Google Consent Mode v2 =====
  // Estado por defecto: denied (se eleva a granted al aceptar)
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }

  (function initConsent() {
    // Default (antes de cargar GTM)
    gtag('consent', 'default', {
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });

    // Aplicar preferencia guardada
    try {
      const saved = JSON.parse(localStorage.getItem('rtConsent'));
      if (saved && saved.applied) {
        gtag('consent', 'update', saved.values);
      } else {
        const banner = document.getElementById('rt-cookie-banner');
        if (banner) banner.style.display = 'block';
      }
    } catch (_) { }
  })();

  function applyConsent(values) {
    gtag('consent', 'update', values);
    localStorage.setItem('rtConsent', JSON.stringify({ applied: true, values, ts: Date.now() }));
    const banner = document.getElementById('rt-cookie-banner');
    if (banner) banner.style.display = 'none';
    gtag('event', 'cookie_consent_update', { consent_state: values });
  }

  const acceptBtn = document.getElementById('rt-consent-accept');
  const rejectBtn = document.getElementById('rt-consent-reject');
  if (acceptBtn) acceptBtn.addEventListener('click', () => {
    applyConsent({
      ad_storage: 'granted',
      analytics_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted'
    });
  });
  if (rejectBtn) rejectBtn.addEventListener('click', () => {
    applyConsent({
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
  });

  // Re-open the banner on demand
  const openConsentLink = document.getElementById('rt-open-consent');
  if (openConsentLink) {
    openConsentLink.addEventListener('click', function (e) {
      e.preventDefault();
      const banner = document.getElementById('rt-cookie-banner');
      if (banner) banner.style.display = 'block';
    });
  }

  // Optional: programmatic revoke (e.g., for a "Reject all" in a privacy page)
  function rtRevokeConsent() {
    const values = {
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    };
    // Update Consent Mode and persist
    if (typeof gtag === 'function') gtag('consent', 'update', values);
    localStorage.setItem('rtConsent', JSON.stringify({ applied: true, values, ts: Date.now() }));
    // Show banner again if you want the user to reconsider
    const banner = document.getElementById('rt-cookie-banner');
    if (banner) banner.style.display = 'block';
  }

  // ===== Header shadow on scroll (safe) =====
  const header = document.getElementById('site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 2);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ===== Mobile nav (use IDs present in index.html, guard nulls) =====
  const navToggle = document.getElementById('navToggle');
  const mobileNav = document.getElementById('mobileNav');
  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', () => {
      const open = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!open));
      mobileNav.classList.toggle('is-open', !open);
      document.body.classList.toggle('no-scroll', !open);
    });
    mobileNav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        navToggle.setAttribute('aria-expanded', 'false');
        mobileNav.classList.remove('is-open');
        document.body.classList.remove('no-scroll');
      });
    });
  }

  // ===== Contact form (EmailJS) =====
  // Ya manejado vía submit del formulario (evita doble envío por click del botón)
  const form = document.getElementById('contact-form');
  const submitBtn = document.getElementById('submit-button');

  function validateRequired(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault(); // <-- prevents default GET to /?fullname=...

      const fullname = (form.querySelector('#fullname') || {}).value || '';
      const email = (form.querySelector('#email') || {}).value || '';
      const message = (form.querySelector('#message') || {}).value || '';

      if (!validateRequired(fullname) || !validateRequired(email) || !validateRequired(message)) {
        alert('Please fill in all required fields (Full name, Email, and Message) before submitting.');
        return;
      }

      // Build payload expected by your EmailJS template
      const payload = {
        from_name: fullname,
        email_id: email,
        phone_number: (form.querySelector('#phonenumber') || {}).value || '',
        source_language: (form.querySelector('#sourcelanguage') || {}).value || '',
        target_language: (form.querySelector('#targetlanguage') || {}).value || '',
        message: message,
      };

      // Visual feedback
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
      }

      // Send via EmailJS (service & template IDs from current setup)
      // emailjs must already be loaded on the page and initialized.
      emailjs.send('service_4thavy7', 'template_bfqz58e', payload)
        .then(() => {
          const successPath = window.location.pathname.includes('/pages/')
            ? '../success.html'
            : 'success.html';

          window.location.href = successPath;
        })
        .catch((err) => {
          console.error('EmailJS error:', err);
          alert('Sorry, something went wrong. Please try again or email us at info@rolling-translations.com.');
        })
        .finally(() => {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'SUBMIT';
          }
        });
    });
  }

  // ======== LEGACY HOVER HANDLERS (added back, exposed globally) ========
  // Nota: buscamos los elementos dentro de cada handler para no depender
  // de variables globales (exp/qual/clients/...), y las exponemos en window
  // porque about.html las llama por nombre (functionIn1, etc.).

  window.functionIn1 = function () {
    const el = document.querySelector('.exp');
    if (el) el.innerHTML = "Our team comprises highly skilled translators, linguists, and subject matter experts with deep domain knowledge in various industries, ensuring accurate and contextually appropriate translations.";
  };
  window.functionOut1 = function () {
    const el = document.querySelector('.exp');
    if (el) el.innerHTML = "1. Expertise and Specialization";
  };

  window.functionIn2 = function () {
    const el = document.querySelector('.qual');
    if (el) el.innerHTML = "Quality is at the heart of our operations. We have stringent quality assurance processes in place to ensure that every translation undergoes thorough review and linguistic validation.";
  };
  window.functionOut2 = function () {
    const el = document.querySelector('.qual');
    if (el) el.innerHTML = "2. Uncompromising Quality";
  };

  window.functionIn3 = function () {
    const el = document.querySelector('.clients');
    if (el) el.innerHTML = "We are proud to serve a diverse range of clients, including multinational corporations, government agencies, educational institutions, and small to medium-sized enterprises.";
  };
  window.functionOut3 = function () {
    const el = document.querySelector('.clients');
    if (el) el.innerHTML = "3. Diverse and Loyal Client Base";
  };

  window.functionIn4 = function () {
    const el = document.querySelector('.reach');
    if (el) el.innerHTML = "With an extensive network of professional translators and resources in multiple languages, we have the capability to provide translation services for a wide range of language pairs.";
  };
  window.functionOut4 = function () {
    const el = document.querySelector('.reach');
    if (el) el.innerHTML = "4. Global Reach and Language Capabilities";
  };

  window.functionIn5 = function () {
    const el = document.querySelector('.tech');
    if (el) el.innerHTML = "We embrace cutting-edge translation technologies, including advanced CAT (Computer-Assisted Translation) tools, to enhance our efficiency and accuracy.";
  };
  window.functionOut5 = function () {
    const el = document.querySelector('.tech');
    if (el) el.innerHTML = "5. Technological Advancements";
  };

  window.functionIn6 = function () {
    const el = document.querySelector('.imp');
    if (el) el.innerHTML = "By embracing innovation and continuously improving our processes, we strive to provide our clients with the most efficient and effective translation solutions available.";
  };
  window.functionOut6 = function () {
    const el = document.querySelector('.imp');
    if (el) el.innerHTML = "6. Continuous Improvement and Innovation";
  };

  // ======== Header slide-down (from your snippet) ========
  (function () {
    const fixedHeader = document.querySelector('.fixed-header');
    if (!fixedHeader) return;
    let lastScrollPosition = 0;
    window.addEventListener('scroll', function () {
      if (window.innerWidth > 768) {
        const current = window.scrollY;
        if (current > lastScrollPosition) {
          fixedHeader.classList.add('slide-down');
        } else {
          fixedHeader.classList.remove('slide-down');
        }
        lastScrollPosition = current;
      }
    }, { passive: true });
  })();

  // ======== Mobile hamburger & sticky (from your snippet, guarded) ========
  (function () {
    const menu_btn = document.querySelector(".hamburger");
    const mobile_menu = document.querySelector('.mobile-nav');
    if (menu_btn && mobile_menu) {
      menu_btn.addEventListener('click', function () {
        menu_btn.classList.toggle('is-active');
        mobile_menu.classList.toggle('is-active');
      });

      // Sticky behavior
      const navbar = mobile_menu;
      const sticky = navbar.offsetTop;
      function stick() {
        if (window.scrollY >= sticky) {
          navbar.classList.add("sticky");
        } else {
          navbar.classList.remove("sticky");
        }
      }
      window.addEventListener('scroll', stick, { passive: true });
    }
  })();

  // ===== Helper: update helper text for values (mirror of your onload) =====
  (function () {
    const values = document.querySelector(".hover");
    if (values && window.innerWidth < 768) {
      values.innerHTML = "Click on each value to learn more.";
    }
  })();

}); // END DOMContentLoaded