'use strict';

const { resolveCards } = require('./umbrella_homepage');
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Uses the same verified destinations as the six homepage cards. This is a
// routing form, not a second lead collector: contact details stay on the
// canonical site's request form. Hidden until its submit handler is ready.
function renderProviderStart(root) {
  const options = resolveCards(root).map((c) => `<option value="${escape(c.provider)}">${escape(c.title)}</option>`).join('');
  return `<section data-provider-start-section="true" class="uh-how">
    <div class="uh-wrap">
      <h2>Start a provider request</h2>
      <form data-provider-start data-clarity-mask="true" action="/#vertical-routes" method="get" hidden>
        <label for="provider-guide">What kind of provider do you need?</label>
        <select id="provider-guide" name="provider" required><option value="">Choose a guide site</option>${options}</select>
        <button type="submit" class="uh-btn primary">Continue to the request form</button>
        <p>You will finish your request on the selected guide site. No contact details are collected here.</p>
        <div data-analytics-choice hidden>
          <p>Optional: allow Microsoft Clarity to record this page's interactions to help us improve this step. Your provider choice is masked. Advertising storage stays off. <a href="/privacy">Privacy</a></p>
          <button type="button" data-analytics-allow>Allow session analytics for this visit</button>
          <button type="button" data-analytics-stop hidden>Stop session analytics</button>
          <p role="status" data-analytics-status>Session analytics are off.</p>
        </div>
      </form>
      <noscript><p>Use a Find a Provider link in the guide cards above to continue.</p></noscript>
    </div>
  </section>`;
}

// Frozen accepted HTML is restored by build_site.js. Apply the same source
// template at publish time, just as the existing head installers do, so a
// rebuild cannot silently restore a homepage without the conversion step.
function installProviderStart(html, root) {
  if (html.includes('data-provider-start-section="true"')) return html;
  const marker = /<section\b[^>]*\bid="how"[^>]*>/i;
  if (!marker.test(html)) throw new Error('provider-start: homepage is missing its How section; refusing to write');
  return html.replace(marker, (section) => `${renderProviderStart(root)}\n  ${section}`);
}

module.exports = { renderProviderStart, installProviderStart };
