import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Layer } from '@/types/ProjectType';
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  Copy,
  FlipHorizontal,
  FlipVertical,
  Italic,
  MoveDown,
  MoveUp,
  Trash2,
} from 'lucide-react';

interface LayerContextMenuProps {
  layer: Layer;
  children: React.ReactNode;
  onLayerUpdate: (layer: Layer) => void;
  onLayerDelete: () => void;
  onLayerDuplicate: () => void;
  onLayerReorder?: (direction: 'up' | 'down') => void;
}

export function LayerContextMenu({
  layer,
  children,
  onLayerUpdate,
  onLayerDelete,
  onLayerDuplicate,
  onLayerReorder,
}: LayerContextMenuProps) {
  const handleHorizontalAlign = (align: 'left' | 'center' | 'right') => {
    if (layer.type !== 'text') return;
    onLayerUpdate({
      ...layer,
      style: {
        ...layer.style,
        textAlign: align,
      },
    });
  };

  const handleVerticalAlign = (align: 'top' | 'center' | 'bottom') => {
    if (layer.type !== 'text') return;
    onLayerUpdate({
      ...layer,
      style: {
        ...layer.style,
        verticalAlign: align,
      },
    });
  };

  const handleBold = () => {
    if (layer.type !== 'text') return;
    onLayerUpdate({
      ...layer,
      style: {
        ...layer.style,
        fontWeight: layer.style.fontWeight === 700 ? 400 : 700,
      },
    });
  };

  const handleItalic = () => {
    if (layer.type !== 'text') return;
    onLayerUpdate({
      ...layer,
      style: {
        ...layer.style,
        italic: !layer.style.italic,
      },
    });
  };

  const handleFlipHorizontal = () => {
    onLayerUpdate({
      ...layer,
      transform: {
        ...layer.transform,
        scaleX: (layer.transform.scaleX ?? 1) * -1,
      },
    });
  };

  const handleFlipVertical = () => {
    onLayerUpdate({
      ...layer,
      transform: {
        ...layer.transform,
        scaleY: (layer.transform.scaleY ?? 1) * -1,
      },
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className='w-64'>
        {/* Common actions */}
        <ContextMenuItem onClick={onLayerDuplicate} className='gap-2'>
          <Copy className='h-4 w-4' />
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem
          onClick={onLayerDelete}
          className='gap-2 text-destructive focus:text-destructive'
        >
          <Trash2 className='h-4 w-4' />
          Delete
        </ContextMenuItem>

        {onLayerReorder && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => onLayerReorder('up')}
              className='gap-2'
            >
              <MoveUp className='h-4 w-4' />
              Move Forward
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => onLayerReorder('down')}
              className='gap-2'
            >
              <MoveDown className='h-4 w-4' />
              Move Backward
            </ContextMenuItem>
          </>
        )}

        {/* Text-specific actions */}
        {layer.type === 'text' && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleBold} className='gap-2'>
              <Bold className='h-4 w-4' />
              Bold
            </ContextMenuItem>
            <ContextMenuItem onClick={handleItalic} className='gap-2'>
              <Italic className='h-4 w-4' />
              Italic
            </ContextMenuItem>

            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => handleHorizontalAlign('left')}
              className='gap-2'
            >
              <AlignHorizontalJustifyStart className='h-4 w-4' />
              Align Left
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleHorizontalAlign('center')}
              className='gap-2'
            >
              <AlignHorizontalJustifyCenter className='h-4 w-4' />
              Align Center
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleHorizontalAlign('right')}
              className='gap-2'
            >
              <AlignHorizontalJustifyEnd className='h-4 w-4' />
              Align Right
            </ContextMenuItem>

            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => handleVerticalAlign('top')}
              className='gap-2'
            >
              <AlignVerticalJustifyStart className='h-4 w-4' />
              Align Top
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleVerticalAlign('center')}
              className='gap-2'
            >
              <AlignVerticalJustifyCenter className='h-4 w-4' />
              Align Middle
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleVerticalAlign('bottom')}
              className='gap-2'
            >
              <AlignVerticalJustifyEnd className='h-4 w-4' />
              Align Bottom
            </ContextMenuItem>
          </>
        )}

        {/* Image/Sticker-specific actions */}
        {(layer.type === 'image' || layer.type === 'sticker') && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleFlipHorizontal} className='gap-2'>
              <FlipHorizontal className='h-4 w-4' />
              Flip Horizontally
            </ContextMenuItem>
            <ContextMenuItem onClick={handleFlipVertical} className='gap-2'>
              <FlipVertical className='h-4 w-4' />
              Flip Vertically
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
