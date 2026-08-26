type AppInputModality = 'keyboard' | 'pointer';

const installedDocuments = new WeakSet<Document>();

function setInputModality(documentRef: Document, modality: AppInputModality) {
  documentRef.documentElement.dataset.appInputModality = modality;
}

export function installAppInputModalityTracking(documentRef: Document = document) {
  if (installedDocuments.has(documentRef)) return;
  installedDocuments.add(documentRef);

  if (!documentRef.documentElement.dataset.appInputModality) {
    setInputModality(documentRef, 'pointer');
  }

  documentRef.addEventListener('pointerdown', () => {
    setInputModality(documentRef, 'pointer');
  }, true);

  documentRef.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    setInputModality(documentRef, 'keyboard');
  }, true);
}
