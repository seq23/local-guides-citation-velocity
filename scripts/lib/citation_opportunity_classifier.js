'use strict';

const { classifyRichNewPage } = require('./rich_new_page_classifier');

function classifyOpportunity(row) {
  const operation = String(row.operation || '').toUpperCase();
  if (operation === 'REPAIR_INTENDED_WINNER_PAGE' || row.intended_winner_path) {
    return { family: 'REPAIR_EXISTING', reason: 'existing_target_repair' };
  }
  const rich = classifyRichNewPage(row);
  return { family: rich.route_family, reason: rich.reason, rich_page_type: rich.rich_page_type };
}
module.exports = { classifyOpportunity };
