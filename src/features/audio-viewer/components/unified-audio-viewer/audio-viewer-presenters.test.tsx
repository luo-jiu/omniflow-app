import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AudioPlayerBrief } from './audio-viewer-presenters';

vi.mock('@douyinfe/semi-icons', () => ({
  IconChevronDown: () => null,
  IconChevronUp: () => null,
  IconMusic: () => null,
}));

describe('audio player brief interaction', () => {
  it('lets only the archive cover toggle the expanded player', () => {
    const onToggleExpanded = vi.fn();
    const renderBrief = (expanded: boolean) => (
      <AudioPlayerBrief
        archiveMode
        bareAudioMode={false}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        title="歌曲名称"
        subtitleFileName="歌曲歌词"
      />
    );
    const renderer = TestRenderer.create(renderBrief(false));
    try {
      const brief = renderer.root.findByProps({ className: 'player-brief' });
      const track = renderer.root.findByProps({ className: 'player-track' });
      const coverButton = renderer.root.findByType('button');
      expect(brief.type).toBe('div');
      expect(brief.props.onClick).toBeUndefined();
      expect(track.parent).toBe(brief);
      expect(coverButton.props.className).toBe('player-cover-trigger');
      expect(coverButton.props['aria-label']).toBe('展开播放器');
      expect(coverButton.props['aria-expanded']).toBe(false);
      act(() => coverButton.props.onClick());
      expect(onToggleExpanded).toHaveBeenCalledOnce();

      act(() => renderer.update(renderBrief(true)));
      expect(coverButton.props['aria-label']).toBe('收起播放器');
      expect(coverButton.props['aria-expanded']).toBe(true);
    } finally {
      renderer.unmount();
    }
  });

  it('preserves the full brief toggle for an ordinary audio folder', () => {
    const onToggleExpanded = vi.fn();
    const renderer = TestRenderer.create(
      <AudioPlayerBrief archiveMode={false} bareAudioMode={false} expanded onToggleExpanded={onToggleExpanded} />,
    );
    try {
      const button = renderer.root.findByType('button');
      expect(button.props.className).toBe('player-brief');
      expect(button.props.disabled).toBe(false);
      expect(renderer.root.findByProps({ className: 'player-track' }).parent).toBe(button);
      act(() => button.props.onClick());
      expect(onToggleExpanded).toHaveBeenCalledOnce();
    } finally {
      renderer.unmount();
    }
  });

  it('keeps bare audio expanded without adding a cover action', () => {
    const renderer = TestRenderer.create(
      <AudioPlayerBrief archiveMode={false} bareAudioMode expanded onToggleExpanded={vi.fn()} title="audio.mp3" />,
    );
    try {
      const button = renderer.root.findByType('button');
      expect(button.props.disabled).toBe(true);
      expect(button.props.onClick).toBeUndefined();
      expect(button.props['aria-label']).toBe('audio.mp3');
      expect(renderer.root.findAllByProps({ className: 'player-cover-toggle' })).toHaveLength(0);
    } finally {
      renderer.unmount();
    }
  });
});
