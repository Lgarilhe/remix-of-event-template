export const isProbablyHTML = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value);

export const escapeHTML = (text: string) => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

/**
 * Converts incoming value (plain text with \n OR HTML) into editor-friendly HTML.
 * This fixes the classic issue where \n is visually collapsed in contentEditable.
 */
export const incomingToEditorHTML = (value: string) => {
  if (!value) return '';
  // If already HTML, just ensure \n becomes <br> for display
  if (isProbablyHTML(value)) {
    return value.replace(/\n/g, '<br>');
  }
  // Plain text: escape and convert line breaks
  return escapeHTML(value).replace(/\n/g, '<br>');
};

/**
 * Collapse excessive breaks and trim
 */
const collapseBreaks = (html: string) =>
  html
    // 3+ breaks => 2 breaks
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>')
    // Trim leading/trailing breaks
    .replace(/^(?:\s*<br\s*\/?>\s*)+/i, '')
    .replace(/(?:\s*<br\s*\/?>\s*)+\s*$/i, '')
    .trim();

/**
 * Normalizes editor HTML into a LinkedIn Recruiter-friendly format.
 * 
 * SUPPORTED TAGS (per LinkedIn Recruiter docs):
 * - <strong> for bold
 * - <em> for italic  
 * - <a href="..."> for links
 * - <ul>, <ol>, <li> for lists
 * 
 * NOT SUPPORTED: <br>, <p>, <div>, <b>, <i>
 * 
 * Line breaks must be plain \n characters, NOT <br> tags.
 */
export const normalizeEditorHTMLForStorage = (html: string) => {
  if (!html) return '';

  try {
    const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
    const root = doc.getElementById('root');
    if (!root) return fallbackNormalize(html);

    const fragments: string[] = [];

    const processNode = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? '';
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      // Line breaks → \n
      if (tag === 'br') {
        return '\n';
      }

      // Bold: <b> or <strong> → <strong>
      if (tag === 'b' || tag === 'strong') {
        const inner = Array.from(el.childNodes).map(processNode).join('');
        return inner ? `<strong>${inner}</strong>` : '';
      }

      // Italic: <i> or <em> → <em>
      if (tag === 'i' || tag === 'em') {
        const inner = Array.from(el.childNodes).map(processNode).join('');
        return inner ? `<em>${inner}</em>` : '';
      }

      // Links
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        const inner = Array.from(el.childNodes).map(processNode).join('');
        return inner ? `<a href="${href}">${inner}</a>` : '';
      }

      // Lists
      if (tag === 'ul') {
        const inner = Array.from(el.childNodes).map(processNode).join('');
        return `<ul>${inner}</ul>`;
      }
      if (tag === 'ol') {
        const inner = Array.from(el.childNodes).map(processNode).join('');
        return `<ol>${inner}</ol>`;
      }
      if (tag === 'li') {
        const inner = Array.from(el.childNodes).map(processNode).join('');
        return `<li>${inner}</li>`;
      }

      // Block elements → children + line breaks
      if (tag === 'div' || tag === 'p') {
        const inner = Array.from(el.childNodes).map(processNode).join('');
        // <p> typically means double line break, <div> single
        return inner + (tag === 'p' ? '\n\n' : '\n');
      }

      // Unknown tags: just process children
      return Array.from(el.childNodes).map(processNode).join('');
    };

    const result = Array.from(root.childNodes).map(processNode).join('');
    
    // Collapse excessive newlines (3+ → 2)
    return result
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
      .trim();
  } catch {
    return fallbackNormalize(html);
  }
};

/**
 * Fallback normalization when DOM parsing fails
 */
const fallbackNormalize = (html: string) => {
  return html
    // Convert <br> to \n
    .replace(/<br\s*\/?>/gi, '\n')
    // Convert legacy bold/italic
    .replace(/<b(\s|>)/gi, '<strong$1')
    .replace(/<\/b>/gi, '</strong>')
    .replace(/<i(\s|>)/gi, '<em$1')
    .replace(/<\/i>/gi, '</em>')
    // Remove unsupported block tags but keep content
    .replace(/<\/?(?:div|p|span)[^>]*>/gi, '\n')
    // Collapse newlines
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
    .trim();
};

/**
 * For display purposes: convert stored format (\n) back to <br> for the editor
 */
export const storedToEditorHTML = (stored: string) => {
  if (!stored) return '';
  return stored.replace(/\n/g, '<br>');
};
