import { ImageLayer, StickerLayer } from '@/types/ProjectType';
import { useState } from 'react';
import {
  FlipHorizontal,
  FlipVertical,
  Eraser,
  Scissors,
  Scan,
  ChevronDown,
  ChevronUp,
  Copy,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentationDialog } from '@/components/segmentation-dialog';
import { cn } from '@/lib/utils';

interface ImageToolbarProps {
  layer: ImageLayer | StickerLayer;
  onUpdate: (updates: Partial<ImageLayer | StickerLayer>) => void;
  onFlipHorizontal?: () => void;
  onFlipVertical?: () => void;
  onStartEraserMode?: () => void;
  onSplitByTransparency?: () => void;
  onSegment?: (images: string[]) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  className?: string;
  assetUrl?: string;
}

export function ImageToolbar({
  layer,
  onFlipHorizontal,
  onFlipVertical,
  onStartEraserMode,
  onSplitByTransparency,
  onSegment,
  onDelete,
  onDuplicate,
  className,
  assetUrl,
}: ImageToolbarProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [segmentationOpen, setSegmentationOpen] = useState(false);

  return (
    <div
      className={cn(
        'absolute top-full left-0 right-0 z-[1000] bg-background border-b',
        className
      )}
    >
      <div className='h-10 flex-none'>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => setIsExpanded(!isExpanded)}
          className='w-full h-10 gap-2'
        >
          {isExpanded ? (
            <ChevronUp className='h-4 w-4' />
          ) : (
            <ChevronDown className='h-4 w-4' />
          )}
          <span>
            {layer.type === 'image' ? 'Image Controls' : 'Sticker Controls'}
          </span>
        </Button>

        {isExpanded && (
          <div className='bg-background border-b shadow-md'>
            <div className='flex items-center justify-center gap-2 px-4 py-2'>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8'
                onClick={onFlipHorizontal}
                title='Flip Horizontally'
              >
                <FlipHorizontal className='h-4 w-4' />
              </Button>

              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8'
                onClick={onFlipVertical}
                title='Flip Vertically'
              >
                <FlipVertical className='h-4 w-4' />
              </Button>

              <div className='h-8 w-px bg-border' />

              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8'
                onClick={onStartEraserMode}
                title='Eraser Tool'
              >
                <Eraser className='h-4 w-4' />
              </Button>

              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8'
                onClick={onSplitByTransparency}
                title='Split by Transparency'
              >
                <Scissors className='h-4 w-4' />
              </Button>

              {layer.type === 'image' && assetUrl && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-8 w-8'
                  onClick={() => setSegmentationOpen(true)}
                  title='Segment Image'
                >
                  <Scan className='h-4 w-4' />
                </Button>
              )}

              <div className='h-8 w-px bg-border' />

              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8'
                onClick={onDuplicate}
                title='Duplicate Layer'
              >
                <Copy className='h-4 w-4' />
              </Button>

              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 hover:bg-destructive/20 hover:text-destructive'
                onClick={onDelete}
                title='Delete Layer'
              >
                <Trash2 className='h-4 w-4' />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Segmentation Dialog */}
      {layer.type === 'image' && assetUrl && (
        <SegmentationDialog
          open={segmentationOpen}
          onOpenChange={setSegmentationOpen}
          imageUrl={assetUrl}
          onSegmentationComplete={(images) => {
            setSegmentationOpen(false);
            onSegment?.(images);
          }}
        />
      )}
    </div>
  );
}
