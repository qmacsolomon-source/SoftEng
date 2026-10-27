const hasQuotationId = Boolean(new URLSearchParams(window.location.search).get('id'));

if (hasQuotationId) {
  document.querySelector('#quotation-wizard-view').hidden = true;
  document.querySelector('#quotation-detail-view').hidden = false;
  await import('./quotation-detail.js');
} else {
  await import('./quotation-detail-wizard.js');
}
