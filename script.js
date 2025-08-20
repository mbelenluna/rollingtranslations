
// Rolling Translations — site JS (safe, minimal)
document.addEventListener('DOMContentLoaded', () => {
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
          window.location.href = 'success.html';
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
});
