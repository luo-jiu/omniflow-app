import { describe, expect, it } from 'vitest';
import { createAgentCompositionGuard, shouldSubmitAgentComposer } from './agent-composer-keyboard';

describe('Agent composer keyboard', () => {
  it('shares a read-only IME activity guard with the controlled input route', () => {
    const guard = createAgentCompositionGuard();
    expect(guard.isActive(0)).toBe(false);
    guard.start(); expect(guard.isActive(10)).toBe(true);
    guard.end(20); expect(guard.isActive(21)).toBe(true);
    expect(guard.isActive(80)).toBe(false);
    guard.keyDown('Enter', 21); expect(guard.isActive(100)).toBe(true);
    guard.keyUp('Enter'); expect(guard.isActive(101)).toBe(false);
    guard.start(); guard.reset(); expect(guard.isActive(102)).toBe(false);
  });
  const enter = { key: 'Enter', shiftKey: false, nativeEvent: {} };
  it('submits ordinary Enter but preserves newlines, IME confirmation and running drafts', () => {
    expect(shouldSubmitAgentComposer(enter, false)).toBe(true);
    expect(shouldSubmitAgentComposer({ ...enter, shiftKey: true }, false)).toBe(false);
    expect(shouldSubmitAgentComposer({ ...enter, nativeEvent: { isComposing: true } }, false)).toBe(false);
    expect(shouldSubmitAgentComposer({ ...enter, nativeEvent: { keyCode: 229 } }, false)).toBe(false);
    expect(shouldSubmitAgentComposer(enter, true)).toBe(false);
  });
  it('does not send Latin text committed through a Chinese IME before keydown', () => {
    const guard = createAgentCompositionGuard();
    guard.start();
    guard.end(100);
    expect(shouldSubmitAgentComposer(enter, false, guard.keyDown('Enter', 101))).toBe(false);
    expect(shouldSubmitAgentComposer(enter, false, guard.keyDown('Enter', 200))).toBe(false);
    guard.keyUp('Enter');
    expect(shouldSubmitAgentComposer(enter, false, guard.keyDown('Enter', 220))).toBe(true);
  });
  it('handles composition ending after Enter, mouse confirmation and focus loss', () => {
    const guard = createAgentCompositionGuard();
    guard.start();
    expect(guard.keyDown('Enter', 10)).toBe(true);
    guard.end(11);
    guard.keyUp('Enter');
    expect(guard.keyDown('Enter', 20)).toBe(false);
    guard.start(); guard.end(30);
    expect(guard.keyDown('Enter', 100)).toBe(false);
    guard.start(); guard.reset();
    expect(guard.keyDown('Enter', 110)).toBe(false);
  });
});
