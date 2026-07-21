import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMailContent, plainTextFromHtml } from './mailContent.js';

test('plainTextFromHtml keeps signing links and readable text', () => {
  const text = plainTextFromHtml(
    '<p>Hello Tony,</p><p><a href="https://sign.example.com/login/token">Review and sign</a></p>'
  );

  assert.match(text, /Hello Tony/);
  assert.match(text, /Review and sign\nhttps:\/\/sign\.example\.com\/login\/token/);
});

test('portal mail omits the OpenSign complaint footer and placeholder text', () => {
  const content = buildMailContent({
    html: '<p>A document needs your signature.</p>',
    portalMode: true,
    reportHtml: '<p>Report spam to OpenSign</p>',
    subject: 'Signature requested',
    text: 'mail',
  });

  assert.equal(content.html, '<p>A document needs your signature.</p>');
  assert.equal(content.text, 'A document needs your signature.');
  assert.doesNotMatch(content.html, /OpenSign/);
});

test('non-portal mail retains upstream OpenSign behavior', () => {
  const content = buildMailContent({
    html: '<p>Sign this.</p>',
    portalMode: false,
    reportHtml: '<p>Report spam</p>',
    subject: 'Signature requested',
    text: '',
  });

  assert.equal(content.html, '<p>Sign this.</p><p>Report spam</p>');
  assert.equal(content.text, 'mail');
});
