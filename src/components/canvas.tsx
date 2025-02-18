import { useRef, useState, useEffect } from 'react';
import { Layer } from '@/types/ProjectType';
import { cn } from '@/lib/utils';
import {
  getProjectLayers,
  getImageAssetData,
  getStickerAssetData,
  getCanvasSettings,
  updateCanvasSettings,
} from '@/lib/db';
import { ZoomIn, ZoomOut, Move } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { compareLayersForRender } from '@/lib/utils';

interface CanvasProps {
  projectId: string;
  layers: Array<{ id: string; index: number }>;
  selectedLayerId: string | null;
  onLayerSelect: (id: string | null) => void;
  onLayerUpdate: (layer: Layer) => Promise<void>;
  onLayerReorder: (layerId: string, newIndex: number) => void;
  onLayerDelete: (layerId: string) => void;
  onLayerDuplicate: (layerId: string) => void;
  showCanvasResizeHandles?: boolean;
  className?: string;
  onAssetDataChange?: (assetData: {
    [key: string]: { url: string; loading: boolean; error: boolean };
  }) => void;
  canvasSettingsVersion?: number;
  canvasBackground: {
    type: 'color' | 'image' | 'none';
    color?: string;
    imageId?: string;
    imageUrl?: string;
    imageSize?: { width: number; height: number };
  };
  onBackgroundChange: (background: {
    type: 'color' | 'image' | 'none';
    color?: string;
    imageId?: string;
    imageUrl?: string;
    imageSize?: { width: number; height: number };
  }) => void;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
}

interface AssetCache {
  [key: string]: {
    url: string;
    loading: boolean;
    error: boolean;
  };
}

