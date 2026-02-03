export const isProbablyHTML = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value);

export const escapeHTML = (text: string) => {
  // Browser-only utility (this module is used in the editor)
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

/**
 * Converts incoming value (plain text with \n\n OR HTML) into editor-friendly HTML.
 * This fixes the classic issue where \n\n is visually collapsed in contentEditable.
 */
export const incomingToEditorHTML = (value: string) => {
  if (!value) return '';
  const html = isProbablyHTML(value) ? value : escapeHTML(value);
  return html.replace(/\n/g, '<br>');
};

const collapseBreaks = (html: string) =>
  html
    // 3+ breaks => 2 breaks
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>')
    // Trim leading/trailing breaks
    .replace(/^(?:\s*<br\s*\/?>\s*)+/i, '')
    .replace(/(?:\s*<br\s*\/?>\s*)+\s*$/i, '')
    .trim();

/**
 * Normalizes editor HTML into a LinkedIn-friendly subset:
 * - <b>/<i> -> <strong>/<em>
 * - <div>/<p> blocks -> line breaks (<br>)
 * - keeps: strong, em, a, ul, ol, li, br
 */
export const normalizeEditorHTMLForStorage = (html: string) => {
  if (!html) return '';

  try {
    const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
    const root = doc.getElementById('root');
    if (!root) return collapseBreaks(html);

    const out = doc.createElement('div');

    const appendChildren = (from: Node, to: HTMLElement) => {
      from.childNodes.forEach((child) => appendNormalized(child, to));
    };

    const appendNormalized = (node: Node, target: HTMLElement) => {
      if (node.nodeType === Node.TEXT_NODE) {
        target.appendChild(doc.createTextNode(node.textContent ?? ''));
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      // Keep explicit breaks
      if (tag === 'br') {
        target.appendChild(doc.createElement('br'));
        return;
      }

      // Convert legacy tags
      if (tag === 'b' || tag === 'strong') {
        const strong = doc.createElement('strong');
        appendChildren(el, strong);
        target.appendChild(strong);
        return;
      }

      if (tag === 'i' || tag === 'em') {
        const em = doc.createElement('em');
        appendChildren(el, em);
        target.appendChild(em);
        return;
      }

      if (tag === 'a') {
        const a = doc.createElement('a');
        const href = el.getAttribute('href');
        if (href) a.setAttribute('href', href);
        appendChildren(el, a);
        target.appendChild(a);
        return;
      }

      // Lists are kept as-is
      if (tag === 'ul' || tag === 'ol' || tag === 'li') {
        const listEl = doc.createElement(tag);
        appendChildren(el, listEl);
        target.appendChild(listEl);
        return;
      }

      // Blocks => children + breaks
      if (tag === 'div' || tag === 'p') {
        appendChildren(el, target);
        target.appendChild(doc.createElement('br'));
        if (tag === 'p') target.appendChild(doc.createElement('br'));
        return;
      }

      // Unknown tags: keep their text/inline content only.
      appendChildren(el, target);
    };

    appendChildren(root, out);

    // Also convert raw \n produced by some browsers into <br>
    const normalized = out.innerHTML.replace(/\n/g, '<br>');
    return collapseBreaks(normalized);
  } catch {
    // Fallback: keep existing behavior but at least preserve \n
    return collapseBreaks(html.replace(/\n/g, '<br>'));
  }
};
