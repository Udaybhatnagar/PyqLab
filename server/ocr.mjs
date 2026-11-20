import { createWorker } from 'tesseract.js';

export const paperLanguages = new Set(['auto', 'english', 'hindi']);

export function createPaperWorker(language = 'auto', hindiOnly = false) {
  const languages = hindiOnly ? ['hin'] : language === 'hindi' ? ['hin', 'eng'] :
    language === 'english' ? ['eng'] : ['eng', 'hin'];
  return createWorker(languages, 1, { errorHandler: () => {} });
}
