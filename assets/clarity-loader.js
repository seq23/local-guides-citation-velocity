(function clarityRuntime(w, d, projects) {
  const form = d.querySelector('[data-provider-start]');
  if (form) {
    const select = form.querySelector('select');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const chosen = Array.from(select.options).find((option) => option.value === select.value && option.value);
      if (!chosen) return;
      const destination = new URL(chosen.value);
      if (destination.protocol !== 'https:' || destination.pathname !== '/request-assistance/') return;
      w.location.assign(destination.href);
    });
    form.hidden = false;
  }

  const host = (w.location.hostname || '').toLowerCase().replace(/^www\./, '');
  const id = projects[host];
  const allow = d.querySelector('[data-analytics-allow]');
  const stop = d.querySelector('[data-analytics-stop]');
  const choice = d.querySelector('[data-analytics-choice]');
  const status = d.querySelector('[data-analytics-status]');
  if (!id || !allow || !stop || !choice || !status) return;
  choice.hidden = false;
  let started = false;
  allow.addEventListener('click', () => {
    if (started) return;
    started = true;
    w.clarity = w.clarity || function () { (w.clarity.q = w.clarity.q || []).push(arguments); };
    // https://learn.microsoft.com/clarity/setup-and-installation/clarity-consent-api-v2
    w.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
    const script = d.createElement('script');
    script.async = true;
    script.src = 'https://www.clarity.ms/tag/' + id;
    d.head.appendChild(script);
    allow.hidden = true;
    stop.hidden = false;
    status.textContent = 'Session analytics are on for this page. You can stop them at any time.';
  });
  stop.addEventListener('click', () => {
    if (!started) return;
    w.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' });
    w.clarity('stop');
    stop.hidden = true;
    status.textContent = 'Session analytics are off. Reload the page if you want to allow them again.';
  });
})(window,document,{"theindustryguides.com":"y7ktdoryc2"});