export function Canvas({
  projectId,
  layers,
  selectedLayerId,
  onLayerSelect,
  onLayerUpdate,
  showCanvasResizeHandles = true,
  className,
  onAssetDataChange,
  canvasSettingsVersion = 0,
  canvasBackground,
  onBackgroundChange,
  zoom: externalZoom,
  onZoomChange,
}: CanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [layerData, setLayerData] = useState<Layer[]>([]);
  const [assetData, setAssetData] = useState<AssetCache>({});
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [eraserPath, setEraserPath] = useState<Array<[number, number]>>([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [internalZoom, setInternalZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<
    'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null
  >(null);
  const [resizeStart, setResizeStart] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [dragLayer, setDragLayer] = useState<Layer | null>(null);
  const [isCanvasResizing, setIsCanvasResizing] = useState(false);
  const [canvasResizeStart, setCanvasResizeStart] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [canvasResizeHandle, setCanvasResizeHandle] = useState<
    'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null
  >(null);
  const hasInitialCentered = useRef(false);

  // Use either external or internal zoom
  const zoom = externalZoom ?? internalZoom;
  const setZoom = (newZoom: number) => {
    if (onZoomChange) {
      onZoomChange(newZoom);
    } else {
      setInternalZoom(newZoom);
    }
  };

  // Function to handle zoom changes with mouse position
  const handleZoom = (delta: number, clientX?: number, clientY?: number) => {
    const minZoom = 0.1;
    const maxZoom = 5;
    const newZoom = Math.min(Math.max(minZoom, zoom + delta), maxZoom);

    if (clientX !== undefined && clientY !== undefined && canvasRef.current) {
      // Get the canvas rect
      const rect = canvasRef.current.getBoundingClientRect();

      // Calculate the point on the canvas where we're zooming
      const x = (clientX - rect.left) / zoom;
      const y = (clientY - rect.top) / zoom;

      // Calculate new offsets to keep the zoom point stationary
      const newOffsetX = x * (zoom - newZoom);
      const newOffsetY = y * (zoom - newZoom);

      // Update viewport offset to maintain zoom point
      setViewportOffset((prev) => ({
        x: prev.x + newOffsetX,
        y: prev.y + newOffsetY,
      }));
    }

    setZoom(newZoom);
  };

  // Add this helper function near the top of the component
  const logLayerOrder = (message: string) => {
    const layerOrder = layers.map((l) => ({
      id: l.id,
      index: l.index,
      type: layerData.find((ld) => ld.id === l.id)?.type,
    }));

    const renderOrder = [...layerData]
      .sort((a, b) => {
        const aIndex = layers.find((l) => l.id === a.id)?.index ?? 0;
        const bIndex = layers.find((l) => l.id === b.id)?.index ?? 0;
        return aIndex - bIndex;
      })
      .map((l) => ({
        id: l.id,
        type: l.type,
        index: layers.find((layer) => layer.id === l.id)?.index,
      }));

    console.log(`\n=== ${message} ===`);
    console.log('Current layers order:', layerOrder);
    console.log('LayerData render order:', renderOrder);
    console.log('===================\n');
  };

  // Function to center and fit canvas in viewport
  const centerAndFitCanvas = () => {
    const workspace = workspaceRef.current;
    const canvas = canvasRef.current;
    if (!workspace || !canvas) return;

    // Get the workspace dimensions
    const workspaceRect = workspace.getBoundingClientRect();
    const workspaceWidth = workspaceRect.width;
    const workspaceHeight = workspaceRect.height;

    // Calculate zoom to fit canvas in viewport with padding
    const padding = 40; // 20px padding on each side
    const horizontalZoom = (workspaceWidth - padding * 2) / canvasSize.width;
    const verticalZoom = (workspaceHeight - padding * 2) / canvasSize.height;
    const newZoom = Math.min(horizontalZoom, verticalZoom, 1); // Don't zoom in past 100%

    // Calculate the scaled canvas dimensions
    const scaledCanvasWidth = canvasSize.width * newZoom;
    const scaledCanvasHeight = canvasSize.height * newZoom;

    // Calculate the position to center the canvas in the workspace
    const newX = Math.round((workspaceWidth - scaledCanvasWidth) / 2);
    const newY = Math.round((workspaceHeight - scaledCanvasHeight) / 2);

    // Update state
    setZoom(newZoom);
    setViewportOffset({ x: newX, y: newY });
  };

  // Call centerAndFitCanvas ONLY on initial project load
  useEffect(() => {
    if (!hasInitialCentered.current && projectId) {
      // Add a small delay to ensure the workspace has its final dimensions
      const timer = setTimeout(centerAndFitCanvas, 100);
      hasInitialCentered.current = true;
      return () => clearTimeout(timer);
    }
  }, [projectId]);

  // Reset hasInitialCentered when project changes
  useEffect(() => {
    hasInitialCentered.current = false;
  }, [projectId]);

  // Remove auto-centering from resize observer
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const resizeObserver = new ResizeObserver(() => {
      // Do nothing on resize - only manual centering is allowed
    });
    resizeObserver.observe(workspace);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Load layer data
  useEffect(() => {
    const loadLayers = async () => {
      try {
        console.log('Loading layers for project:', projectId);
        const layers = await getProjectLayers(projectId);
        console.log('Loaded layers:', layers);
        setLayerData(layers);
        logLayerOrder('After loading layers');

        // Initialize asset loading state while preserving existing URLs
        const newAssetData: AssetCache = { ...assetData };
        layers
          .filter((layer) => layer.type === 'image' || layer.type === 'sticker')
          .forEach((layer) => {
            const assetId =
              layer.type === 'image'
                ? layer.imageAssetId
                : layer.stickerAssetId;
            // Only load if we don't already have a non-error URL
            if (!newAssetData[assetId] || newAssetData[assetId].error) {
              newAssetData[assetId] = {
                url: newAssetData[assetId]?.url || '',
                loading: true,
                error: false,
              };
            }
          });

        // Update asset data in a separate effect to avoid render phase updates
        setAssetData(newAssetData);

        // Load assets in parallel
        const loadPromises = layers
          .filter((layer) => layer.type === 'image' || layer.type === 'sticker')
          .map(async (layer) => {
            const assetId =
              layer.type === 'image'
                ? layer.imageAssetId
                : layer.stickerAssetId;

            // Skip if we already have a valid URL
            if (newAssetData[assetId]?.url && !newAssetData[assetId].error) {
              return;
            }

            try {
              const data = await (layer.type === 'image'
                ? getImageAssetData(assetId)
                : getStickerAssetData(assetId));

              const binaryData = data instanceof Uint8Array ? data : data.data;
              const mimeType =
                data instanceof Uint8Array ? 'image/png' : data.mimeType;

              const blob = new Blob([binaryData], { type: mimeType });

              // Clean up old URL if it exists
              if (newAssetData[assetId]?.url) {
                URL.revokeObjectURL(newAssetData[assetId].url);
              }

              const url = URL.createObjectURL(blob);
              setAssetData((prev) => ({
                ...prev,
                [assetId]: { url, loading: false, error: false },
              }));
            } catch (error) {
              console.error(`Failed to load asset ${assetId}:`, error);
              setAssetData((prev) => ({
                ...prev,
                [assetId]: {
                  url: '',
                  loading: false,
                  error: true,
                },
              }));
            }
          });

        await Promise.all(loadPromises);
      } catch (error) {
        console.error('Failed to load layers:', error);
        toast.error('Failed to load layers');
      }
    };

    loadLayers();
  }, [projectId, canvasSettingsVersion]);

  // Effect to sync asset data changes with parent
  useEffect(() => {
    onAssetDataChange?.(assetData);
  }, [assetData, onAssetDataChange]);

  // Cleanup URLs when component unmounts
  useEffect(() => {
    return () => {
      Object.values(assetData).forEach((asset) => {
        if (asset.url) {
          URL.revokeObjectURL(asset.url);
        }
      });
    };
  }, []);

  // Load canvas settings including background
  useEffect(() => {
    const loadCanvasSettings = async () => {
      try {
        const settings = await getCanvasSettings(projectId);
        setCanvasSize({
          width: settings.width,
          height: settings.height,
        });

        // Load background settings
        if (settings.backgroundType === 'image' && settings.backgroundImageId) {
          try {
            const imageData = await getImageAssetData(
              settings.backgroundImageId
            );

            // Create a new Image to ensure it's loaded before creating the blob URL
            const img = new Image();
            const loadPromise = new Promise<{ width: number; height: number }>(
              (resolve, reject) => {
                img.onload = () =>
                  resolve({
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                  });
                img.onerror = reject;
              }
            );

            const blob = new Blob(
              [imageData instanceof Uint8Array ? imageData : imageData.data],
              {
                type:
                  imageData instanceof Uint8Array
                    ? 'image/jpeg'
                    : imageData.mimeType,
              }
            );
            const imageUrl = URL.createObjectURL(blob);
            img.src = imageUrl;

            // Wait for image to load and get its dimensions
            const imageSize = await loadPromise;

            // Clean up old background image URL if it exists
            if (
              canvasBackground.type === 'image' &&
              canvasBackground.imageUrl
            ) {
              URL.revokeObjectURL(canvasBackground.imageUrl);
            }

            onBackgroundChange({
              type: 'image',
              imageId: settings.backgroundImageId,
              imageUrl,
              imageSize,
            });
          } catch (error) {
            console.error('Failed to load background image:', error);
            onBackgroundChange({ type: 'none' });
          }
        } else if (
          settings.backgroundType === 'color' &&
          settings.backgroundColor
        ) {
          onBackgroundChange({
            type: 'color',
            color: settings.backgroundColor,
          });
        } else {
          onBackgroundChange({ type: 'none' });
        }
      } catch (error) {
        console.error('Failed to load canvas settings:', error);
      }
    };
    loadCanvasSettings();
  }, [projectId, canvasSettingsVersion]);

  // Clean up background image URL on unmount or when changing
  useEffect(() => {
    const currentUrl =
      canvasBackground.type === 'image' ? canvasBackground.imageUrl : null;
    return () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [canvasBackground.type, canvasBackground.imageUrl]);

  // Handle layer selection
  const handleLayerClick = (e: React.MouseEvent, layerId: string) => {
    e.stopPropagation();
    // Don't change selection if we're editing text
    if (editingTextId) {
      return;
    }
    onLayerSelect(layerId);
  };

  // Handle layer dragging
  const handleMouseDown = (e: React.MouseEvent, layer: Layer) => {
    if (editingTextId === layer.id) return; // Don't start drag while editing text
    if (layer.id !== selectedLayerId || isResizing || isPanning) return;
    if (isResizing) return; // Explicitly prevent drag during resize

    e.stopPropagation();
    e.preventDefault();
    console.log('Starting drag for layer:', layer.id);

    setIsDragging(true);
    setDragLayer(layer);

    // Get canvas rect for coordinate conversion
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;

    // Calculate mouse position relative to the canvas, accounting for zoom and pan
    const mouseX = (e.clientX - canvasRect.left) / zoom;
    const mouseY = (e.clientY - canvasRect.top) / zoom;

    setDragStart({
      x: mouseX - layer.transform.x,
      y: mouseY - layer.transform.y,
    });
  };

  // Handle mouse move during drag
  useEffect(() => {
    if (!isDragging || !dragLayer) return;

    const handleMouseMove = (e: MouseEvent) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;

      // Calculate new position relative to the canvas, accounting for zoom and pan
      const mouseX = (e.clientX - canvasRect.left) / zoom;
      const mouseY = (e.clientY - canvasRect.top) / zoom;

      const newX = mouseX - dragStart.x;
      const newY = mouseY - dragStart.y;

      // Update local state immediately for smooth dragging
      setLayerData((prev) =>
        prev.map((l) =>
          l.id === dragLayer.id
            ? {
                ...l,
                transform: {
                  ...l.transform,
                  x: newX,
                  y: newY,
                },
              }
            : l
        )
      );
    };

    const handleMouseUp = () => {
      console.log('Ending drag for layer:', dragLayer.id);

      // Get the final position and update the database
      const layer = layerData.find((l) => l.id === dragLayer.id);
      if (layer) {
        // Just update directly, let the DatabaseQueue handle serialization
        void onLayerUpdate(layer);
      }

      setIsDragging(false);
      setDragLayer(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragLayer, dragStart, zoom, layerData, onLayerUpdate]);

  // Handle keyboard controls for selected layer
  useEffect(() => {
    if (!selectedLayerId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const layer = layerData.find((l) => l.id === selectedLayerId);
      if (!layer) return;

      const MOVE_AMOUNT = 1;
      const ROTATE_AMOUNT = 1;
      const SCALE_AMOUNT = 0.01;
      const OPACITY_AMOUNT = 0.05;

      let newTransform = { ...layer.transform };

      switch (e.key) {
        case 'ArrowLeft':
          newTransform.x -= MOVE_AMOUNT;
          break;
        case 'ArrowRight':
          newTransform.x += MOVE_AMOUNT;
          break;
        case 'ArrowUp':
          newTransform.y -= MOVE_AMOUNT;
          break;
        case 'ArrowDown':
          newTransform.y += MOVE_AMOUNT;
          break;
        case 'r':
          newTransform.rotation += ROTATE_AMOUNT;
          break;
        case 'R':
          newTransform.rotation -= ROTATE_AMOUNT;
          break;
        case '+':
          newTransform.scaleX += SCALE_AMOUNT;
          newTransform.scaleY += SCALE_AMOUNT;
          break;
        case '-':
          newTransform.scaleX -= SCALE_AMOUNT;
          newTransform.scaleY -= SCALE_AMOUNT;
          break;
        case '[':
          newTransform.opacity = Math.max(
            0,
            newTransform.opacity - OPACITY_AMOUNT
          );
          break;
        case ']':
          newTransform.opacity = Math.min(
            1,
            newTransform.opacity + OPACITY_AMOUNT
          );
          break;
        default:
          return;
      }

      onLayerUpdate({
        ...layer,
        transform: newTransform,
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLayerId, layerData, onLayerUpdate]);

  const handleTextDoubleClick = (e: React.MouseEvent, layer: Layer) => {
    if (layer.type !== 'text') return;
    e.stopPropagation();
    e.preventDefault(); // Prevent any drag start
    setEditingTextId(layer.id);
    onLayerSelect(layer.id);
  };

  const handleContentEditableChange = (
    e: React.FormEvent<HTMLDivElement>,
    layer: Layer
  ) => {
    if (layer.type !== 'text') return;
    const newContent = e.currentTarget.textContent ?? '';
    if (newContent !== layer.content) {
      onLayerUpdate({
        ...layer,
        content: newContent,
      });
    }
  };

  const handleTextBlur = (e: React.FocusEvent) => {
    // Prevent blur if clicking within the toolbar or on elements marked with data-ignore-blur
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (
      relatedTarget &&
      (relatedTarget.closest('.text-toolbar') ||
        relatedTarget.closest('[data-ignore-blur]') ||
        relatedTarget.closest('[contenteditable="true"]'))
    ) {
      return;
    }
    setEditingTextId(null);
  };

  const handleResizeStart = (
    e: React.MouseEvent,
    handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  ) => {
    if (!selectedLayerId) return;

    e.stopPropagation();
    e.preventDefault();

    // Make sure we're not dragging
    if (isDragging) {
      setIsDragging(false);
      setDragLayer(null);
    }

    const layer = layerData.find((l) => l.id === selectedLayerId);
    if (!layer) return;

    setIsResizing(true);
    setResizeHandle(handle);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: layer.transform.width,
      height: layer.transform.height,
    });
  };

  // Update the calculateScaledDimensions function
  const calculateScaledDimensions = (
    imageWidth: number,
    imageHeight: number,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    const imageAspectRatio = imageWidth / imageHeight;
    const canvasAspectRatio = canvasWidth / canvasHeight;

    let scaledWidth: number;
    let scaledHeight: number;

    // Scale to cover the canvas while maintaining aspect ratio
    if (imageAspectRatio > canvasAspectRatio) {
      // Image is wider than canvas (relative to height)
      scaledHeight = canvasHeight;
      scaledWidth = canvasHeight * imageAspectRatio;
    } else {
      // Image is taller than canvas (relative to width)
      scaledWidth = canvasWidth;
      scaledHeight = canvasWidth / imageAspectRatio;
    }

    // Center the image
    const x = (canvasWidth - scaledWidth) / 2;
    const y = (canvasHeight - scaledHeight) / 2;

    return { width: scaledWidth, height: scaledHeight, x, y };
  };

  const renderLayer = (layer: Layer) => {
    const layerIndex = layers.find((l) => l.id === layer.id)?.index ?? 0;
    const isSelected = selectedLayerId === layer.id;

    const commonProps = {
      className: cn(
        'absolute select-none layer',
        isDragging && isSelected ? 'cursor-grabbing' : 'cursor-grab',
        layer.type === 'text' && editingTextId === layer.id && 'cursor-text',
        isResizing && 'pointer-events-none' // Add pointer-events-none when resizing
      ),
      style: {
        transform: `translate(${layer.transform.x}px, ${layer.transform.y}px) 
                   rotate(${layer.transform.rotation}deg) 
                   scale(${layer.transform.scaleX}, ${layer.transform.scaleY})`,
        width: layer.transform.width,
        height: layer.transform.height,
        opacity: layer.transform.opacity,
        mixBlendMode: layer.transform
          .blendMode as React.CSSProperties['mixBlendMode'],
        zIndex: layerIndex * 10,
        pointerEvents: isResizing
          ? 'none'
          : ('auto' as React.CSSProperties['pointerEvents']), // Fix type
      },
      onClick: (e: React.MouseEvent) => handleLayerClick(e, layer.id),
      onMouseDown: (e: React.MouseEvent) => {
        // Prevent drag start if we're resizing
        if (isResizing) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        handleMouseDown(e, layer);
      },
    };

    switch (layer.type) {
      case 'image':
      case 'sticker': {
        const assetId =
          layer.type === 'image' ? layer.imageAssetId : layer.stickerAssetId;
        const asset = assetData[assetId];

        if (!asset || asset.loading) {
          return (
            <div key={layer.id} {...commonProps}>
              <div className='w-full h-full bg-accent/20 flex items-center justify-center'>
                <span className='text-accent-foreground'>Loading...</span>
              </div>
            </div>
          );
        }

        if (asset.error) {
          return (
            <div key={layer.id} {...commonProps}>
              <div className='w-full h-full bg-destructive/20 flex items-center justify-center'>
                <span className='text-destructive'>Failed to load image</span>
              </div>
            </div>
          );
        }

        return (
          <div key={layer.id} {...commonProps}>
            <img
              src={asset.url}
              alt=''
              className='w-full h-full object-contain'
              draggable={false}
            />
            {/* Selection border */}
            {selectedLayerId === layer.id && (
              <>
                <div className='absolute -inset-[4px] z-selection pointer-events-none overflow-visible'>
                  <div className='absolute inset-0 rainbow-border' />
                </div>
                {/* Resize handles */}
                {(() => {
                  const isFlippedX = (layer.transform.scaleX ?? 1) < 0;
                  const isFlippedY = (layer.transform.scaleY ?? 1) < 0;

                  // Adjust cursor directions based on flip state
                  const getCursor = (handle: string) => {
                    switch (handle) {
                      case 'nw':
                        return `${isFlippedY ? 's' : 'n'}${isFlippedX ? 'e' : 'w'}-resize`;
                      case 'ne':
                        return `${isFlippedY ? 's' : 'n'}${isFlippedX ? 'w' : 'e'}-resize`;
                      case 'sw':
                        return `${isFlippedY ? 'n' : 's'}${isFlippedX ? 'e' : 'w'}-resize`;
                      case 'se':
                        return `${isFlippedY ? 'n' : 's'}${isFlippedX ? 'w' : 'e'}-resize`;
                      case 'n':
                        return `${isFlippedY ? 's' : 'n'}-resize`;
                      case 's':
                        return `${isFlippedY ? 'n' : 's'}-resize`;
                      case 'e':
                        return `${isFlippedX ? 'w' : 'e'}-resize`;
                      case 'w':
                        return `${isFlippedX ? 'e' : 'w'}-resize`;
                      default:
                        return 'move';
                    }
                  };

                  // Adjust handle type based on flip state
                  const getHandle = (handle: string) => {
                    switch (handle) {
                      case 'nw':
                        return `${isFlippedY ? 's' : 'n'}${isFlippedX ? 'e' : 'w'}`;
                      case 'ne':
                        return `${isFlippedY ? 's' : 'n'}${isFlippedX ? 'w' : 'e'}`;
                      case 'sw':
                        return `${isFlippedY ? 'n' : 's'}${isFlippedX ? 'e' : 'w'}`;
                      case 'se':
                        return `${isFlippedY ? 'n' : 's'}${isFlippedX ? 'w' : 'e'}`;
                      default:
                        return handle;
                    }
                  };

                  return (
                    <>
                      {/* Corner handles - always shown */}
                      <div
                        className='absolute -top-1.5 -left-1.5 w-3 h-3 bg-orange-500 rounded-full transform -translate-x-1/2 -translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                        style={{ cursor: getCursor('nw') }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleResizeStart(e, getHandle('nw') as any);
                        }}
                      />
                      <div
                        className='absolute -top-1.5 -right-1.5 w-3 h-3 bg-orange-500 rounded-full transform translate-x-1/2 -translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                        style={{ cursor: getCursor('ne') }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleResizeStart(e, getHandle('ne') as any);
                        }}
                      />
                      <div
                        className='absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-orange-500 rounded-full transform -translate-x-1/2 translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                        style={{ cursor: getCursor('sw') }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleResizeStart(e, getHandle('sw') as any);
                        }}
                      />
                      <div
                        className='absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-orange-500 rounded-full transform translate-x-1/2 translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                        style={{ cursor: getCursor('se') }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleResizeStart(e, getHandle('se') as any);
                        }}
                      />
                    </>
                  );
                })()}
              </>
            )}
          </div>
        );
      }

      case 'text': {
        const isEditing = editingTextId === layer.id;
        return (
          <div
            key={layer.id}
            {...commonProps}
            onDoubleClick={(e) => handleTextDoubleClick(e, layer)}
            className={cn(
              commonProps.className,
              'flex items-center justify-center overflow-visible',
              layer.style.wordWrap === 'break-word' &&
                'whitespace-normal break-words',
              layer.style.wordWrap === 'normal' && 'whitespace-nowrap',
              isEditing && 'cursor-text'
            )}
            style={{
              ...commonProps.style,
              pointerEvents: isEditing ? 'none' : 'auto',
            }}
          >
            {isEditing ? (
              <>
                {/* Editable text container */}
                <div
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(e) => handleContentEditableChange(e, layer)}
                  onBlur={handleTextBlur}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  ref={(el) => {
                    if (el && isEditing) {
                      el.focus();
                      // Place cursor at end of text
                      const range = document.createRange();
                      const sel = window.getSelection();
                      range.selectNodeContents(el);
                      range.collapse(false);
                      sel?.removeAllRanges();
                      sel?.addRange(range);
                    }
                  }}
                  className='w-full h-full bg-transparent outline-none'
                  style={
                    {
                      fontFamily: layer.style.fontFamily,
                      fontSize: layer.style.fontSize,
                      fontWeight: layer.style.fontWeight,
                      color: layer.style.color,
                      backgroundColor:
                        layer.style.backgroundColor || 'transparent',
                      textAlign: layer.style.textAlign,
                      fontStyle: layer.style.italic ? 'italic' : 'normal',
                      textDecoration: layer.style.underline
                        ? 'underline'
                        : 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems:
                        layer.style.textAlign === 'left'
                          ? 'flex-start'
                          : layer.style.textAlign === 'right'
                            ? 'flex-end'
                            : 'center',
                      justifyContent:
                        layer.style.verticalAlign === 'top'
                          ? 'flex-start'
                          : layer.style.verticalAlign === 'bottom'
                            ? 'flex-end'
                            : 'center',
                      whiteSpace:
                        layer.style.wordWrap === 'break-word'
                          ? 'pre-wrap'
                          : 'pre',
                      overflow: 'hidden',
                      width: '100%',
                      height: '100%',
                      userSelect: 'text',
                      cursor: 'text',
                      wordBreak:
                        layer.style.wordWrap === 'break-word'
                          ? 'break-word'
                          : 'normal',
                      wordWrap: layer.style.wordWrap,
                      pointerEvents: 'auto',
                      '--text-stroke-width': layer.style.stroke?.enabled
                        ? `${layer.style.stroke.width}px`
                        : '0',
                      '--text-stroke-color': layer.style.stroke?.enabled
                        ? layer.style.stroke.color
                        : 'transparent',
                      WebkitTextStrokeWidth: 'var(--text-stroke-width)',
                      WebkitTextStrokeColor: 'var(--text-stroke-color)',
                    } as React.CSSProperties
                  }
                >
                  {layer.content}
                </div>
              </>
            ) : (
              // Non-editing view
              <div
                className='w-full h-full'
                onClick={(e) => handleLayerClick(e, layer.id)}
                onMouseDown={(e) => handleMouseDown(e, layer)}
                style={
                  {
                    fontFamily: layer.style.fontFamily,
                    fontSize: layer.style.fontSize,
                    fontWeight: layer.style.fontWeight,
                    color: layer.style.color,
                    backgroundColor:
                      layer.style.backgroundColor || 'transparent',
                    textAlign: layer.style.textAlign,
                    fontStyle: layer.style.italic ? 'italic' : 'normal',
                    textDecoration: layer.style.underline
                      ? 'underline'
                      : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems:
                      layer.style.textAlign === 'left'
                        ? 'flex-start'
                        : layer.style.textAlign === 'right'
                          ? 'flex-end'
                          : 'center',
                    justifyContent:
                      layer.style.verticalAlign === 'top'
                        ? 'flex-start'
                        : layer.style.verticalAlign === 'bottom'
                          ? 'flex-end'
                          : 'center',
                    whiteSpace:
                      layer.style.wordWrap === 'break-word'
                        ? 'pre-wrap'
                        : 'pre',
                    wordBreak:
                      layer.style.wordWrap === 'break-word'
                        ? 'break-word'
                        : 'normal',
                    wordWrap: layer.style.wordWrap,
                    '--text-stroke-width': layer.style.stroke?.enabled
                      ? `${layer.style.stroke.width}px`
                      : '0',
                    '--text-stroke-color': layer.style.stroke?.enabled
                      ? layer.style.stroke.color
                      : 'transparent',
                    WebkitTextStrokeWidth: 'var(--text-stroke-width)',
                    WebkitTextStrokeColor: 'var(--text-stroke-color)',
                    userSelect: 'none',
                    pointerEvents: 'auto',
                    overflow: 'hidden',
                  } as React.CSSProperties
                }
              >
                <div className='w-full'>{layer.content}</div>
              </div>
            )}

            {/* Selection border */}
            {selectedLayerId === layer.id && (
              <>
                <div className='absolute -inset-[4px] z-selection pointer-events-none overflow-visible'>
                  <div className='absolute inset-0 rainbow-border' />
                </div>
                {/* Resize handles */}
                {(() => {
                  const isFlippedX = (layer.transform.scaleX ?? 1) < 0;
                  const isFlippedY = (layer.transform.scaleY ?? 1) < 0;

                  // Adjust cursor directions based on flip state
                  const getCursor = (handle: string) => {
                    switch (handle) {
                      case 'nw':
                        return `${isFlippedY ? 's' : 'n'}${isFlippedX ? 'e' : 'w'}-resize`;
                      case 'ne':
                        return `${isFlippedY ? 's' : 'n'}${isFlippedX ? 'w' : 'e'}-resize`;
                      case 'sw':
                        return `${isFlippedY ? 'n' : 's'}${isFlippedX ? 'e' : 'w'}-resize`;
                      case 'se':
                        return `${isFlippedY ? 'n' : 's'}${isFlippedX ? 'w' : 'e'}-resize`;
                      case 'n':
                        return `${isFlippedY ? 's' : 'n'}-resize`;
                      case 's':
                        return `${isFlippedY ? 'n' : 's'}-resize`;
                      case 'e':
                        return `${isFlippedX ? 'w' : 'e'}-resize`;
                      case 'w':
                        return `${isFlippedX ? 'e' : 'w'}-resize`;
                      default:
                        return 'move';
                    }
                  };

                  // Adjust handle type based on flip state
                  const getHandle = (handle: string) => {
                    switch (handle) {
                      case 'nw':
                        return `${isFlippedY ? 's' : 'n'}${isFlippedX ? 'e' : 'w'}`;
                      case 'ne':
                        return `${isFlippedY ? 's' : 'n'}${isFlippedX ? 'w' : 'e'}`;
                      case 'sw':
                        return `${isFlippedY ? 'n' : 's'}${isFlippedX ? 'e' : 'w'}`;
                      case 'se':
                        return `${isFlippedY ? 'n' : 's'}${isFlippedX ? 'w' : 'e'}`;
                      default:
                        return handle;
                    }
                  };

                  return (
                    <>
                      {/* Corner handles - always shown */}
                      <div
                        className='absolute -top-1.5 -left-1.5 w-3 h-3 bg-orange-500 rounded-full transform -translate-x-1/2 -translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                        style={{ cursor: getCursor('nw') }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleResizeStart(e, getHandle('nw') as any);
                        }}
                      />
                      <div
                        className='absolute -top-1.5 -right-1.5 w-3 h-3 bg-orange-500 rounded-full transform translate-x-1/2 -translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                        style={{ cursor: getCursor('ne') }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleResizeStart(e, getHandle('ne') as any);
                        }}
                      />
                      <div
                        className='absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-orange-500 rounded-full transform -translate-x-1/2 translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                        style={{ cursor: getCursor('sw') }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleResizeStart(e, getHandle('sw') as any);
                        }}
                      />
                      <div
                        className='absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-orange-500 rounded-full transform translate-x-1/2 translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                        style={{ cursor: getCursor('se') }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleResizeStart(e, getHandle('se') as any);
                        }}
                      />

                      {/* Edge handles - only shown for text layers */}
                      {layer.type === 'text' && (
                        <>
                          <div
                            className='absolute top-1/2 -left-1.5 w-3 h-3 bg-orange-500 rounded-full transform -translate-x-1/2 -translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                            style={{ cursor: getCursor('w') }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              handleResizeStart(e, getHandle('w') as any);
                            }}
                          />
                          <div
                            className='absolute top-1/2 -right-1.5 w-3 h-3 bg-orange-500 rounded-full transform translate-x-1/2 -translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                            style={{ cursor: getCursor('e') }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              handleResizeStart(e, getHandle('e') as any);
                            }}
                          />
                          <div
                            className='absolute -top-1.5 left-1/2 w-3 h-3 bg-orange-500 rounded-full transform -translate-x-1/2 -translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                            style={{ cursor: getCursor('n') }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              handleResizeStart(e, getHandle('n') as any);
                            }}
                          />
                          <div
                            className='absolute -bottom-1.5 left-1/2 w-3 h-3 bg-orange-500 rounded-full transform -translate-x-1/2 translate-y-1/2 ring-2 ring-background shadow-md z-selection'
                            style={{ cursor: getCursor('s') }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              handleResizeStart(e, getHandle('s') as any);
                            }}
                          />
                        </>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </div>
        );
      }
    }
  };

  // Sort layers for rendering
  const sortedLayers = layerData
    .sort((a, b) => compareLayersForRender(a, b, layers))
    .map((layer) => ({
      ...layer,
      zIndex: (layers.find((l) => l.id === layer.id)?.index ?? 0) * 10,
    }));

  // Handle wheel events for trackpad gestures
  const handleWheel = (e: WheelEvent) => {
    // Check if it's a pinch gesture (ctrl/cmd + wheel)
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const delta = -e.deltaY * 0.001; // Adjust sensitivity
      handleZoom(delta);
    } else if (e.shiftKey) {
      // Horizontal scroll with shift
      e.preventDefault();
      setViewportOffset((prev) => ({
        x: prev.x - e.deltaY,
        y: prev.y,
      }));
    } else {
      // Normal scroll
      e.preventDefault();
      setViewportOffset((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  };

  // Add wheel event listener
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    workspace.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      workspace.removeEventListener('wheel', handleWheel);
    };
  }, [zoom, canvasRef.current]);

  // Handle panning
  const handlePanStart = (e: React.MouseEvent) => {
    // Middle mouse button or if pan tool is active
    if (e.button !== 1 && !isPanning) return;
    e.preventDefault();
    setIsPanning(true);
    setPanStart({
      x: e.clientX - viewportOffset.x,
      y: e.clientY - viewportOffset.y,
    });
  };

  const handlePanMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    const newX = e.clientX - panStart.x;
    const newY = e.clientY - panStart.y;

    // Add bounds to prevent panning too far
    const workspace = workspaceRef.current;
    const canvas = canvasRef.current;
    if (!workspace || !canvas) return;

    const workspaceRect = workspace.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    // Calculate bounds with some padding
    const padding = 100;
    const minX = workspaceRect.width - canvasRect.width * zoom - padding;
    const minY = workspaceRect.height - canvasRect.height * zoom - padding;
    const maxX = padding;
    const maxY = padding;

    setViewportOffset({
      x: Math.min(maxX, Math.max(minX, newX)),
      y: Math.min(maxY, Math.max(minY, newY)),
    });
  };

  const handlePanEnd = () => {
    setIsPanning(false);
  };

  const handleResizeMove = (e: MouseEvent | React.MouseEvent) => {
    if (!isResizing || !resizeHandle || !selectedLayerId) return;

    const layer = layerData.find((l) => l.id === selectedLayerId);
    if (!layer) return;

    const deltaX = (e.clientX - resizeStart.x) / zoom;
    const deltaY = (e.clientY - resizeStart.y) / zoom;
    let newWidth = resizeStart.width;
    let newHeight = resizeStart.height;
    let newX = layer.transform.x;
    let newY = layer.transform.y;

    // Get current scale factors (including flips)
    const currentScaleX = layer.transform.scaleX ?? 1;
    const currentScaleY = layer.transform.scaleY ?? 1;
    const isFlippedX = currentScaleX < 0;
    const isFlippedY = currentScaleY < 0;

    // Always maintain aspect ratio for image and sticker layers
    const shouldMaintainAspectRatio =
      layer.type === 'image' ||
      layer.type === 'sticker' ||
      (e instanceof MouseEvent && e.shiftKey);
    const aspectRatio = resizeStart.width / resizeStart.height;

    // Adjust delta based on flipped state
    const adjustedDeltaX = isFlippedX ? -deltaX : deltaX;
    const adjustedDeltaY = isFlippedY ? -deltaY : deltaY;

    // Handle different resize directions, accounting for flipped states
    if (resizeHandle.includes('e')) {
      const delta = isFlippedX ? -adjustedDeltaX : adjustedDeltaX;
      newWidth = Math.max(50, resizeStart.width + delta);
      if (shouldMaintainAspectRatio) {
        newHeight = newWidth / aspectRatio;
      }
    }
    if (resizeHandle.includes('w')) {
      const delta = isFlippedX ? -adjustedDeltaX : adjustedDeltaX;
      const width = Math.max(50, resizeStart.width - delta);
      if (shouldMaintainAspectRatio) {
        const heightDiff = width / aspectRatio - resizeStart.height;
        newWidth = width;
        newHeight = width / aspectRatio;
        newX = layer.transform.x + (resizeStart.width - width);
        newY = layer.transform.y - heightDiff / 2;
      } else {
        newWidth = width;
        newX = layer.transform.x + (resizeStart.width - width);
      }
    }
    if (resizeHandle.includes('s')) {
      const delta = isFlippedY ? -adjustedDeltaY : adjustedDeltaY;
      newHeight = Math.max(50, resizeStart.height + delta);
      if (shouldMaintainAspectRatio) {
        newWidth = newHeight * aspectRatio;
      }
    }
    if (resizeHandle.includes('n')) {
      const delta = isFlippedY ? -adjustedDeltaY : adjustedDeltaY;
      const height = Math.max(50, resizeStart.height - delta);
      if (shouldMaintainAspectRatio) {
        const widthDiff = height * aspectRatio - resizeStart.width;
        newHeight = height;
        newWidth = height * aspectRatio;
        newY = layer.transform.y + (resizeStart.height - height);
        newX = layer.transform.x - widthDiff / 2;
      } else {
        newHeight = height;
        newY = layer.transform.y + (resizeStart.height - height);
      }
    }

    // For corner handles
    if (resizeHandle.length === 2) {
      if (shouldMaintainAspectRatio) {
        // Calculate the cursor's movement direction and magnitude
        const dx = resizeHandle.includes('w') ? -deltaX : deltaX;
        const dy = resizeHandle.includes('n') ? -deltaY : deltaY;

        // Project the movement onto the diagonal of the original shape
        const diagonalLength = Math.sqrt(
          resizeStart.width * resizeStart.width +
            resizeStart.height * resizeStart.height
        );
        const movementProjection =
          (dx * resizeStart.width + dy * resizeStart.height) / diagonalLength;

        // Calculate scale based on the projected movement
        const scale = 1 + movementProjection / diagonalLength;

        // Apply the scale while maintaining aspect ratio
        newWidth = Math.max(50, resizeStart.width * scale);
        newHeight = Math.max(50, (resizeStart.width * scale) / aspectRatio);

        // Adjust position based on which corner is being dragged
        if (resizeHandle.includes('w')) {
          newX = layer.transform.x + (resizeStart.width - newWidth);
        }
        if (resizeHandle.includes('n')) {
          newY = layer.transform.y + (resizeStart.height - newHeight);
        }
      }
    }

    // Update layer with new dimensions
    setLayerData((prev) =>
      prev.map((l) =>
        l.id === selectedLayerId
          ? {
              ...l,
              transform: {
                ...l.transform,
                x: newX,
                y: newY,
                width: newWidth,
                height: newHeight,
              },
            }
          : l
      )
    );
  };

  const handleResizeEnd = () => {
    if (isResizing && selectedLayerId) {
      const layer = layerData.find((l) => l.id === selectedLayerId);
      if (layer) {
        onLayerUpdate(layer);
      }
    }
    setIsResizing(false);
    setResizeHandle(null);
  };

  // Add resize event listeners
  useEffect(() => {
    if (!isResizing) return;

    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);

    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [isResizing, resizeHandle, resizeStart, selectedLayerId, zoom]);

  // Handle canvas resize
  const handleCanvasResizeStart = (
    e: React.MouseEvent<HTMLDivElement>,
    handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  ) => {
    e.stopPropagation();
    e.preventDefault();

    setIsCanvasResizing(true);
    setCanvasResizeHandle(handle);
    setCanvasResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: canvasSize.width,
      height: canvasSize.height,
    });
  };

  const handleCanvasResizeMove = (e: MouseEvent | React.MouseEvent) => {
    if (!isCanvasResizing || !canvasResizeHandle) return;

    const deltaX = (e.clientX - canvasResizeStart.x) / zoom;
    const deltaY = (e.clientY - canvasResizeStart.y) / zoom;
    let newWidth = canvasResizeStart.width;
    let newHeight = canvasResizeStart.height;
    let newX = viewportOffset.x;
    let newY = viewportOffset.y;

    const MIN_SIZE = 320;
    const MAX_SIZE = 4096;

    // Handle different resize directions
    if (canvasResizeHandle.includes('e')) {
      newWidth = Math.min(
        MAX_SIZE,
        Math.max(MIN_SIZE, canvasResizeStart.width + deltaX)
      );
    } else if (canvasResizeHandle.includes('w')) {
      const widthDelta = deltaX;
      newWidth = Math.min(
        MAX_SIZE,
        Math.max(MIN_SIZE, canvasResizeStart.width - widthDelta)
      );
      if (newWidth !== canvasResizeStart.width) {
        newX = viewportOffset.x + (canvasResizeStart.width - newWidth) * zoom;
      }
    }

    if (canvasResizeHandle.includes('s')) {
      newHeight = Math.min(
        MAX_SIZE,
        Math.max(MIN_SIZE, canvasResizeStart.height + deltaY)
      );
    } else if (canvasResizeHandle.includes('n')) {
      const heightDelta = deltaY;
      newHeight = Math.min(
        MAX_SIZE,
        Math.max(MIN_SIZE, canvasResizeStart.height - heightDelta)
      );
      if (newHeight !== canvasResizeStart.height) {
        newY = viewportOffset.y + (canvasResizeStart.height - newHeight) * zoom;
      }
    }

    // For corner handles, maintain aspect ratio if shift is held
    if (
      canvasResizeHandle.length === 2 &&
      e instanceof MouseEvent &&
      e.shiftKey
    ) {
      const aspectRatio = canvasResizeStart.width / canvasResizeStart.height;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        newHeight = newWidth / aspectRatio;
      } else {
        newWidth = newHeight * aspectRatio;
      }
    }

    // Ensure dimensions stay within bounds
    newWidth = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, newWidth)));
    newHeight = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, newHeight)));

    // Update canvas size without affecting zoom or centering
    setCanvasSize({
      width: newWidth,
      height: newHeight,
    });

    // Update viewport offset only if necessary (when resizing from left or top)
    if (canvasResizeHandle.includes('w') || canvasResizeHandle.includes('n')) {
      setViewportOffset({
        x: newX,
        y: newY,
      });
    }
  };

  const handleCanvasResizeEnd = async () => {
    if (isCanvasResizing) {
      try {
        // Round the dimensions to whole numbers
        const width = Math.round(canvasSize.width);
        const height = Math.round(canvasSize.height);

        // Update the database directly
        await updateCanvasSettings(projectId, {
          width,
          height,
        });

        // Update local state with rounded values
        setCanvasSize({
          width,
          height,
        });

        console.log('Canvas size updated:', { width, height });
      } catch (error) {
        console.error('Failed to update canvas settings:', error);
        toast.error('Failed to save canvas size');
      }
    }
    setIsCanvasResizing(false);
    setCanvasResizeHandle(null);
  };

  // Add canvas resize event listeners
  useEffect(() => {
    if (!isCanvasResizing) return;

    const handleMouseMove = (e: MouseEvent) => handleCanvasResizeMove(e);
    const handleMouseUp = () => handleCanvasResizeEnd();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isCanvasResizing, canvasResizeHandle, canvasResizeStart, zoom]);

  // Add keyboard shortcuts for zooming
  useEffect(() => {
    const handleKeyboardShortcuts = (e: KeyboardEvent) => {
      // Check if Command (Mac) or Control (Windows/Linux) is pressed
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case '=': // Plus key (with or without shift)
          case '+':
            e.preventDefault();
            handleZoom(0.1);
            break;
          case '-': // Minus key
          case '_':
            e.preventDefault();
            handleZoom(-0.1);
            break;
          case '0': // Reset zoom and center
            e.preventDefault();
            centerAndFitCanvas();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [zoom]);

  // Add this effect after the other useEffects
  useEffect(() => {
    const loadLayers = async () => {
      try {
        const layers = await getProjectLayers(projectId);
        setLayerData(layers);
      } catch (error) {
        console.error('Failed to load layers:', error);
        toast.error('Failed to load layers');
      }
    };

    loadLayers();
  }, [projectId, canvasSettingsVersion, layers]); // Add layers as a dependency

  return (
    <div className={cn('relative overflow-hidden bg-neutral-900', className)}>
      {/* Infinite scrollable workspace */}
      <div
        ref={workspaceRef}
        className='absolute inset-0 overflow-auto'
        onMouseDown={(e) => {
          // Close toolbars when clicking anywhere in workspace, except on layers, toolbars, or image controls
          const target = e.target as HTMLElement;
          if (
            !target.closest('.layer') &&
            !target.closest('.toolbar') &&
            !target.closest('.image-toolbar') &&
            !target.closest('[data-ignore-blur]')
          ) {
            onLayerSelect(null);
            setEditingTextId(null);
            setIsEraserMode(false);
            setEraserPath([]);
          }

          if (!isResizing && !isDragging && !isCanvasResizing) {
            handlePanStart(e);
          }
        }}
        onMouseMove={(e) => {
          if (isResizing) {
            handleResizeMove(e);
          } else if (isCanvasResizing) {
            handleCanvasResizeMove(e);
          } else if (isPanning) {
            handlePanMove(e);
          }
        }}
        onMouseUp={() => {
          handlePanEnd();
          handleResizeEnd();
          handleCanvasResizeEnd();
        }}
        onMouseLeave={() => {
          handlePanEnd();
          handleResizeEnd();
          handleCanvasResizeEnd();
        }}
      >
        <div
          className='relative'
          style={{
            width: `${Math.round(workspaceRef.current?.clientWidth || 0)}px`,
            height: `${Math.round(workspaceRef.current?.clientHeight || 0)}px`,
          }}
        >
          {/* Canvas container */}
          <div
            className='absolute'
            style={{
              left: `${Math.round(viewportOffset.x)}px`,
              top: `${Math.round(viewportOffset.y)}px`,
              width: `${Math.round(canvasSize.width * zoom)}px`,
              height: `${Math.round(canvasSize.height * zoom)}px`,
            }}
          >
            {/* Official canvas area */}
            <div
              ref={canvasRef}
              className='absolute bg-background shadow-2xl rounded-lg'
              style={{
                width: `${Math.round(canvasSize.width)}px`,
                height: `${Math.round(canvasSize.height)}px`,
                transform: `scale(${Number(zoom.toFixed(3))})`,
                transformOrigin: '0 0',
                ...(canvasBackground.type === 'color' && {
                  backgroundColor: canvasBackground.color,
                }),
                ...(canvasBackground.type === 'image' &&
                  canvasBackground.imageSize && {
                    backgroundImage: `url(${canvasBackground.imageUrl})`,
                    backgroundSize: (() => {
                      const scaled = calculateScaledDimensions(
                        canvasBackground.imageSize.width,
                        canvasBackground.imageSize.height,
                        canvasSize.width,
                        canvasSize.height
                      );
                      return `${Math.round(scaled.width)}px ${Math.round(scaled.height)}px`;
                    })(),
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    willChange: 'transform',
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                  }),
              }}
            >
              {/* Canvas grid background */}
              <div
                className={cn(
                  'absolute inset-0 pointer-events-none opacity-5',
                  canvasBackground.type === 'image' && 'mix-blend-difference'
                )}
                style={{
                  backgroundImage: `
                    linear-gradient(to right, gray 1px, transparent 1px),
                    linear-gradient(to bottom, gray 1px, transparent 1px)
                  `,
                  backgroundSize: '20px 20px',
                  overflow: 'clip',
                }}
              />

              {/* Container for layers that allows overflow */}
              <div className='absolute inset-0' style={{ overflow: 'visible' }}>
                {/* Render layers */}
                {sortedLayers.map((layer) => renderLayer(layer))}
              </div>

              {/* Eraser path overlay */}
              {isEraserMode && eraserPath.length > 0 && (
                <svg className='absolute inset-0 pointer-events-none'>
                  <path
                    d={`M ${eraserPath[0][0]} ${eraserPath[0][1]} ${eraserPath
                      .slice(1)
                      .map(([x, y]) => `L ${x} ${y}`)
                      .join(' ')}`}
                    stroke='black'
                    strokeWidth='2'
                    fill='none'
                  />
                </svg>
              )}

              {/* High z-index canvas boundary indicator */}
              <div
                className='absolute inset-0 pointer-events-none border-2 border-primary'
                style={{
                  zIndex: 9998,
                  boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.1)',
                }}
              />
            </div>

            {/* Canvas resize handles */}
            {showCanvasResizeHandles && (
              <div
                className='absolute inset-0 pointer-events-none'
                style={{ zIndex: 20 }}
              >
                {/* Corner handles */}
                <div
                  className='absolute -top-1.5 -left-1.5 w-3 h-3 bg-primary rounded-full cursor-nw-resize pointer-events-auto ring-2 ring-background'
                  onMouseDown={(e) => handleCanvasResizeStart(e, 'nw')}
                />
                <div
                  className='absolute -top-1.5 -right-1.5 w-3 h-3 bg-primary rounded-full cursor-ne-resize pointer-events-auto ring-2 ring-background'
                  onMouseDown={(e) => handleCanvasResizeStart(e, 'ne')}
                />
                <div
                  className='absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-primary rounded-full cursor-sw-resize pointer-events-auto ring-2 ring-background'
                  onMouseDown={(e) => handleCanvasResizeStart(e, 'sw')}
                />
                <div
                  className='absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-primary rounded-full cursor-se-resize pointer-events-auto ring-2 ring-background'
                  onMouseDown={(e) => handleCanvasResizeStart(e, 'se')}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Zoom controls */}
      <div className='absolute bottom-4 right-4 flex flex-col gap-2'>
        <Button
          variant='secondary'
          size='icon'
          onClick={() => handleZoom(0.1)}
          className='rounded-full bg-background/80 backdrop-blur-sm shadow-lg hover:bg-accent'
        >
          <ZoomIn className='h-4 w-4' />
        </Button>
        <Button
          variant='secondary'
          size='icon'
          onClick={() => handleZoom(-0.1)}
          className='rounded-full bg-background/80 backdrop-blur-sm shadow-lg hover:bg-accent'
        >
          <ZoomOut className='h-4 w-4' />
        </Button>
        <Button
          variant='secondary'
          size='icon'
          onClick={() => {
            centerAndFitCanvas();
            if (isPanning) {
              setIsPanning(false);
            }
          }}
          className={cn(
            'rounded-full bg-background/80 backdrop-blur-sm shadow-lg hover:bg-accent',
            isPanning && 'bg-accent text-accent-foreground'
          )}
          title='Center Canvas (Ctrl/Cmd + 0)'
        >
          <Move className='h-4 w-4' />
        </Button>
      </div>

      {/* Canvas dimensions display */}
      <div className='absolute bottom-4 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-background/80 backdrop-blur-sm text-xs text-muted-foreground'>
        {canvasSize.width} × {canvasSize.height}
      </div>
    </div>
  );
}
