const hindiChoices = [...'कखगघङचछज'];

export const hindiText = /\p{Script=Devanagari}/u;
export const contentLanguage = (text) => hindiText.test(text) ? 'hi' : undefined;

export function normalizeDigits(text) {
  return text.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));
}

export function choiceOrder(label) {
  const latin = String(label).toUpperCase();
  return /^[A-H]$/.test(latin) ? latin.charCodeAt(0) - 65 : hindiChoices.indexOf(label);
}

export function validChoiceLabel(label) {
  return typeof label === 'string' && (hindiChoices.includes(label) || /^[A-H]$/.test(label));
}

export function nextChoiceLabel(labels) {
  const alphabet = labels.some((label) => hindiChoices.includes(label)) ? hindiChoices : 'ABCDEFGH';
  return [...alphabet].find((label) => !labels.includes(label));
}
