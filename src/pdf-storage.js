let database;

function openStorage() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('pyq-lab-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pdfs');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
  }).catch((error) => { database = undefined; throw error; });
  return database;
}

async function useStorage(mode, operation) {
  const db = await openStorage();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('pdfs', mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    const request = operation(transaction.objectStore('pdfs'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(request.error ?? transaction.error);
  });
}

export const getLocalPdf = (id) => useStorage('readonly', (store) => store.get(id));
export const removeLocalPdf = (id) => useStorage('readwrite', (store) => store.delete(id));

export async function saveLocalPdf(id, blob) {
  try {
    await useStorage('readwrite', (store) => store.put(blob, id));
  } catch (error) {
    throw new Error(error?.name === 'QuotaExceededError'
      ? 'Browser storage is full. Free some space before importing this PDF.'
      : 'This browser could not save the PDF. Check that site storage is enabled.');
  }
}

export async function pdfDigest(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
