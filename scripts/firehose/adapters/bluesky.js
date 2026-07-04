'use strict';
const { blockedResult, safeDisabled, passResult } = require('./adapter_common');
async function collect(source) {
  const disabled = safeDisabled(source);
  if (disabled) return disabled;
  if (process.env.ENABLE_LIVE_FIREHOSE !== '1') return blockedResult(source, 'Live bluesky collection is disabled unless ENABLE_LIVE_FIREHOSE=1 and source authority exists.');
  return passResult(source, [], ['Live bluesky adapter interface is present but has no credentialed collection implementation in this repo.']);
}
module.exports = { collect };
