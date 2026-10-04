const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'BeadForge.html'), 'utf8');
const remoteCssImport = /@import\s+(?:url\(\s*)?['"]?(?:https?:)?\/\//i;
const remoteStylesheetLink = /<link\b(?=[^>]*\brel\s*=\s*['"]?\s*stylesheet\b)(?=[^>]*\bhref\s*=\s*['"]?\s*(?:https?:)?\/\/)[^>]*>/i;

test('the editor does not load stylesheets from remote hosts', () => {
  const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1]);

  assert.equal(styleBlocks.some((style) => remoteCssImport.test(style)), false);
  assert.equal(remoteStylesheetLink.test(html), false);
});

test('detects protocol-relative remote CSS imports', () => {
  assert.equal(remoteCssImport.test("@import url('//cdn.example/style.css');"), true);
});

test('detects remote stylesheet links with valid whitespace around attributes', () => {
  assert.equal(
    remoteStylesheetLink.test('<link rel = "stylesheet" href = "https://cdn.example/style.css">'),
    true,
  );
  assert.equal(
    remoteStylesheetLink.test('<link rel = "stylesheet" href = "//cdn.example/style.css">'),
    true,
  );
  assert.equal(remoteStylesheetLink.test('<link rel="stylesheet" href="./styles.css">'), false);
});
