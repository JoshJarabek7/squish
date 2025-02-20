import {
  Layer,
  TextLayer,
  ImageLayer,
  StickerLayer,
} from '@/types/ProjectType';
import { TextToolbar } from '@/components/text-toolbar';
import { ImageToolbar } from '@/components/image-toolbar';
import { Button } from '@/components/ui/button';
import {
  Image as ImageIcon,
  Type,
  Undo,
  Redo,
  Download,
  Palette,
  Grid,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface HeaderToolbarProps {
  selectedLayer: Layer | null;
  onLayerUpdate: (layer: Layer) => void;
  isEditing: boolean;
  onAddImage: () => void;
  onAddText: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  canUndo: boolean;
  canRedo: boolean;
  sidebarTrigger: React.ReactNode;
  onBackgroundColorChange: (color: string) => void;
  onBackgroundImageChange: (file: File) => void;
  onClearBackground: () => void;
  onLayerDelete: (layerId: string) => void;
  onLayerDuplicate: (layerId: string) => void;
  onSegment?: (images: string[]) => void;
  assetData: {
    [key: string]: { url: string; loading: boolean; error: boolean };
  };
  canvasBackground: {
    type: 'color' | 'image' | 'none';
    color?: string;
    imageId?: string;
    imageUrl?: string;
  };
  gridSettings: {
    enabled: boolean;
    columns: number;
    rows: number;
    showFractions: boolean;
  };
  onGridSettingsChange: (settings: {
    enabled: boolean;
    columns: number;
    rows: number;
    showFractions: boolean;
  }) => void;
}

export function HeaderToolbar({
  selectedLayer,
  onLayerUpdate,
  onAddImage,
  onAddText,
  onUndo,
  onRedo,
  onExport,
  canUndo,
  canRedo,
  sidebarTrigger,
  onBackgroundColorChange,
  onBackgroundImageChange,
  onClearBackground,
  onLayerDelete,
  onLayerDuplicate,
  onSegment,
  assetData,
  canvasBackground,
  gridSettings,
  onGridSettingsChange,
}: HeaderToolbarProps) {
  const handleFlipHorizontal = () => {
    if (!selectedLayer) return;
    onLayerUpdate({
      ...selectedLayer,
      transform: {
        ...selectedLayer.transform,
        scaleX: (selectedLayer.transform.scaleX ?? 1) * -1,
      },
    });
  };

  const handleFlipVertical = () => {
    if (!selectedLayer) return;
    onLayerUpdate({
      ...selectedLayer,
      transform: {
        ...selectedLayer.transform,
        scaleY: (selectedLayer.transform.scaleY ?? 1) * -1,
      },
    });
  };

  return (
    <div className='flex flex-col w-full'>
      {/* Main toolbar */}
      <div className='flex items-center justify-between w-full px-4 h-14 bg-background border-b z-[10000] relative'>
        {/* Left side */}
        <div className='flex items-center gap-4'>
          {sidebarTrigger}
          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              size='icon'
              onClick={onAddImage}
              title='Add Image'
            >
              <ImageIcon className='h-4 w-4' />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              onClick={onAddText}
              title='Add Text'
            >
              <Type className='h-4 w-4' />
            </Button>
          </div>
        </div>

        {/* Center - Undo/Redo */}
        <div className='flex items-center gap-2 absolute left-1/2 -translate-x-1/2'>
          <Button
            variant='ghost'
            size='icon'
            onClick={onUndo}
            disabled={!canUndo}
            title='Undo'
          >
            <Undo className='h-4 w-4' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={onRedo}
            disabled={!canRedo}
            title='Redo'
          >
            <Redo className='h-4 w-4' />
          </Button>
        </div>

        {/* Right side */}
        <div className='flex items-center gap-2'>
          {/* Grid controls */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className={cn(gridSettings.enabled && 'bg-accent')}
                title='Grid Settings'
              >
                <Grid className='h-4 w-4' />
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-80 p-4' side='bottom' align='end'>
              <div className='space-y-4'>
                <div className='flex items-center justify-between'>
                  <Label htmlFor='grid-enabled'>Show Grid</Label>
                  <Switch
                    id='grid-enabled'
                    checked={gridSettings.enabled}
                    onCheckedChange={(checked) =>
                      onGridSettingsChange({
                        ...gridSettings,
                        enabled: checked,
                      })
                    }
                  />
                </div>

                <div className='space-y-2'>
                  <Label>Columns ({gridSettings.columns})</Label>
                  <Slider
                    min={2}
                    max={16}
                    step={1}
                    value={[gridSettings.columns]}
                    onValueChange={([value]) =>
                      onGridSettingsChange({
                        ...gridSettings,
                        columns: value,
                      })
                    }
                  />
                </div>

                <div className='space-y-2'>
                  <Label>Rows ({gridSettings.rows})</Label>
                  <Slider
                    min={2}
                    max={16}
                    step={1}
                    value={[gridSettings.rows]}
                    onValueChange={([value]) =>
                      onGridSettingsChange({
                        ...gridSettings,
                        rows: value,
                      })
                    }
                  />
                </div>

                <div className='flex items-center justify-between'>
                  <Label htmlFor='show-fractions'>Show Fractions</Label>
                  <Switch
                    id='show-fractions'
                    checked={gridSettings.showFractions}
                    onCheckedChange={(checked) =>
                      onGridSettingsChange({
                        ...gridSettings,
                        showFractions: checked,
                      })
                    }
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Background controls */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='relative'
                onClick={(e) => e.stopPropagation()}
              >
                <Palette className='h-4 w-4' />
                {canvasBackground.type === 'color' && (
                  <div
                    className='absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full ring-1 ring-border'
                    style={{ backgroundColor: canvasBackground.color }}
                  />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side='bottom'
              align='end'
              className='w-64 p-3'
              sideOffset={5}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onClick={(e) => e.stopPropagation()}
              onPointerDownOutside={(e) => e.preventDefault()}
              onInteractOutside={(e) => e.preventDefault()}
            >
              <div className='space-y-3'>
                <div className='flex items-center justify-between'>
                  <div className='font-medium'>Background Color</div>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearBackground();
                    }}
                    className='h-6 px-2 text-xs'
                  >
                    Clear
                  </Button>
                </div>
                <div className='grid grid-cols-6 gap-1'>
                  {[
                    '#FFFFFF',
                    '#F8F9FA',
                    '#E9ECEF',
                    '#DEE2E6',
                    '#CED4DA',
                    '#ADB5BD',
                    '#6C757D',
                    '#495057',
                    '#343A40',
                    '#212529',
                    '#000000',
                    '#FF0000',
                    '#00FF00',
                    '#0000FF',
                    '#FFFF00',
                    '#FF00FF',
                    '#00FFFF',
                    '#FFA500',
                  ].map((color) => (
                    <button
                      key={color}
                      className={cn(
                        'h-8 w-8 rounded-md border border-border hover:scale-110 transition-transform',
                        canvasBackground.type === 'color' &&
                          canvasBackground.color === color &&
                          'ring-2 ring-primary ring-offset-2'
                      )}
                      style={{ backgroundColor: color }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onBackgroundColorChange(color);
                      }}
                    />
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant='ghost'
            size='icon'
            className='relative'
            onClick={(e) => {
              e.stopPropagation();
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                  onBackgroundImageChange(file);
                }
              };
              input.click();
            }}
          >
            <ImageIcon className='h-4 w-4' />
            {canvasBackground.type === 'image' && (
              <div className='absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full bg-primary ring-1 ring-border' />
            )}
          </Button>

          <Button variant='ghost' size='icon' onClick={onExport} title='Export'>
            <Download className='h-4 w-4' />
          </Button>
        </div>
      </div>

      {/* Layer-specific toolbar */}
      {selectedLayer && (
        <div className='w-full bg-background border-b relative z-[10000]'>
          {selectedLayer.type === 'text' ? (
            <TextToolbar
              layer={selectedLayer as TextLayer}
              onUpdate={(updates) =>
                onLayerUpdate({ ...selectedLayer, ...updates } as Layer)
              }
            />
          ) : (
            <ImageToolbar
              layer={selectedLayer as ImageLayer | StickerLayer}
              onUpdate={(updates) =>
                onLayerUpdate({ ...selectedLayer, ...updates } as Layer)
              }
              onFlipHorizontal={handleFlipHorizontal}
              onFlipVertical={handleFlipVertical}
              onDelete={() => onLayerDelete(selectedLayer.id)}
              onDuplicate={() => onLayerDuplicate(selectedLayer.id)}
              assetUrl={
                selectedLayer.type === 'image'
                  ? assetData[selectedLayer.imageAssetId]?.url
                  : assetData[selectedLayer.stickerAssetId]?.url
              }
              onSegment={onSegment}
            />
          )}
        </div>
      )}
    </div>
  );
}
