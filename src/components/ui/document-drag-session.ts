type DocumentDragSession = {
  cursor: string;
  token: symbol;
};

type DocumentDragStyleSnapshot = {
  cursor: string;
  userSelect: string;
};

const activeSessions: DocumentDragSession[] = [];
let originalStyles: DocumentDragStyleSnapshot | null = null;

function applyActiveSession(): void {
  if (typeof document === 'undefined') return;
  const activeSession = activeSessions[activeSessions.length - 1];
  if (activeSession) {
    document.body.style.cursor = activeSession.cursor;
    document.body.style.userSelect = 'none';
    return;
  }
  if (!originalStyles) return;
  document.body.style.cursor = originalStyles.cursor;
  document.body.style.userSelect = originalStyles.userSelect;
  originalStyles = null;
}

export function beginDocumentDragSession(cursor: string): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (activeSessions.length === 0) {
    originalStyles = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
  }
  const session = { cursor, token: Symbol('document-drag-session') };
  activeSessions.push(session);
  applyActiveSession();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const sessionIndex = activeSessions.findIndex(candidate => candidate.token === session.token);
    if (sessionIndex >= 0) activeSessions.splice(sessionIndex, 1);
    applyActiveSession();
  };
}
