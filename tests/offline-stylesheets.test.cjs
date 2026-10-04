const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'BeadForge.html'), 'utf8');
const cssImportPattern = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|"([^"]*)"|'([^']*)')/gi;

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
  return [...normalized.matchAll(cssImportPattern)].some((match) => {
    const reference = match.slice(1).find((value) => value !== undefined)?.trim();
    if (!reference) return false;

    try {
      const base = reference.startsWith('//')
        ? 'https://offline-audit.invalid/'
        : 'file:///offline-audit/BeadForge.html';
      const parsed = new URL(reference, base);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  });
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

function hasStylesheetLink(document) {
  return findLinkAttributeSources(document).some((source) => {
    const attributes = parseAttributes(source);
    const relTokens = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
    return relTokens.includes('stylesheet');
  });
}

function hasRemoteCssImportInStyleBlocks(document) {
  const styleBlocks = [...document.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map((match) => match[1]);

  return styleBlocks.some(hasRemoteCssImport);
}

function hasOfflineStylesheetViolation(document) {
  return hasStylesheetLink(document) || hasRemoteCssImportInStyleBlocks(document);
}

test('the single-file editor has no stylesheet links or remote CSS imports', () => {
  assert.equal(hasOfflineStylesheetViolation(html), false);
});

test('detects protocol-relative remote CSS imports', () => {
  assert.equal(hasRemoteCssImport("@import url('//cdn.example/style.css');"), true);
});

test('detects slashless HTTP CSS imports resolved against a local file', () => {
  assert.equal(hasRemoteCssImport('@import "https:cdn.example/style.css";'), true);
  assert.equal(hasRemoteCssImport(' @import url(https:/cdn.example/style.css);'), true);
  assert.equal(hasRemoteCssImport('@import "./theme.css";'), false);
  assert.equal(hasRemoteCssImport('@import "/theme.css";'), false);
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

test('rejects stylesheet links regardless of the href or its encoding', () => {
  assert.equal(
    hasStylesheetLink('<link rel = "stylesheet" href = "https://cdn.example/style.css">'),
    true,
  );
  assert.equal(
    hasStylesheetLink('<link rel = "stylesheet" href = "//cdn.example/style.css">'),
    true,
  );
  assert.equal(hasStylesheetLink('<link rel="stylesheet" href="./styles.css">'), true);
  assert.equal(
    hasStylesheetLink('<link rel="stylesheet" href="https&#58;//cdn.example/style.css">'),
    true,
  );
  assert.equal(hasStylesheetLink('<link rel="icon" href="https://cdn.example/icon.png">'), false);
});

test('finds stylesheet links when quoted attributes contain a greater-than sign', () => {
  assert.equal(
    hasStylesheetLink(
      '<link rel="stylesheet" title="A > B" href="https://cdn.example/style.css">',
    ),
    true,
  );
});

test('finds remote CSS imports before valid spaced style end tags', () => {
  assert.equal(
    hasRemoteCssImportInStyleBlocks('<style>@import "https://cdn.example/style.css";</style >'),
    true,
  );
});

test('detects stylesheet anywhere in the link rel token list', () => {
  assert.equal(
    hasStylesheetLink(
      '<link rel="alternate stylesheet" title="Night" href="https://cdn.example/style.css">',
    ),
    true,
  );
  assert.equal(
    hasStylesheetLink('<link rel="alternate" href="https://cdn.example/feed.xml">'),
    false,
  );
});
