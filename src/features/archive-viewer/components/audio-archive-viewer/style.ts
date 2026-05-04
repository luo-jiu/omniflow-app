import styled from 'styled-components';
import { VideoArchiveViewerWrapper } from '../video-archive-viewer/style';

export const AudioArchiveViewerWrapper = styled(VideoArchiveViewerWrapper)`
  .badge {
    color: #6f3d05;
    background: color-mix(in srgb, var(--semi-color-warning-light-default) 78%, white);
    border-color: color-mix(in srgb, var(--semi-color-warning) 34%, transparent);
  }

  .archive-card:hover {
    border-color: color-mix(in srgb, var(--semi-color-warning) 42%, rgba(255, 255, 255, 0.22));
  }

  .card-cover {
    aspect-ratio: 4 / 3;
    background:
      radial-gradient(circle at 28% 25%, rgba(255, 255, 255, 0.28), transparent 24%),
      linear-gradient(135deg, rgba(103, 58, 12, 0.92), rgba(214, 125, 24, 0.86)),
      linear-gradient(180deg, rgba(255, 255, 255, 0.14), transparent 48%);
  }

  .card-cover-fallback::before,
  .card-cover-fallback::after {
    display: none;
  }

  .card-cover-icon {
    min-width: 66px;
    color: rgba(255, 255, 255, 0.92);
  }

  .card-tag-pill {
    color: #6f3d05;
    border-color: color-mix(in srgb, var(--semi-color-warning) 24%, rgba(11, 18, 32, 0.1));
    background: color-mix(in srgb, var(--semi-color-warning-light-default) 76%, white);
  }
`;
