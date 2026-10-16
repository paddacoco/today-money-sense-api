export function decodeXml(value='') {
  return String(value)
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&').replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'").trim();
}

export function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decodeXml(m[1].replace(/<!\[CDATA\[|\]\]>/g,'')) : '';
}

export function blocks(xml, name) {
  const re = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'gi');
  return [...String(xml).matchAll(re)].map(m=>m[1]);
}
