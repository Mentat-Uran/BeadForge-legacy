const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'BeadForge.html'), 'utf8');

test('the editor does not load stylesheets from remote hosts', () => {
  const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1]);
  const remoteCssImport = /@import\s+(?:url\(\s*)?['"]?https?:\/\//i;
  const remoteStylesheetLink = /<link\b(?=[^>]*\brel=['"]?stylesheet\b)(?=[^>]*\bhref=['"]?https?:\/\/)[^>]*>/i;

  assert.equal(styleBlocks.some((style) => remoteCssImport.test(style)), false);
  assert.equal(remoteStylesheetLink.test(html), false);
});
