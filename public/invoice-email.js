// End-of-month invoice-email helpers. Pure: no DOM, no network, no credentials.
// The button opens a pre-filled Gmail compose draft; the tutor reviews and sends it themselves.

// Fixed recipient for every tutor's monthly invoice.
export const INVOICE_TO = 'info@intuitiveacademy.co.uk';
export const INVOICE_GREETING = 'Veena';

const ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// First Friday of the given month (0-based monthIndex). getDay(): Sun=0 .. Fri=5.
export function firstFriday(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const offset = (5 - first.getDay() + 7) % 7;
  return new Date(year, monthIndex, 1 + offset);
}

// The nudge appears in the first week (1st -> first Friday) of the current month and invoices the
// JUST-COMPLETED previous month — so 1 Oct sends last month's (September's) invoice. Year rolls back in January.
export function invoiceWindow(now) {
  const y = now.getFullYear(), m = now.getMonth();
  const ff = firstFriday(y, m);
  const prev = new Date(y, m - 1, 1);                       // previous month; new Date handles Jan -> Dec of prior year
  const py = prev.getFullYear(), pm = prev.getMonth();
  return {
    active: now.getDate() <= ff.getDate(),                  // WHEN: first week of the current month (through the first Friday, inclusive)
    year: py,                                               // WHAT: the just-completed month and its year
    monthKey: py + '-' + String(pm + 1).padStart(2, '0'),  // 'YYYY-MM'
    monthName: FULL[pm],                                    // 'September' — email body/subject
    monthTab: ABBR[pm] + String(py).slice(-2),             // 'Sep26' — matches the sheet tab title
    firstFridayDate: ff.getDate()
  };
}

// Deep link to J6 (Total payment) of the month tab, when its gid is known; else the sheet itself.
export function invoiceLink(sheetUrl, monthGid) {
  return (monthGid || monthGid === 0)
    ? sheetUrl + '#gid=' + monthGid + '&range=J6'
    : sheetUrl;
}

export function invoiceSubject(opts) {
  return 'Intuitive Academy — Invoice for ' + opts.monthName + ' ' + opts.year;
}
// Plain text (compose links carry no HTML), so the word "here" is followed by the invoice link.
export function invoiceBody(opts) {
  const link = invoiceLink(opts.sheetUrl, opts.monthGid);
  return [
    'Dear ' + INVOICE_GREETING + ',',
    '',
    'Attached is the invoice for the hours completed in ' + opts.monthName + '.',
    '',
    'View it here: ' + link,
    '',
    'Best,',
    opts.tutorName
  ].join('\n');
}
// Desktop: Gmail web compose (honours the tutor's Gmail preference, opens in a new tab).
export function gmailComposeUrl(opts) {
  return 'https://mail.google.com/mail/?view=cm&fs=1'
    + '&to=' + encodeURIComponent(INVOICE_TO)
    + '&su=' + encodeURIComponent(invoiceSubject(opts))
    + '&body=' + encodeURIComponent(invoiceBody(opts));
}
// Mobile, preferred: open the Gmail app's compose screen directly (googlegmail:// scheme).
export function gmailAppUrl(opts) {
  return 'googlegmail://co'
    + '?to=' + encodeURIComponent(INVOICE_TO)
    + '&subject=' + encodeURIComponent(invoiceSubject(opts))
    + '&body=' + encodeURIComponent(invoiceBody(opts));
}
// Mobile fallback: mailto opens the phone's default mail app with the draft prefilled.
// The Gmail ?view=cm link is desktop-only — on a phone Gmail drops the params and lands on the Inbox.
export function mailtoUrl(opts) {
  return 'mailto:' + INVOICE_TO
    + '?subject=' + encodeURIComponent(invoiceSubject(opts))
    + '&body=' + encodeURIComponent(invoiceBody(opts));
}
export function composeUrl(opts) {
  return opts && opts.mobile ? mailtoUrl(opts) : gmailComposeUrl(opts);
}
