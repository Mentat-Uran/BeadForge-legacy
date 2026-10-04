const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'BeadForge.html'), 'utf8');
const remoteCssImportPattern = /@import\s+(?:url\(\s*)?['"]?(?:https?:)?\/\//i;

function hasRemoteCssImport(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return remoteCssImportPattern.test(withoutComments);
}

function parseAttributes(source) {
  const attributes = new Map();
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

  for (const match of source.matchAll(attributePattern)) {
    const [, name, doubleQuoted, singleQuoted, unquoted] = match;
    attributes.set(name.toLowerCase(), doubleQuoted ?? singleQuoted ?? unquoted ?? '');
  }

  return attributes;
}

function hasRemoteStylesheetLink(document) {
  return [...document.matchAll(/<link\b([^>]*)>/gi)].some(([, source]) => {
    const attributes = parseAttributes(source);
    const relTokens = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
    const href = (attributes.get('href') ?? '').trim();

    return relTokens.includes('stylesheet') && /^(?:https?:)?\/\//i.test(href);
  });
}

test('the editor does not load stylesheets from remote hosts', () => {
  const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1]);

  assert.equal(styleBlocks.some(hasRemoteCssImport), false);
  assert.equal(hasRemoteStylesheetLink(html), false);
});

test('detects protocol-relative remote CSS imports', () => {
  assert.equal(hasRemoteCssImport("@import url('//cdn.example/style.css');"), true);
});

test('detects remote CSS imports when comments separate the at-rule and URL', () => {
  assert.equal(
    hasRemoteCssImport('@import /* typography */ url("https://cdn.example/style.css");'),
    true,
  );
  assert.equal(hasRemoteCssImport('/* @import url("https://cdn.example/style.css"); */'), false);
});

test('detects remote stylesheet links with valid whitespace around attributes', () => {
  assert.equal(
    hasRemoteStylesheetLink('<link rel = "stylesheet" href = "https://cdn.example/style.css">'),
    true,
  );
  assert.equal(
    hasRemoteStylesheetLink('<link rel = "stylesheet" href = "//cdn.example/style.css">'),
    true,
  );
  assert.equal(hasRemoteStylesheetLink('<link rel="stylesheet" href="./styles.css">'), false);
});

test('detects stylesheet anywhere in the link rel token list', () => {
  assert.equal(
    hasRemoteStylesheetLink(
      '<link rel="alternate stylesheet" title="Night" href="https://cdn.example/style.css">',
    ),
    true,
  );
  assert.equal(
    hasRemoteStylesheetLink('<link rel="alternate" href="https://cdn.example/feed.xml">'),
    false,
  );
});
