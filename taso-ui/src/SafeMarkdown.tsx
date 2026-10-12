import { Fragment, type ReactNode } from 'react';

const INLINE_TOKEN = /(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|https?:\/\/[^\s<>]+)/g;
const FENCE = /^```([A-Za-z0-9_-]{0,32})\s*$/;
const HEADING = /^(#{1,3})\s+(.+)$/;
const UNORDERED = /^\s*[-+*]\s+(.+)$/;
const ORDERED = /^\s*\d+[.)]\s+(.+)$/;
const QUOTE = /^\s*>\s?(.*)$/;

export function safeExternalHref(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

function trimAutoLink(raw: string) {
  let value = raw;
  let suffix = '';
  while (/[.,;:!?]$/.test(value)) {
    suffix = value.slice(-1) + suffix;
    value = value.slice(0, -1);
  }
  while (value.endsWith(')') && (value.match(/\(/g)?.length ?? 0) < (value.match(/\)/g)?.length ?? 0)) {
    suffix = ')' + suffix;
    value = value.slice(0, -1);
  }
  return { value, suffix };
}

function externalLink(href: string, label: ReactNode, key: string) {
  return <a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
}

function renderInline(text: string, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE_TOKEN.lastIndex = 0;

  while ((match = INLINE_TOKEN.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${prefix}-${match.index}`;

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]\n]+)\]\(([^\s)]+)\)$/.exec(token);
      if (!link) {
        nodes.push(token);
      } else {
        const href = safeExternalHref(link[2]);
        nodes.push(href ? externalLink(href, link[1], key) : <span key={key} className="markdown-unsafe-link">{token}</span>);
      }
    } else if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (/^https?:\/\//.test(token)) {
      const { value, suffix } = trimAutoLink(token);
      const href = safeExternalHref(value);
      nodes.push(href ? externalLink(href, value, key) : value);
      if (suffix) nodes.push(suffix);
    } else {
      nodes.push(token);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function inlineLines(lines: string[], prefix: string) {
  return lines.map((line, index) => (
    <Fragment key={`${prefix}-${index}`}>
      {index > 0 ? <br /> : null}
      {renderInline(line, `${prefix}-${index}`)}
    </Fragment>
  ));
}

export default function SafeMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line.trim());
    if (fence) {
      const language = fence[1] || undefined;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${blocks.length}`} data-language={language}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const content = renderInline(heading[2], `heading-${index}`);
      if (heading[1].length === 1) blocks.push(<h3 key={`heading-${index}`}>{content}</h3>);
      else if (heading[1].length === 2) blocks.push(<h4 key={`heading-${index}`}>{content}</h4>);
      else blocks.push(<h5 key={`heading-${index}`}>{content}</h5>);
      index += 1;
      continue;
    }

    if (UNORDERED.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = UNORDERED.exec(lines[index]);
        if (!item) break;
        items.push(<li key={`ul-${index}`}>{renderInline(item[1], `ul-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`ul-block-${blocks.length}`}>{items}</ul>);
      continue;
    }

    if (ORDERED.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = ORDERED.exec(lines[index]);
        if (!item) break;
        items.push(<li key={`ol-${index}`}>{renderInline(item[1], `ol-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ol-block-${blocks.length}`}>{items}</ol>);
      continue;
    }

    if (QUOTE.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const quote = QUOTE.exec(lines[index]);
        if (!quote) break;
        quoteLines.push(quote[1]);
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{inlineLines(quoteLines, `quote-${index}`)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      const candidate = lines[index];
      if (FENCE.test(candidate.trim()) || HEADING.test(candidate) || UNORDERED.test(candidate) || ORDERED.test(candidate) || QUOTE.test(candidate)) break;
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${blocks.length}`}>{inlineLines(paragraph, `paragraph-${index}`)}</p>);
  }

  return <div className="chat-markdown" data-markdown-policy="react-nodes-only">{blocks}</div>;
}
