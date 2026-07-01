interface HtmlTag {
  start: number;
  end: number;
  name: string;
  closing: boolean;
  attributes: Map<string, string>;
}

const RAW_TEXT_ELEMENTS = new Set(["iframe", "noembed", "noframes", "script", "style", "textarea", "title", "xmp"]);

function tagEnd(html: string, start: number): number {
  let quote = "";
  for (let index = start; index < html.length; index++) {
    const character = html[index]!;
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return html.length;
}

function attributes(source: string): Map<string, string> {
  const result = new Map<string, string>();
  let index = 0;
  while (index < source.length) {
    while (/\s|\//.test(source[index] ?? "")) index++;
    const start = index;
    while (index < source.length && !/[\s=/>]/.test(source[index]!)) index++;
    if (start === index) break;
    const name = source.slice(start, index).toLowerCase();
    while (/\s/.test(source[index] ?? "")) index++;
    if (source[index] !== "=") {
      result.set(name, "");
      continue;
    }
    index++;
    while (/\s/.test(source[index] ?? "")) index++;
    const quote = source[index] === '"' || source[index] === "'" ? source[index++]! : "";
    const valueStart = index;
    if (quote) {
      while (index < source.length && source[index] !== quote) index++;
      result.set(name, source.slice(valueStart, index));
      if (source[index] === quote) index++;
    } else {
      while (index < source.length && !/[\s>]/.test(source[index]!)) index++;
      result.set(name, source.slice(valueStart, index));
    }
  }
  return result;
}

function* tags(html: string): Generator<HtmlTag> {
  const lower = html.toLowerCase();
  let index = 0;
  let rawTextElement: string | undefined;

  while (index < html.length) {
    if (rawTextElement) {
      index = lower.indexOf(`</${rawTextElement}`, index);
      if (index < 0) return;
    } else {
      index = html.indexOf("<", index);
      if (index < 0) return;
      if (html.startsWith("<!--", index)) {
        const commentEnd = html.indexOf("-->", index + 4);
        index = commentEnd < 0 ? html.length : commentEnd + 3;
        continue;
      }
      if (html[index + 1] === "!" || html[index + 1] === "?") {
        index = tagEnd(html, index + 2);
        continue;
      }
    }

    const start = index;
    index++;
    const closing = html[index] === "/";
    if (closing) index++;
    const nameStart = index;
    while (index < html.length && /[A-Za-z0-9:-]/.test(html[index]!)) index++;
    if (nameStart === index) {
      index = start + 1;
      continue;
    }
    const name = html.slice(nameStart, index).toLowerCase();
    if (rawTextElement && (!closing || name !== rawTextElement)) {
      index = start + 2;
      continue;
    }
    const end = tagEnd(html, index);
    const tag: HtmlTag = {
      start,
      end,
      name,
      closing,
      attributes: closing ? new Map() : attributes(html.slice(index, Math.max(index, end - 1))),
    };
    yield tag;
    index = end;
    if (closing && name === rawTextElement) rawTextElement = undefined;
    else if (!closing && RAW_TEXT_ELEMENTS.has(name) && !html.slice(start, end).match(/\/\s*>$/)) rawTextElement = name;
  }
}

export function findClosingTag(document: string, name: string): number {
  const normalized = name.toLowerCase();
  for (const tag of tags(document)) if (tag.closing && tag.name === normalized) return tag.start;
  return -1;
}

export function insertBeforeClosingTag(document: string, name: string, content: string): string | undefined {
  const index = findClosingTag(document, name);
  if (index < 0) return undefined;
  return `${document.slice(0, index)}${content}${document.slice(index)}`;
}

export function hasElementAttribute(document: string, tagName: string | undefined, attribute: string, value: string): boolean {
  const normalizedTag = tagName?.toLowerCase();
  const normalizedAttribute = attribute.toLowerCase();
  for (const tag of tags(document)) {
    if (!tag.closing && (!normalizedTag || tag.name === normalizedTag) && tag.attributes.get(normalizedAttribute) === value) return true;
  }
  return false;
}
