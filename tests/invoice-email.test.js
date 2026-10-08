import test from 'node:test';
import assert from 'node:assert/strict';
import { firstFriday, invoiceWindow, invoiceLink, composeUrl, mailtoUrl, gmailAppUrl, gmailComposeUrl, INVOICE_TO, INVOICE_GREETING } from '../public/invoice-email.js';

// Local midnight, so getDate()/getDay() match the intended calendar day regardless of the runner's TZ.
const at = (y, m, d) => new Date(y, m - 1, d);

test('firstFriday lands on the first Friday for months that start on various weekdays', () => {
  assert.equal(firstFriday(2026, 8).getDate(), 4);   // Sep 2026 starts Tue -> Fri the 4th
  assert.equal(firstFriday(2026, 4).getDate(), 1);   // May 2026 starts Fri -> Fri the 1st
  assert.equal(firstFriday(2026, 7).getDate(), 7);   // Aug 2026 starts Sat -> Fri the 7th
});

test('the nudge window runs from the 1st through the first Friday inclusive, then closes', () => {
  // September 2026: first Friday is the 4th.
  assert.equal(invoiceWindow(at(2026, 9, 1)).active, true);
  assert.equal(invoiceWindow(at(2026, 9, 4)).active, true);   // on the Friday: still shown
  assert.equal(invoiceWindow(at(2026, 9, 5)).active, false);  // the day after: gone
  // May 2026 starts on a Friday: window is a single day.
  assert.equal(invoiceWindow(at(2026, 5, 1)).active, true);
  assert.equal(invoiceWindow(at(2026, 5, 2)).active, false);
});

test('invoiceWindow invoices the JUST-COMPLETED previous month', () => {
  const w = invoiceWindow(at(2026, 9, 3));   // early September -> invoices August
  assert.equal(w.monthKey, '2026-08');
  assert.equal(w.monthName, 'August');
  assert.equal(w.monthTab, 'Aug26');         // must match store/invoice _monthTabName
  assert.equal(w.year, 2026);
  const oct = invoiceWindow(at(2026, 10, 1)); // 1 Oct -> invoices September ("send last month")
  assert.equal(oct.monthName, 'September');
  assert.equal(oct.monthTab, 'Sep26');
  assert.equal(oct.year, 2026);
});

test('invoiceWindow rolls the year back in January (invoices previous December)', () => {
  const w = invoiceWindow(at(2027, 1, 1));   // 1 Jan 2027 -> invoices December 2026
  assert.equal(w.monthName, 'December');
  assert.equal(w.monthTab, 'Dec26');
  assert.equal(w.monthKey, '2026-12');
  assert.equal(w.year, 2026);
});

test('invoiceLink targets J6 of the month tab when the gid is known, else the sheet', () => {
  const base = 'https://docs.google.com/spreadsheets/d/abc/edit';
  assert.equal(invoiceLink(base, 123), base + '#gid=123&range=J6');
  assert.equal(invoiceLink(base, 0), base + '#gid=0&range=J6');   // gid 0 is valid (Summary is 0 but months differ)
  assert.equal(invoiceLink(base, null), base);
  assert.equal(invoiceLink(base, undefined), base);
});

test('composeUrl builds a Gmail draft to the fixed address with the month, link and tutor sign-off', () => {
  const url = composeUrl({
    tutorName: 'Priya Shah', monthName: 'September', year: 2026,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit', monthGid: 77
  });
  const q = new URL(url).searchParams;
  assert.equal(new URL(url).origin + new URL(url).pathname, 'https://mail.google.com/mail/');
  assert.equal(q.get('to'), INVOICE_TO);
  assert.equal(q.get('su'), 'Intuitive Academy — Invoice for September 2026');
  const body = q.get('body');
  assert.match(body, /^Dear Veena,/);
  assert.match(body, /completed in September\.\n\nView it here: https:\/\/docs\.google\.com\/spreadsheets\/d\/abc\/edit#gid=77&range=J6/);
  assert.match(body, /Best,\nPriya Shah$/);
  assert.equal(INVOICE_GREETING, 'Veena');
});

test('on mobile, composeUrl returns a mailto: link so the phone mail app opens with a prefilled draft', () => {
  const url = composeUrl({
    tutorName: 'Priya Shah', monthName: 'September', year: 2026,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit', monthGid: 77, mobile: true
  });
  assert.ok(url.startsWith('mailto:info@intuitiveacademy.co.uk?subject='), 'mailto to the fixed address');
  const subject = decodeURIComponent(url.split('?subject=')[1].split('&body=')[0]);
  const body = decodeURIComponent(url.split('&body=')[1]);
  assert.equal(subject, 'Intuitive Academy — Invoice for September 2026');
  assert.match(body, /^Dear Veena,/);
  assert.match(body, /completed in September\.\n\nView it here: https:\/\/docs\.google\.com\/spreadsheets\/d\/abc\/edit#gid=77&range=J6/);
  assert.match(body, /Best,\nPriya Shah$/);
  assert.equal(url, mailtoUrl({ tutorName: 'Priya Shah', monthName: 'September', year: 2026, sheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit', monthGid: 77 }));
});

test('gmailAppUrl deep-links the Gmail app compose screen with the draft prefilled', () => {
  const url = gmailAppUrl({
    tutorName: 'Priya Shah', monthName: 'September', year: 2026,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit', monthGid: 77
  });
  assert.ok(url.startsWith('googlegmail://co?to=info%40intuitiveacademy.co.uk'), 'gmail app scheme to the fixed address');
  const body = decodeURIComponent(url.split('&body=')[1]);
  assert.match(body, /^Dear Veena,/);
  assert.match(body, /completed in September\.\n\nView it here: https:\/\/docs\.google\.com\/spreadsheets\/d\/abc\/edit#gid=77&range=J6/);
  assert.match(body, /Best,\nPriya Shah$/);
});

test('on desktop, composeUrl returns the Gmail web compose URL', () => {
  const opts = { tutorName: 'A', monthName: 'March', year: 2026, sheetUrl: 'https://x/edit', monthGid: null };
  assert.ok(composeUrl({ ...opts, mobile: false }).startsWith('https://mail.google.com/mail/?view=cm'));
  assert.equal(composeUrl({ ...opts }), gmailComposeUrl(opts), 'defaults to Gmail web when mobile is unset');
});

test('composeUrl percent-encodes the body so newlines and spaces survive', () => {
  const url = composeUrl({ tutorName: 'A B', monthName: 'March', year: 2026, sheetUrl: 'https://x/edit', monthGid: null });
  assert.ok(url.includes('&body=Dear%20Veena%2C%0A%0A'), 'newlines encoded as %0A, spaces as %20');
  assert.ok(!url.includes('\n'), 'no raw newlines in the URL');
});
