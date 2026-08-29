import { describe, expect, it } from 'vitest'

import {
  createCatchToolkitState,
  createCatchToolkitStateSource,
  type CatchToolkitStorage,
} from './toolkit-state'

class MemoryStorage implements CatchToolkitStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const key = (name: string) => `OmniflowCatchToolkit:${name}`

describe('Cat Catch page-origin toolkit state', () => {
  it('deep.toolkit-origin-storage', () => {
    const originA = new MemoryStorage()
    const originB = new MemoryStorage()
    let selectorText = 'Episode 7'
    const selectorScope = {
      querySelector: (selector: string) => {
        if (selector === '!!invalid') throw new Error('invalid selector')
        return selector === '#title' ? { textContent: selectorText } : null
      },
    }
    const stateA = createCatchToolkitState({ selectorScope, storage: originA })
    const stateB = createCatchToolkitState({ selectorScope, storage: originB })

    expect(stateA.getState()).toEqual({
      autoDownloadOnComplete: false,
      autoSeekToBufferedEnd: false,
      clearCacheOnComplete: false,
      manualFileName: '',
      regexRule: '',
      regexWarning: '',
      restartAlwaysFromBeginning: false,
      saveEveryGigabyte: false,
      selectorRule: '',
      selectorWarning: '',
      trimExtraMediaHeaders: false,
    })
    stateA.update({
      autoDownloadOnComplete: true,
      autoSeekToBufferedEnd: true,
      clearCacheOnComplete: false,
      manualFileName: '  episode-7  ',
      regexRule: 'Episode (\\d+)',
      restartAlwaysFromBeginning: true,
      saveEveryGigabyte: true,
      selectorRule: '#title',
      trimExtraMediaHeaders: true,
    })

    expect(originA.values).toEqual(new Map([
      [key('autoDownloadOnComplete'), 'checked'],
      [key('autoSeekToBufferedEnd'), 'checked'],
      [key('clearCacheOnComplete'), ''],
      [key('manualFileName'), 'episode-7'],
      [key('regexRule'), 'Episode (\\d+)'],
      [key('restartAlwaysFromBeginning'), 'checked'],
      [key('saveEveryGigabyte'), 'checked'],
      [key('selectorRule'), '#title'],
      [key('trimExtraMediaHeaders'), 'checked'],
    ]))
    expect(stateB.getState().autoDownloadOnComplete).toBe(false)
    expect(stateB.getState().saveEveryGigabyte).toBe(false)
    expect(originB.values.size).toBe(0)

    selectorText = ''
    expect(stateA.getState().selectorWarning).toBe('表达式暂时没有命中可用内容')
    stateA.update({ manualFileName: '', regexRule: '[', selectorRule: '!!invalid' })
    expect(originA.values.has(key('manualFileName'))).toBe(false)
    expect(originA.values.has(key('regexRule'))).toBe(false)
    expect(originA.values.has(key('selectorRule'))).toBe(false)
    expect(stateA.getState()).toMatchObject({
      manualFileName: '',
      regexRule: '',
      regexWarning: '',
      selectorRule: '',
      selectorWarning: '',
    })
  })

  it('deep.toolkit-reload-reset', () => {
    const storage = new MemoryStorage()
    const firstDocument = createCatchToolkitState({ storage })
    firstDocument.update({
      autoDownloadOnComplete: true,
      manualFileName: '  persisted-name  ',
      regexRule: 'item-(\\d+)',
      trimExtraMediaHeaders: true,
    })

    const sourcedFactory = Function(`return ${createCatchToolkitStateSource()}`)() as typeof createCatchToolkitState
    const reloadedDocument = sourcedFactory({ storage })
    expect(reloadedDocument.getState()).toMatchObject({
      autoDownloadOnComplete: true,
      manualFileName: 'persisted-name',
      regexRule: 'item-(\\d+)',
      trimExtraMediaHeaders: true,
    })

    const freshOrigin = sourcedFactory({ storage: new MemoryStorage() })
    expect(freshOrigin.getState()).toMatchObject({
      autoDownloadOnComplete: false,
      manualFileName: '',
      regexRule: '',
      trimExtraMediaHeaders: false,
    })

    const failingStorage: CatchToolkitStorage = {
      getItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    const blockedDocument = sourcedFactory({ storage: failingStorage })
    expect(blockedDocument.getState()).toMatchObject({
      autoDownloadOnComplete: false,
      manualFileName: '',
      trimExtraMediaHeaders: true,
    })
    expect(() => blockedDocument.update({
      autoDownloadOnComplete: true,
      manualFileName: 'memory-only',
    })).not.toThrow()
    expect(blockedDocument.getState()).toMatchObject({
      autoDownloadOnComplete: true,
      manualFileName: 'memory-only',
    })
  })
})
