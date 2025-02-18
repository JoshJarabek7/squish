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
import { LayerContextMenu } from '@/components/layer-context-menu';

interface CanvasProps {
  projectId: string;
  layers: Array<{ id: string; index: number }>;
  selectedLayerId: string | null;
  onLayerSelect: (id: string | null) => void;
  onLayerUpdate: (layer: Layer, originalLayer?: Layer) => Promise<void>;
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
  gridSettings: {
    enabled: boolean;
    columns: number;
    rows: number;
    showFractions: boolean;
  };
}

interface AssetCache {
  [key: string]: {
    url: string;
    loading: boolean;
    error: boolean;
  };
}

interface AlignmentGuide {
  position: number;
  type: 'horizontal' | 'vertical';
  layerId?: string;
  guideType: 'edge' | 'center' | 'size' | 'grid' | 'fraction' | 'background';
}

export function Canvas({
  projectId,
  layers,
  selectedLayerId,
  onLayerSelect,
  onLayerUpdate,
  onLayerReorder,
  onLayerDelete,
  onLayerDuplicate,
  showCanvasResizeHandles = true,
  className,
  onAssetDataChange,
  canvasSettingsVersion = 0,
  canvasBackground,
  onBackgroundChange,
  zoom: externalZoom,
  onZoomChange,
  gridSettings,
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
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const SNAP_THRESHOLD = 5; // Pixels within which to snap
  const [isRotating, setIsRotating] = useState(false);
  const [rotationStart, setRotationStart] = useState({ x: 0, y: 0, angle: 0 });

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
    if (e.button !== 0) return; // Only handle left click
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

      let newX = mouseX - dragStart.x;
      let newY = mouseY - dragStart.y;

      // Calculate potential guides for the current layer
      const guides = calculateAlignmentGuides(
        {
          ...dragLayer,
          transform: { ...dragLayer.transform, x: newX, y: newY },
        },
        dragLayer.id
      );

      // Find closest guides
      const leftGuide = findClosestGuide(newX, guides, 'vertical');
      const rightGuide = findClosestGuide(
        newX + dragLayer.transform.width,
        guides,
        'vertical'
      );
      const centerXGuide = findClosestGuide(
        newX + dragLayer.transform.width / 2,
        guides,
        'vertical'
      );
      const topGuide = findClosestGuide(newY, guides, 'horizontal');
      const bottomGuide = findClosestGuide(
        newY + dragLayer.transform.height,
        guides,
        'horizontal'
      );
      const centerYGuide = findClosestGuide(
        newY + dragLayer.transform.height / 2,
        guides,
        'horizontal'
      );

      // Apply snapping
      if (leftGuide) {
        newX = leftGuide.guide.position;
      } else if (rightGuide) {
        newX = rightGuide.guide.position - dragLayer.transform.width;
      } else if (centerXGuide) {
        newX = centerXGuide.guide.position - dragLayer.transform.width / 2;
      }

      if (topGuide) {
        newY = topGuide.guide.position;
      } else if (bottomGuide) {
        newY = bottomGuide.guide.position - dragLayer.transform.height;
      } else if (centerYGuide) {
        newY = centerYGuide.guide.position - dragLayer.transform.height / 2;
      }

      // Update alignment guides
      setAlignmentGuides(
        [
          leftGuide?.guide,
          rightGuide?.guide,
          centerXGuide?.guide,
          topGuide?.guide,
          bottomGuide?.guide,
          centerYGuide?.guide,
        ].filter((guide): guide is AlignmentGuide => guide !== undefined)
      );

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
        // Store the original state before the drag
        const originalLayer = { ...dragLayer }; // Create a deep copy of the original state

        // Create updated layer with new position
        const updatedLayer = {
          ...layer,
          transform: {
            ...layer.transform,
          },
        };

        // Only update if the position actually changed
        if (
          originalLayer.transform.x !== updatedLayer.transform.x ||
          originalLayer.transform.y !== updatedLayer.transform.y
        ) {
          // Just update directly, let the DatabaseQueue handle serialization
          void onLayerUpdate(updatedLayer, originalLayer);
        }
      }

      setIsDragging(false);
      setDragLayer(null);
      setAlignmentGuides([]); // Clear guides when done dragging
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragLayer, dragStart, zoom, layerData]);

  // Handle keyboard controls for selected layer
  useEffect(() => {
    if (!selectedLayerId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const layer = layerData.find((l) => l.id === selectedLayerId);
      if (!layer) return;

      // Don't handle delete if we're editing text
      if (editingTextId === layer.id) return;

      // Handle delete key
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        void onLayerDelete(layer.id);
        return;
      }

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
  }, [selectedLayerId, layerData, onLayerUpdate, editingTextId, onLayerDelete]);

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

  const handleResizeEnd = () => {
    if (isResizing && selectedLayerId) {
      const layer = layerData.find((l) => l.id === selectedLayerId);
      if (layer) {
        onLayerUpdate(layer);
      }
    }
    setIsResizing(false);
    setResizeHandle(null);
    setAlignmentGuides([]); // Clear guides when done resizing
  };

  // Calculate alignment guides for a layer
  const calculateAlignmentGuides = (
    activeLayer: Layer,
    skipLayerId?: string
  ): AlignmentGuide[] => {
    const guides: AlignmentGuide[] = [];
    const activeLeft = activeLayer.transform.x;
    const activeRight = activeLayer.transform.x + activeLayer.transform.width;
    const activeTop = activeLayer.transform.y;
    const activeBottom = activeLayer.transform.y + activeLayer.transform.height;
    const activeCenterX = activeLeft + activeLayer.transform.width / 2;
    const activeCenterY = activeTop + activeLayer.transform.height / 2;
    const activeWidth = activeLayer.transform.width;
    const activeHeight = activeLayer.transform.height;

    // Add canvas edge guides
    guides.push(
      { position: 0, type: 'vertical', guideType: 'edge' }, // Left edge
      { position: canvasSize.width, type: 'vertical', guideType: 'edge' }, // Right edge
      { position: 0, type: 'horizontal', guideType: 'edge' }, // Top edge
      { position: canvasSize.height, type: 'horizontal', guideType: 'edge' } // Bottom edge
    );

    // Add canvas center guides
    guides.push(
      { position: canvasSize.width / 2, type: 'vertical', guideType: 'center' },
      {
        position: canvasSize.height / 2,
        type: 'horizontal',
        guideType: 'center',
      }
    );

    // Add grid guides if enabled
    if (gridSettings.enabled) {
      // Column guides
      const columnWidth = canvasSize.width / gridSettings.columns;
      for (let i = 1; i < gridSettings.columns; i++) {
        guides.push({
          position: columnWidth * i,
          type: 'vertical',
          guideType: 'grid',
        });
      }

      // Row guides
      const rowHeight = canvasSize.height / gridSettings.rows;
      for (let i = 1; i < gridSettings.rows; i++) {
        guides.push({
          position: rowHeight * i,
          type: 'horizontal',
          guideType: 'grid',
        });
      }

      // Add fractional guides if enabled
      if (gridSettings.showFractions) {
        // Add thirds
        [1 / 3, 2 / 3].forEach((fraction) => {
          guides.push(
            {
              position: canvasSize.width * fraction,
              type: 'vertical',
              guideType: 'fraction',
            },
            {
              position: canvasSize.height * fraction,
              type: 'horizontal',
              guideType: 'fraction',
            }
          );
        });

        // Add quarters
        [1 / 4, 3 / 4].forEach((fraction) => {
          guides.push(
            {
              position: canvasSize.width * fraction,
              type: 'vertical',
              guideType: 'fraction',
            },
            {
              position: canvasSize.height * fraction,
              type: 'horizontal',
              guideType: 'fraction',
            }
          );
        });
      }
    }

    // Compare with background image if present
    if (canvasBackground.type === 'image' && canvasBackground.imageSize) {
      const scaled = calculateScaledDimensions(
        canvasBackground.imageSize.width,
        canvasBackground.imageSize.height,
        canvasSize.width,
        canvasSize.height
      );

      // Add background image edges
      guides.push(
        { position: scaled.x, type: 'vertical', guideType: 'background' },
        {
          position: scaled.x + scaled.width,
          type: 'vertical',
          guideType: 'background',
        },
        { position: scaled.y, type: 'horizontal', guideType: 'background' },
        {
          position: scaled.y + scaled.height,
          type: 'horizontal',
          guideType: 'background',
        }
      );

      // Add background image center
      guides.push(
        {
          position: scaled.x + scaled.width / 2,
          type: 'vertical',
          guideType: 'background',
        },
        {
          position: scaled.y + scaled.height / 2,
          type: 'horizontal',
          guideType: 'background',
        }
      );
    }

    // Compare with other layers
    layerData.forEach((otherLayer) => {
      if (otherLayer.id === skipLayerId) return;

      const left = otherLayer.transform.x;
      const right = otherLayer.transform.x + otherLayer.transform.width;
      const top = otherLayer.transform.y;
      const bottom = otherLayer.transform.y + otherLayer.transform.height;
      const centerX = left + otherLayer.transform.width / 2;
      const centerY = top + otherLayer.transform.height / 2;
      const width = otherLayer.transform.width;
      const height = otherLayer.transform.height;

      // Add guides for aligning centers with other layer's edges
      if (Math.abs(activeCenterX - left) < SNAP_THRESHOLD) {
        guides.push({
          position: left,
          type: 'vertical',
          layerId: otherLayer.id,
          guideType: 'center',
        });
      }
      if (Math.abs(activeCenterX - right) < SNAP_THRESHOLD) {
        guides.push({
          position: right,
          type: 'vertical',
          layerId: otherLayer.id,
          guideType: 'center',
        });
      }
      if (Math.abs(activeCenterY - top) < SNAP_THRESHOLD) {
        guides.push({
          position: top,
          type: 'horizontal',
          layerId: otherLayer.id,
          guideType: 'center',
        });
      }
      if (Math.abs(activeCenterY - bottom) < SNAP_THRESHOLD) {
        guides.push({
          position: bottom,
          type: 'horizontal',
          layerId: otherLayer.id,
          guideType: 'center',
        });
      }

      // Add guides for aligning edges with other layer's centers
      if (Math.abs(activeLeft - centerX) < SNAP_THRESHOLD) {
        guides.push({
          position: centerX,
          type: 'vertical',
          layerId: otherLayer.id,
          guideType: 'center',
        });
      }
      if (Math.abs(activeRight - centerX) < SNAP_THRESHOLD) {
        guides.push({
          position: centerX,
          type: 'vertical',
          layerId: otherLayer.id,
          guideType: 'center',
        });
      }
      if (Math.abs(activeTop - centerY) < SNAP_THRESHOLD) {
        guides.push({
          position: centerY,
          type: 'horizontal',
          layerId: otherLayer.id,
          guideType: 'center',
        });
      }
      if (Math.abs(activeBottom - centerY) < SNAP_THRESHOLD) {
        guides.push({
          position: centerY,
          type: 'horizontal',
          layerId: otherLayer.id,
          guideType: 'center',
        });
      }

      // Add guides for aligning edges
      guides.push(
        {
          position: left,
          type: 'vertical',
          layerId: otherLayer.id,
          guideType: 'edge',
        },
        {
          position: right,
          type: 'vertical',
          layerId: otherLayer.id,
          guideType: 'edge',
        },
        {
          position: centerX,
          type: 'vertical',
          layerId: otherLayer.id,
          guideType: 'center',
        },
        {
          position: top,
          type: 'horizontal',
          layerId: otherLayer.id,
          guideType: 'edge',
        },
        {
          position: bottom,
          type: 'horizontal',
          layerId: otherLayer.id,
          guideType: 'edge',
        },
        {
          position: centerY,
          type: 'horizontal',
          layerId: otherLayer.id,
          guideType: 'center',
        }
      );

      // Size guides (only if within threshold)
      if (Math.abs(width - activeWidth) < SNAP_THRESHOLD) {
        guides.push({
          position: width,
          type: 'vertical',
          layerId: otherLayer.id,
          guideType: 'size',
        });
      }
      if (Math.abs(height - activeHeight) < SNAP_THRESHOLD) {
        guides.push({
          position: height,
          type: 'horizontal',
          layerId: otherLayer.id,
          guideType: 'size',
        });
      }
    });

    return guides;
  };

  // Find the closest guide within threshold
  const findClosestGuide = (
    value: number,
    guides: AlignmentGuide[],
    type: 'horizontal' | 'vertical'
  ): { guide: AlignmentGuide; distance: number } | null => {
    let closestGuide = null;
    let minDistance = SNAP_THRESHOLD;

    guides
      .filter((g) => g.type === type)
      .forEach((guide) => {
        const distance = Math.abs(guide.position - value);
        if (distance < minDistance) {
          minDistance = distance;
          closestGuide = guide;
        }
      });

    return closestGuide ? { guide: closestGuide, distance: minDistance } : null;
  };

  // Update the renderAlignmentGuides function to handle different guide types
  const renderAlignmentGuides = () => {
    return alignmentGuides.map((guide, index) => {
      const style = {
        position: 'absolute' as const,
        backgroundColor: (() => {
          switch (guide.guideType) {
            case 'size':
              return '#00ff00';
            case 'grid':
              return 'rgba(128, 128, 255, 0.5)';
            case 'fraction':
              return 'rgba(128, 128, 255, 0.3)';
            case 'background':
              return 'rgba(255, 128, 0, 0.5)';
            default:
              return '#ff0000';
          }
        })(),
        pointerEvents: 'none' as const,
        zIndex: 9999,
        ...(guide.type === 'vertical'
          ? {
              left: `${guide.position}px`,
              top: 0,
              width:
                guide.guideType === 'grid' || guide.guideType === 'fraction'
                  ? '0.5px'
                  : '1px',
              height: '100%',
            }
          : {
              top: `${guide.position}px`,
              left: 0,
              height:
                guide.guideType === 'grid' || guide.guideType === 'fraction'
                  ? '0.5px'
                  : '1px',
              width: '100%',
            }),
      };

      return <div key={`${guide.type}-${index}`} style={style} />;
    });
  };

  // Add this helper function for angle calculations
  const calculateAngle = (cx: number, cy: number, ex: number, ey: number) => {
    const dy = ey - cy;
    const dx = ex - cx;
    let theta = Math.atan2(dy, dx); // range (-PI, PI]
    theta *= 180 / Math.PI; // rads to degs, range (-180, 180]
    return theta;
  };

  // Add this helper function for angle snapping
  const snapAngle = (angle: number, snapInterval: number = 45) => {
    const snapped = Math.round(angle / snapInterval) * snapInterval;
    return snapped;
  };

  // Add rotation handle start logic
  const handleRotationStart = (e: React.MouseEvent, layer: Layer) => {
    if (layer.id !== selectedLayerId || isResizing || isPanning) return;
    e.stopPropagation();
    e.preventDefault();

    setIsRotating(true);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Calculate center of the layer
    const centerX =
      (layer.transform.x + layer.transform.width / 2) * zoom + rect.left;
    const centerY =
      (layer.transform.y + layer.transform.height / 2) * zoom + rect.top;

    // Calculate current angle
    const currentAngle = calculateAngle(centerX, centerY, e.clientX, e.clientY);

    setRotationStart({
      x: centerX,
      y: centerY,
      angle: currentAngle - (layer.transform.rotation || 0),
    });
  };

  // Add rotation move logic
  useEffect(() => {
    if (!isRotating || !selectedLayerId) return;

    const handleRotationMove = (e: MouseEvent) => {
      const layer = layerData.find((l) => l.id === selectedLayerId);
      if (!layer) return;

      // Calculate new angle
      const currentAngle = calculateAngle(
        rotationStart.x,
        rotationStart.y,
        e.clientX,
        e.clientY
      );

      let newRotation = currentAngle - rotationStart.angle;

      // Snap to angles when shift is held
      if (e.shiftKey) {
        newRotation = snapAngle(newRotation);
      }

      // Update layer with new rotation
      setLayerData((prev) =>
        prev.map((l) =>
          l.id === selectedLayerId
            ? {
                ...l,
                transform: {
                  ...l.transform,
                  rotation: newRotation,
                },
              }
            : l
        )
      );
    };

    const handleRotationEnd = () => {
      const layer = layerData.find((l) => l.id === selectedLayerId);
      if (layer) {
        onLayerUpdate(layer);
      }
      setIsRotating(false);
    };

    window.addEventListener('mousemove', handleRotationMove);
    window.addEventListener('mouseup', handleRotationEnd);

    return () => {
      window.removeEventListener('mousemove', handleRotationMove);
      window.removeEventListener('mouseup', handleRotationEnd);
    };
  }, [isRotating, selectedLayerId, rotationStart, layerData, zoom]);

  const renderLayer = (layer: Layer) => {
    const layerIndex = layers.find((l) => l.id === layer.id)?.index ?? 0;
    const isSelected = selectedLayerId === layer.id;

    const commonProps = {
      className: cn(
        'absolute select-none layer',
        isDragging && isSelected ? 'cursor-grabbing' : 'cursor-grab',
        layer.type === 'text' && editingTextId === layer.id && 'cursor-text',
        isResizing && 'pointer-events-none'
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
          : ('auto' as React.CSSProperties['pointerEvents']),
      },
      onClick: (e: React.MouseEvent) => handleLayerClick(e, layer.id),
      onMouseDown: (e: React.MouseEvent) => {
        if (isResizing) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        handleMouseDown(e, layer);
      },
    };

    const handleLayerReorder = async (direction: 'up' | 'down') => {
      const currentIndex = layers.find((l) => l.id === layer.id)?.index ?? 0;
      const targetIndex =
        direction === 'up' ? currentIndex + 1 : currentIndex - 1;
      if (targetIndex >= 0 && targetIndex < layers.length) {
        await onLayerReorder(layer.id, targetIndex);

        // Update local layer data state
        const updatedLayers = await getProjectLayers(projectId);
        setLayerData(updatedLayers);
      }
    };

    const layerContent = (() => {
      switch (layer.type) {
        case 'image':
        case 'sticker': {
          const assetId =
            layer.type === 'image' ? layer.imageAssetId : layer.stickerAssetId;
          const asset = assetData[assetId];

          if (!asset || asset.loading) {
            return (
              <LayerContextMenu
                key={layer.id}
                layer={layer}
                onLayerUpdate={onLayerUpdate}
                onLayerDelete={() => onLayerDelete(layer.id)}
                onLayerDuplicate={() => onLayerDuplicate(layer.id)}
                onLayerReorder={handleLayerReorder}
              >
                <div {...commonProps}>
                  <div className='w-full h-full bg-accent/20 flex items-center justify-center'>
                    <span className='text-accent-foreground'>Loading...</span>
                  </div>
                </div>
              </LayerContextMenu>
            );
          }

          if (asset.error) {
            return (
              <LayerContextMenu
                key={layer.id}
                layer={layer}
                onLayerUpdate={onLayerUpdate}
                onLayerDelete={() => onLayerDelete(layer.id)}
                onLayerDuplicate={() => onLayerDuplicate(layer.id)}
                onLayerReorder={handleLayerReorder}
              >
                <div {...commonProps}>
                  <div className='w-full h-full bg-destructive/20 flex items-center justify-center'>
                    <span className='text-destructive'>
                      Failed to load image
                    </span>
                  </div>
                </div>
              </LayerContextMenu>
            );
          }

          return (
            <LayerContextMenu
              key={layer.id}
              layer={layer}
              onLayerUpdate={onLayerUpdate}
              onLayerDelete={() => onLayerDelete(layer.id)}
              onLayerDuplicate={() => onLayerDuplicate(layer.id)}
              onLayerReorder={handleLayerReorder}
            >
              <div {...commonProps}>
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
                    {/* Rotation handle */}
                    <div
                      className='absolute left-1/2 -top-8 w-0.5 h-8 bg-orange-500 origin-bottom cursor-grab active:cursor-grabbing'
                      onMouseDown={(e) => handleRotationStart(e, layer)}
                    >
                      <div className='absolute -top-1.5 left-1/2 w-3 h-3 -translate-x-1/2 bg-orange-500 rounded-full ring-2 ring-background shadow-md' />
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
            </LayerContextMenu>
          );
        }
        case 'text': {
          const isEditing = editingTextId === layer.id;
          return (
            <LayerContextMenu
              key={layer.id}
              layer={layer}
              onLayerUpdate={onLayerUpdate}
              onLayerDelete={() => onLayerDelete(layer.id)}
              onLayerDuplicate={() => onLayerDuplicate(layer.id)}
              onLayerReorder={handleLayerReorder}
            >
              <div
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
                    {/* Rotation handle */}
                    <div
                      className='absolute left-1/2 -top-8 w-0.5 h-8 bg-orange-500 origin-bottom cursor-grab active:cursor-grabbing'
                      onMouseDown={(e) => handleRotationStart(e, layer)}
                    >
                      <div className='absolute -top-1.5 left-1/2 w-3 h-3 -translate-x-1/2 bg-orange-500 rounded-full ring-2 ring-background shadow-md' />
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
            </LayerContextMenu>
          );
        }
      }
    })();

    return layerContent;
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

    // Calculate minimum size
    const MIN_SIZE = 20;

    // Handle different resize directions, accounting for flipped states
    if (resizeHandle.includes('e')) {
      const delta = isFlippedX ? -adjustedDeltaX : adjustedDeltaX;
      newWidth = Math.max(MIN_SIZE, resizeStart.width + delta);
      if (shouldMaintainAspectRatio) {
        newHeight = newWidth / aspectRatio;
      }
    } else if (resizeHandle.includes('w')) {
      const delta = isFlippedX ? -adjustedDeltaX : adjustedDeltaX;
      const width = Math.max(MIN_SIZE, resizeStart.width - delta);
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
      newHeight = Math.max(MIN_SIZE, resizeStart.height + delta);
      if (shouldMaintainAspectRatio) {
        newWidth = newHeight * aspectRatio;
      }
    } else if (resizeHandle.includes('n')) {
      const delta = isFlippedY ? -adjustedDeltaY : adjustedDeltaY;
      const height = Math.max(MIN_SIZE, resizeStart.height - delta);
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

    // Calculate potential guides for the current layer
    const guides = calculateAlignmentGuides(
      {
        ...layer,
        transform: {
          ...layer.transform,
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
        },
      },
      layer.id
    );

    // Find closest guides for edges and size
    const leftGuide = findClosestGuide(newX, guides, 'vertical');
    const rightGuide = findClosestGuide(newX + newWidth, guides, 'vertical');
    const topGuide = findClosestGuide(newY, guides, 'horizontal');
    const bottomGuide = findClosestGuide(
      newY + newHeight,
      guides,
      'horizontal'
    );
    const widthGuide = findClosestGuide(newWidth, guides, 'vertical');
    const heightGuide = findClosestGuide(newHeight, guides, 'horizontal');

    // Apply snapping based on which handle is being dragged
    if (resizeHandle.includes('e') && rightGuide) {
      newWidth = rightGuide.guide.position - newX;
    } else if (resizeHandle.includes('w') && leftGuide) {
      const oldRight = newX + newWidth;
      newX = leftGuide.guide.position;
      newWidth = oldRight - newX;
    }

    if (resizeHandle.includes('s') && bottomGuide) {
      newHeight = bottomGuide.guide.position - newY;
    } else if (resizeHandle.includes('n') && topGuide) {
      const oldBottom = newY + newHeight;
      newY = topGuide.guide.position;
      newHeight = oldBottom - newY;
    }

    // Apply size snapping
    if (widthGuide && !shouldMaintainAspectRatio) {
      newWidth = widthGuide.guide.position;
    }
    if (heightGuide && !shouldMaintainAspectRatio) {
      newHeight = heightGuide.guide.position;
    }

    // Update alignment guides
    setAlignmentGuides(
      [
        leftGuide?.guide,
        rightGuide?.guide,
        topGuide?.guide,
        bottomGuide?.guide,
        widthGuide?.guide,
        heightGuide?.guide,
      ].filter((guide): guide is AlignmentGuide => guide !== undefined)
    );

    // Ensure the layer stays within reasonable bounds
    const maxWidth = canvasSize.width * 5;
    const maxHeight = canvasSize.height * 5;
    newWidth = Math.min(maxWidth, Math.max(MIN_SIZE, newWidth));
    newHeight = Math.min(maxHeight, Math.max(MIN_SIZE, newHeight));

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

                {/* Render alignment guides */}
                {(isDragging || isResizing) && renderAlignmentGuides()}
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
