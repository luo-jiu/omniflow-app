import { describe, expect, it } from 'vitest';

import {
  buildAIServiceSaveInput,
  createAIServiceEditorDraft,
} from './ai-service.editor';
import type { AIServiceProfile } from './ai-service.types';

const PROFILE: AIServiceProfile = {
  baseUrl: 'https://api.example.com/v1',
  createdAt: '2026-08-20T00:00:00.000Z',
  hasApiKey: true,
  id: 'profile-1',
  name: 'Example',
  providerType: 'openai',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

describe('AI service editor', () => {
  it('does not overwrite a stored key when the key field is untouched or only revealed', () => {
    const untouched = createAIServiceEditorDraft(PROFILE);
    expect(buildAIServiceSaveInput(untouched)).not.toHaveProperty('apiKey');
    expect(buildAIServiceSaveInput({
      ...untouched,
      apiKey: 'existing-secret',
      apiKeyLoaded: true,
    })).not.toHaveProperty('apiKey');
  });

  it('overwrites or removes a stored key only after the field changes', () => {
    const draft = createAIServiceEditorDraft(PROFILE);
    expect(buildAIServiceSaveInput({
      ...draft,
      apiKey: 'new-secret',
      apiKeyDirty: true,
      apiKeyLoaded: true,
    })).toMatchObject({ apiKey: 'new-secret' });
    expect(buildAIServiceSaveInput({
      ...draft,
      apiKeyDirty: true,
      apiKeyLoaded: true,
    })).toMatchObject({ removeApiKey: true });
  });
});
