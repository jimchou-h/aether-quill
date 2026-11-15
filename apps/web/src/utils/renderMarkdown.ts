const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

function renderInlineMarkdown(escaped: string): string {
  let html = escaped;
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  return html;
}

function inline(raw: string): string {
  return renderInlineMarkdown(escapeHtml(raw));
}

function isRuleLine(trimmed: string): boolean {
  return /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed);
}

function isFenceLine(trimmed: string): boolean {
  return /^```/.test(trimmed);
}

function splitTableRow(trimmed: string): string[] {
  return trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableDelimiterRow(trimmed: string): boolean {
  if (!trimmed.includes('|')) {
    return false;
  }
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function renderTableRow(cells: string[], tag: 'th' | 'td'): string {
  return `<tr>${cells.map((cell) => `<${tag}>${inline(cell)}</${tag}>`).join('')}</tr>`;
}

export function renderMarkdownToSafeHtml(source: string): string {
  const normalized = source.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const parts: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      parts.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      parts.push('</ol>');
      inOl = false;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    const trimmed = line.trim();

    if (isFenceLine(trimmed)) {
      closeLists();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !isFenceLine(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      parts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    if (!trimmed) {
      closeLists();
      continue;
    }

    if (isRuleLine(trimmed)) {
      closeLists();
      parts.push('<hr>');
      continue;
    }

    if (
      trimmed.includes('|') &&
      index + 1 < lines.length &&
      isTableDelimiterRow(lines[index + 1].trim())
    ) {
      closeLists();
      const headerCells = splitTableRow(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(splitTableRow(lines[index].trim()));
        index += 1;
      }
      index -= 1;
      parts.push(
        `<table><thead>${renderTableRow(headerCells, 'th')}</thead><tbody>${rows
          .map((row) => renderTableRow(row, 'td'))
          .join('')}</tbody></table>`
      );
      continue;
    }

    if (trimmed.startsWith('>')) {
      closeLists();
      const quoted: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoted.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      index -= 1;
      parts.push(`<blockquote>${renderMarkdownToSafeHtml(quoted.join('\n'))}</blockquote>`);
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      parts.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const ul = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ul) {
      if (inOl) {
        parts.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        parts.push('<ul>');
        inUl = true;
      }
      parts.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    const ol = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      if (inUl) {
        parts.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        parts.push('<ol>');
        inOl = true;
      }
      parts.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    closeLists();
    parts.push(`<p>${inline(trimmed)}</p>`);
  }

  closeLists();
  return parts.join('');
}
