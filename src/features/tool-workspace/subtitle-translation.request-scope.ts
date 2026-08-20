export interface SubtitleTranslationRequestToken {
  datasetVersion: number;
  requestId: number;
}

export function createSubtitleTranslationRequestScope() {
  let datasetVersion = 0;
  let requestId = 0;

  return {
    begin(): SubtitleTranslationRequestToken {
      requestId += 1;
      return { datasetVersion, requestId };
    },
    invalidateRequests() {
      requestId += 1;
    },
    isCurrent(token: SubtitleTranslationRequestToken) {
      return token.datasetVersion === datasetVersion && token.requestId === requestId;
    },
    replaceDataset() {
      datasetVersion += 1;
      requestId += 1;
    },
  };
}
