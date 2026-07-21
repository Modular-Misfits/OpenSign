const HTML_ENTITY_MAP = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITY_MAP[name.toLowerCase()] ?? match);
}

function textOnly(value) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function plainTextFromHtml(html) {
  return decodeHtmlEntities(String(html || ''))
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(
      /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, _quote, href, label) => `${textOnly(label)}\n${decodeHtmlEntities(href)}`
    )
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/(?:div|h[1-6]|li|p|table|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildMailContent({ html, portalMode, reportHtml, subject, text }) {
  const sourceHtml = String(html || '');
  if (!portalMode) {
    return {
      html: sourceHtml ? `${sourceHtml}${reportHtml || ''}` : '',
      text: text || 'mail',
    };
  }

  const suppliedText = String(text || '').trim();
  const meaningfulText = suppliedText && suppliedText.toLowerCase() !== 'mail' ? suppliedText : '';
  return {
    html: sourceHtml,
    text: meaningfulText || plainTextFromHtml(sourceHtml) || String(subject || '').trim(),
  };
}
