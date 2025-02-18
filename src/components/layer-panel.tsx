import { Layer } from '@/types/ProjectType';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Trash2,
  Copy,
  GripVertical,
  Layers,
  Image as ImageIcon,
  Type,
} from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface LayerPanelTriggerProps {
  isOpen: boolean;
  onClick: () => void;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

export function LayerPanelTrigger({
  isOpen,
  onClick,
  triggerRef,
}: LayerPanelTriggerProps) {
  return (
    <Button
      ref={triggerRef}
      variant='secondary'
      size='icon'
      onClick={onClick}
      className={cn(
        'rounded-full bg-background/80 backdrop-blur-sm shadow-lg hover:bg-accent transition-colors',
        isOpen && 'bg-accent text-accent-foreground'
      )}
    >
      <Layers className='h-4 w-4' />
    </Button>
  );
}

interface SortableLayerItemProps {
  layer: Layer;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  assetUrl?: string;
}

function SortableLayerItem({
  layer,
  isSelected,
  onSelect,
  onDelete,
  onDuplicate,
  assetUrl,
}: SortableLayerItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: layer.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'layer-item group relative rounded-lg border bg-card transition-colors',
        isSelected && 'border-primary',
        isDragging && 'opacity-50 scale-95 z-50 shadow-lg'
      )}
      {...attributes}
    >
      <div
        className={cn(
          'flex items-center gap-2 p-2 cursor-pointer',
          isSelected && 'bg-accent'
        )}
        onClick={onSelect}
      >
        <button
          className='h-8 w-8 flex items-center justify-center cursor-grab active:cursor-grabbing'
          {...listeners}
        >
          <GripVertical className='h-4 w-4 text-muted-foreground' />
        </button>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2'>
            {layer.type === 'text' ? (
              <>
                <Type className='h-4 w-4 text-muted-foreground' />
                <span className='truncate text-sm font-medium'>
                  {layer.content ? (
                    <span className='text-muted-foreground font-normal'>
                      {layer.content.length > 20
                        ? layer.content.substring(0, 20) + '...'
                        : layer.content}
                    </span>
                  ) : (
                    'Empty Text Layer'
                  )}
                </span>
              </>
            ) : (
              <>
                <ImageIcon className='h-4 w-4 text-muted-foreground' />
                <div className='flex items-center gap-2'>
                  <span className='text-sm font-medium'>
                    {layer.type === 'image' ? 'Image' : 'Sticker'}
                  </span>
                  {assetUrl && (
                    <div className='w-8 h-8 rounded border border-border overflow-hidden bg-muted flex items-center justify-center'>
                      <img
                        src={assetUrl}
                        alt=''
                        className='w-full h-full object-cover'
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className='flex items-center gap-1'>
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity'
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
          >
            <Copy className='h-3 w-3' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20 hover:text-destructive'
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className='h-3 w-3' />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface LayerPanelProps {
  layers: Array<{ id: string; index: number }>;
  layerData: Layer[];
  selectedLayerId: string | null;
  onLayerSelect: (id: string | null) => void;
  onLayerReorder: (layerId: string, newIndex: number) => void;
  onLayerDelete: (layerId: string) => void;
  onLayerDuplicate: (layerId: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement>;
  assetUrls?: { [key: string]: string };
}

export function LayerPanel({
  layers,
  layerData,
  selectedLayerId,
  onLayerSelect,
  onLayerReorder,
  onLayerDelete,
  onLayerDuplicate,
  isOpen,
  onOpenChange,
  triggerRef,
  assetUrls = {},
}: LayerPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Sort layers by index for display
  const sortedLayers = [...layers].sort((a, b) => b.index - a.index);
  const items = sortedLayers.map((layer) => layer.id);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const newIndex = items.indexOf(over.id as string);
      onLayerReorder(active.id as string, sortedLayers[newIndex].index);
    }

    setActiveId(null);
  };

  const activeLayer = activeId
    ? layerData.find((l) => l.id === activeId)
    : null;
  const activeAssetId = activeLayer
    ? activeLayer.type === 'image'
      ? activeLayer.imageAssetId
      : activeLayer.type === 'sticker'
        ? activeLayer.stickerAssetId
        : undefined
    : undefined;
  const activeAssetUrl = activeAssetId ? assetUrls[activeAssetId] : undefined;

  return (
    <Drawer direction='right' open={isOpen} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>
        <LayerPanelTrigger
          isOpen={isOpen}
          onClick={() => onOpenChange(!isOpen)}
          triggerRef={triggerRef}
        />
      </DrawerTrigger>
      <DrawerContent className='h-full max-h-screen z-[10000]'>
        <div className='w-full max-w-sm mx-auto'>
          <DrawerHeader>
            <DrawerTitle>Layers</DrawerTitle>
          </DrawerHeader>
          <div className='p-4 space-y-2 max-h-[calc(100vh-5rem)] overflow-y-auto'>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={items}
                strategy={verticalListSortingStrategy}
              >
                {sortedLayers.map((layer) => {
                  const layerInfo = layerData.find((l) => l.id === layer.id);
                  if (!layerInfo) return null;

                  const assetId =
                    layerInfo.type === 'image'
                      ? layerInfo.imageAssetId
                      : layerInfo.type === 'sticker'
                        ? layerInfo.stickerAssetId
                        : undefined;
                  const assetUrl = assetId ? assetUrls[assetId] : undefined;

                  return (
                    <SortableLayerItem
                      key={layer.id}
                      layer={layerInfo}
                      index={layer.index}
                      isSelected={layer.id === selectedLayerId}
                      onSelect={() => onLayerSelect(layer.id)}
                      onDelete={() => onLayerDelete(layer.id)}
                      onDuplicate={() => onLayerDuplicate(layer.id)}
                      assetUrl={assetUrl}
                    />
                  );
                })}
              </SortableContext>
              <DragOverlay>
                {activeLayer ? (
                  <SortableLayerItem
                    layer={activeLayer}
                    index={-1}
                    isSelected={activeLayer.id === selectedLayerId}
                    onSelect={() => {}}
                    onDelete={() => {}}
                    onDuplicate={() => {}}
                    assetUrl={activeAssetUrl}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
