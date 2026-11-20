// Some PDF fonts expose vowel marks in visual order and split a heading at a glyph boundary.
export function cleanHindiText(text, fromOcr = false) {
  const corrected = text.normalize('NFC')
    .replace(/(प्रश्[\u200c\u200d]?न(?:\s+(?:संख्या|क्रमांक|सं\.?))?)[ \t]*\r?\n[ \t]*(?=[0-9०-९])/gu, '$1 ')
    .replace(/(^|[\s([{])ि([क-हक़-य़](?:्[\u200c\u200d]?[क-हक़-य़])*)/gu, '$1$2ि')
    .replace(/[\t ]+(?=(?!ि)(?=\p{Script=Devanagari})\p{M})/gu, '')
    .replace(/कुं[ \t]+जी/gu, 'कुंजी')
    .replace(/([\p{Script=Devanagari}])[ \t]+([?।])/gu, '$1$2')
    .replace(/[\u200c\u200d](?=\p{Script=Devanagari})/gu, '');
  if (!fromOcr) return corrected;

  // Limit corrections to a question-number slot or a letter-key entry.
  const digits = { 'श': '१', 'श्': '१', 'र': '२' };
  let inKey = false;
  return corrected.split('\n').map((line) => {
    if (/^\s*(?:उत्तर\s*कुंजी|उत्तरमाला|उत्तर\s*तालिका)\s*[:।]?\s*$/.test(line)) inKey = true;
    return line.replace(/(प्रश्न(?:\s+(?:संख्या|क्रमांक|सं\.?))?\s+)(श्?|र)(?=\s*[.):।–-])/g,
      (_, prefix, mark) => prefix + digits[mark])
      .replace(/^(\s*)(श्?|र)(?=\s*[.):।–-]\s*\(?[कखगघङचछज])/g, (match, spacing, mark) =>
        inKey ? spacing + digits[mark] : match);
  }).join('\n');
}
