import React from 'react';
import { Button, Tooltip } from '@douyinfe/semi-ui';
import { IconClose, IconCrop, IconTick } from '@douyinfe/semi-icons';
import {
  MIN_CROP_SELECTION_SIZE,
  type CropBounds,
  type CropSelection,
} from '../../services/image-crop.service';

interface ImageCropOverlayProps {
  applying?: boolean;
  bounds: CropBounds | null;
  selection: CropSelection | null;
  onApply: () => void;
  onCancel: () => void;
  onSelectionChange: (selection: CropSelection) => void;
}

type CropDragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const MIN_CROP_SIZE = MIN_CROP_SELECTION_SIZE;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function constrainSelection(selection: CropSelection, bounds: CropBounds): CropSelection {
  const maxWidth = Math.max(MIN_CROP_SIZE, bounds.width);
  const maxHeight = Math.max(MIN_CROP_SIZE, bounds.height);
  const width = clamp(selection.width, MIN_CROP_SIZE, maxWidth);
  const height = clamp(selection.height, MIN_CROP_SIZE, maxHeight);
  const x = clamp(selection.x, bounds.x, bounds.x + bounds.width - width);
  const y = clamp(selection.y, bounds.y, bounds.y + bounds.height - height);
  return { x, y, width, height };
}

function resizeSelection(
  selection: CropSelection,
  bounds: CropBounds,
  mode: CropDragMode,
  dx: number,
  dy: number,
): CropSelection {
  if (mode === 'move') {
    return constrainSelection({
      ...selection,
      x: selection.x + dx,
      y: selection.y + dy,
    }, bounds);
  }

  let left = selection.x;
  let top = selection.y;
  let right = selection.x + selection.width;
  let bottom = selection.y + selection.height;

  if (mode.includes('w')) left = clamp(left + dx, bounds.x, right - MIN_CROP_SIZE);
  if (mode.includes('e')) right = clamp(right + dx, left + MIN_CROP_SIZE, bounds.x + bounds.width);
  if (mode.includes('n')) top = clamp(top + dy, bounds.y, bottom - MIN_CROP_SIZE);
  if (mode.includes('s')) bottom = clamp(bottom + dy, top + MIN_CROP_SIZE, bounds.y + bounds.height);

  return constrainSelection({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }, bounds);
}

const ImageCropOverlay: React.FC<ImageCropOverlayProps> = ({
  applying = false,
  bounds,
  selection,
  onApply,
  onCancel,
  onSelectionChange,
}) => {
  const dragRef = React.useRef<{
    mode: CropDragMode;
    pointerId: number;
    startX: number;
    startY: number;
    startSelection: CropSelection;
  } | null>(null);

  const startDrag = React.useCallback((
    event: React.PointerEvent<HTMLElement>,
    mode: CropDragMode,
  ) => {
    if (!bounds || !selection || applying) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startSelection: selection,
    };
  }, [applying, bounds, selection]);

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !bounds) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectionChange(resizeSelection(
      drag.startSelection,
      bounds,
      drag.mode,
      event.clientX - drag.startX,
      event.clientY - drag.startY,
    ));
  }, [bounds, onSelectionChange]);

  const handlePointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
  }, []);

  if (!bounds || !selection) return null;

  const dimStyle = {
    top: selection.y,
    left: selection.x,
    right: `calc(100% - ${selection.x + selection.width}px)`,
    bottom: `calc(100% - ${selection.y + selection.height}px)`,
  };

  const handles: CropDragMode[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  return (
    <div
      className="image-crop-layer"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="image-crop-toolbar">
        <div className="image-crop-title">
          <IconCrop />
          <span>裁剪</span>
        </div>
        <div className="image-crop-actions">
          <Tooltip content="取消" position="bottom">
            <Button
              className="image-crop-action"
              theme="borderless"
              type="tertiary"
              icon={<IconClose />}
              onClick={onCancel}
              aria-label="取消裁剪"
              disabled={applying}
            />
          </Tooltip>
          <Tooltip content="保存副本" position="bottom">
            <Button
              className="image-crop-action primary"
              theme="solid"
              type="primary"
              icon={<IconTick />}
              onClick={onApply}
              aria-label="保存裁剪副本"
              loading={applying}
            />
          </Tooltip>
        </div>
      </div>
      <div className="image-crop-dim top" style={{ height: dimStyle.top }} />
      <div className="image-crop-dim right" style={{ left: selection.x + selection.width }} />
      <div className="image-crop-dim bottom" style={{ top: selection.y + selection.height }} />
      <div className="image-crop-dim left" style={{ width: dimStyle.left }} />
      <div
        className="image-crop-box"
        style={{
          left: selection.x,
          top: selection.y,
          width: selection.width,
          height: selection.height,
        }}
        onPointerDown={(event) => startDrag(event, 'move')}
      >
        <div className="image-crop-grid" />
        <div className="image-crop-size">
          {Math.round(selection.width)} × {Math.round(selection.height)}
        </div>
        {handles.map(handle => (
          <span
            key={handle}
            className={`image-crop-handle ${handle}`}
            onPointerDown={(event) => startDrag(event, handle)}
          />
        ))}
      </div>
    </div>
  );
};

export default ImageCropOverlay;
