const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'BeadForge.html'), 'utf8');
const remoteCssImportPattern = /@import\s+(?:url\(\s*)?['"]?(?:https?:)?\/\//i;

function stripCssComments(css) {
  let result = '';
  let quote = null;
  let escaped = false;

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];

    if (quote) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      result += character;
      continue;
    }

    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      if (end === -1) {
        return `${result} `;
      }
      result += ' ';
      index = end + 1;
      continue;
    }

    result += character;
  }

  return result;
}

function decodeCssEscapes(css) {
  return css
    .replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?/gi, (_escape, digits) => {
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return '\ufffd';
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(/\\([^\r\n\f])/g, '$1')
    .replace(/\\(?:\r\n|[\n\r\f])/g, '');
}

function hasRemoteCssImport(css) {
  const normalized = decodeCssEscapes(stripCssComments(css));
  return remoteCssImportPattern.test(normalized);
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

function findLinkAttributeSources(document) {
  const sources = [];
  const linkStartPattern = /<link\b/gi;
  let match;

  while ((match = linkStartPattern.exec(document)) !== null) {
    const attributeStart = linkStartPattern.lastIndex;
    let quote = null;
    let tagEnd = attributeStart;

    for (; tagEnd < document.length; tagEnd += 1) {
      const character = document[tagEnd];

      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
    }

    if (tagEnd === document.length) break;
    sources.push(document.slice(attributeStart, tagEnd));
    linkStartPattern.lastIndex = tagEnd + 1;
  }

  return sources;
}

function isRemoteStylesheetUrl(reference) {
  const normalizedReference = reference.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(normalizedReference);
  const isProtocolRelative = normalizedReference.startsWith('//');
  if (!hasScheme && !isProtocolRelative) return false;

  try {
    const parsed = new URL(normalizedReference, 'https://offline-audit.invalid/');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasRemoteStylesheetLink(document) {
  return findLinkAttributeSources(document).some((source) => {
    const attributes = parseAttributes(source);
    const relTokens = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
    const href = (attributes.get('href') ?? '').trim();

    return relTokens.includes('stylesheet') && isRemoteStylesheetUrl(href);
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

test('detects remote CSS imports whose URL scheme uses CSS escapes', () => {
  assert.equal(
    hasRemoteCssImport(String.raw`@import "h\74tps://cdn.example/style.css";`),
    true,
  );
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

test('detects remote stylesheet links when quoted attributes contain a greater-than sign', () => {
  assert.equal(
    hasRemoteStylesheetLink(
      '<link rel="stylesheet" title="A > B" href="https://cdn.example/style.css">',
    ),
    true,
  );
});

test('detects HTTP stylesheet links with special-scheme URL forms', () => {
  assert.equal(
    hasRemoteStylesheetLink('<link rel="stylesheet" href="https:cdn.example/style.css">'),
    true,
  );
  assert.equal(
    hasRemoteStylesheetLink('<link rel="stylesheet" href="https:/cdn.example/style.css">'),
    true,
  );
  assert.equal(hasRemoteStylesheetLink('<link rel="stylesheet" href="/styles.css">'), false);
  assert.equal(
    hasRemoteStylesheetLink('<link rel="stylesheet" href="data:text/css,body%7B%7D">'),
    false,
  );
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
