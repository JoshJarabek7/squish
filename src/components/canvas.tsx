// canvas.tsx

import { useRef, useState, useEffect } from 'react';
import { Layer, ImageLayer, StickerLayer } from '@/types/ProjectType';
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
import { nanoid } from 'nanoid';
import {
  createImageAsset,
  createLayer,
  updateProjectTimestamp,
  createAction,
} from '@/lib/db';
import { ImageToolbar } from '@/components/image-toolbar';

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

// Extend React CSSProperties to allow custom CSS vars like --text-stroke-width
type CSSWithVar = React.CSSProperties & {
  [key: `--${string}`]: string | number;
};

interface AlignmentGuide {
  position: number;
  type: 'horizontal' | 'vertical';
  layerId?: string;
  guideType:
    | 'edge'
    | 'center'
    | 'size'
    | 'grid'
    | 'fraction'
    | 'background'
    | 'hidden';
}

interface ClosestGuide {
  guide: AlignmentGuide;
  distance: number;
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
  const zoom = externalZoom ?? internalZoom;
  const setZoom = (newZoom: number) => {
    if (onZoomChange) {
      onZoomChange(newZoom);
    } else {
      setInternalZoom(newZoom);
    }
  };

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
    origX: 0,
    origY: 0,
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
  const SNAP_THRESHOLD = 5;

  const [isRotating, setIsRotating] = useState(false);
  const [rotationStart, setRotationStart] = useState({ x: 0, y: 0, angle: 0 });

  // Zoom with optional mouse pivot
  const handleZoom = (delta: number, clientX?: number, clientY?: number) => {
    const minZoom = 0.1;
    const maxZoom = 5;
    const newZoom = Math.min(Math.max(minZoom, zoom + delta), maxZoom);

    if (clientX !== undefined && clientY !== undefined && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (clientX - rect.left) / zoom;
      const y = (clientY - rect.top) / zoom;
      const newOffsetX = x * (zoom - newZoom);
      const newOffsetY = y * (zoom - newZoom);
      setViewportOffset((prev) => ({
        x: prev.x + newOffsetX,
        y: prev.y + newOffsetY,
      }));
    }

    setZoom(newZoom);
  };

  // Center + fit
  const centerAndFitCanvas = () => {
    const workspace = workspaceRef.current;
    const canvas = canvasRef.current;
    if (!workspace || !canvas) return;
    const workspaceRect = workspace.getBoundingClientRect();
    const workspaceWidth = workspaceRect.width;
    const workspaceHeight = workspaceRect.height;

    const padding = 40;
    const horizontalZoom = (workspaceWidth - padding * 2) / canvasSize.width;
    const verticalZoom = (workspaceHeight - padding * 2) / canvasSize.height;
    const newZoom = Math.min(horizontalZoom, verticalZoom, 1);

    const scaledCanvasWidth = canvasSize.width * newZoom;
    const scaledCanvasHeight = canvasSize.height * newZoom;

    const newX = Math.round((workspaceWidth - scaledCanvasWidth) / 2);
    const newY = Math.round((workspaceHeight - scaledCanvasHeight) / 2);

    setZoom(newZoom);
    setViewportOffset({ x: newX, y: newY });
  };

  // Center once
  useEffect(() => {
    if (!hasInitialCentered.current && projectId) {
      const timer = setTimeout(centerAndFitCanvas, 100);
      hasInitialCentered.current = true;
      return () => clearTimeout(timer);
    }
  }, [projectId]);

  useEffect(() => {
    hasInitialCentered.current = false;
  }, [projectId]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const resizeObserver = new ResizeObserver(() => {
      // no auto center on workspace resize
    });
    resizeObserver.observe(workspace);
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Load layers
  useEffect(() => {
    const loadLayers = async () => {
      try {
        const loadedLayers = await getProjectLayers(projectId);
        setLayerData(loadedLayers);

        const newAssetData: AssetCache = { ...assetData };
        loadedLayers
          .filter((l) => l.type === 'image' || l.type === 'sticker')
          .forEach((l) => {
            const assetId =
              l.type === 'image' ? l.imageAssetId : l.stickerAssetId;
            if (!newAssetData[assetId] || newAssetData[assetId].error) {
              newAssetData[assetId] = {
                url: '',
                loading: true,
                error: false,
              };
            }
          });
        setAssetData(newAssetData);

        const loadPromises = loadedLayers
          .filter((l) => l.type === 'image' || l.type === 'sticker')
          .map(async (l) => {
            const assetId =
              l.type === 'image' ? l.imageAssetId : l.stickerAssetId;
            // skip if we have a good url
            if (newAssetData[assetId]?.url && !newAssetData[assetId].error) {
              return;
            }
            try {
              const data = await (l.type === 'image'
                ? getImageAssetData(assetId)
                : getStickerAssetData(assetId));
              const binaryData = data instanceof Uint8Array ? data : data.data;
              const mimeType =
                data instanceof Uint8Array ? 'image/png' : data.mimeType;
              const blob = new Blob([binaryData], { type: mimeType });

              if (newAssetData[assetId]?.url) {
                URL.revokeObjectURL(newAssetData[assetId].url);
              }
              const url = URL.createObjectURL(blob);
              setAssetData((prev) => ({
                ...prev,
                [assetId]: { url, loading: false, error: false },
              }));
            } catch {
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
      } catch {
        toast.error('Failed to load layers');
      }
    };

    loadLayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, canvasSettingsVersion]);

  useEffect(() => {
    onAssetDataChange?.(assetData);
  }, [assetData, onAssetDataChange]);

  useEffect(() => {
    return () => {
      Object.values(assetData).forEach((asset) => {
        if (asset.url) {
          URL.revokeObjectURL(asset.url);
        }
      });
    };
  }, [assetData]);

  // Load canvas settings
  useEffect(() => {
    const loadCanvasSettingsData = async () => {
      try {
        const settings = await getCanvasSettings(projectId);
        setCanvasSize({ width: settings.width, height: settings.height });

        if (settings.backgroundType === 'image' && settings.backgroundImageId) {
          try {
            const imageData = await getImageAssetData(
              settings.backgroundImageId
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

            const img = new Image();
            const imgLoaded = new Promise<{ width: number; height: number }>(
              (resolve, reject) => {
                img.onload = () =>
                  resolve({
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                  });
                img.onerror = reject;
              }
            );
            img.src = imageUrl;
            const imageSize = await imgLoaded;

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
          } catch {
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
      } catch {
        // ignore load errors
      }
    };
    loadCanvasSettingsData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, canvasSettingsVersion]);

  useEffect(() => {
    const currentUrl =
      canvasBackground.type === 'image' ? canvasBackground.imageUrl : null;
    return () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [canvasBackground.type, canvasBackground.imageUrl]);

  // Layer click
  const handleLayerClick = (e: React.MouseEvent, layerId: string) => {
    e.stopPropagation();
    if (editingTextId) return;
    onLayerSelect(layerId);
  };

  // Drag
  const handleMouseDown = (e: React.MouseEvent, layer: Layer) => {
    if (e.button !== 0) return;
    if (editingTextId === layer.id) return;
    if (layer.id !== selectedLayerId || isResizing || isPanning) return;
    e.stopPropagation();
    e.preventDefault();

    setIsDragging(true);
    setDragLayer(layer);

    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    const mouseX = (e.clientX - canvasRect.left) / zoom;
    const mouseY = (e.clientY - canvasRect.top) / zoom;
    setDragStart({
      x: mouseX - layer.transform.x,
      y: mouseY - layer.transform.y,
    });
  };

  useEffect(() => {
    if (!isDragging || !dragLayer) return;

    const onMouseMove = (e: MouseEvent) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const mouseX = (e.clientX - canvasRect.left) / zoom;
      const mouseY = (e.clientY - canvasRect.top) / zoom;

      let newX = mouseX - dragStart.x;
      let newY = mouseY - dragStart.y;

      // alignment
      const guides = calculateAlignmentGuides(
        {
          ...dragLayer,
          transform: { ...dragLayer.transform, x: newX, y: newY },
        },
        dragLayer.id
      );

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

      // Collect guides carefully
      const alignmentTemp: AlignmentGuide[] = [];
      if (leftGuide?.guide) alignmentTemp.push(leftGuide.guide);
      if (rightGuide?.guide) alignmentTemp.push(rightGuide.guide);
      if (centerXGuide?.guide) alignmentTemp.push(centerXGuide.guide);
      if (topGuide?.guide) alignmentTemp.push(topGuide.guide);
      if (bottomGuide?.guide) alignmentTemp.push(bottomGuide.guide);
      if (centerYGuide?.guide) alignmentTemp.push(centerYGuide.guide);
      setAlignmentGuides(alignmentTemp);

      setLayerData((prev) =>
        prev.map((l) =>
          l.id === dragLayer.id
            ? { ...l, transform: { ...l.transform, x: newX, y: newY } }
            : l
        )
      );
    };

    const onMouseUp = () => {
      const layer = layerData.find((l) => l.id === dragLayer.id);
      if (layer) {
        const originalLayer = { ...dragLayer };
        const updatedLayer = { ...layer };
        if (
          originalLayer.transform.x !== updatedLayer.transform.x ||
          originalLayer.transform.y !== updatedLayer.transform.y
        ) {
          void onLayerUpdate(updatedLayer, originalLayer);
        }
      }

      setIsDragging(false);
      setDragLayer(null);
      setAlignmentGuides([]);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, dragLayer, dragStart, zoom, layerData, onLayerUpdate]);

  // Keyboard
  useEffect(() => {
    if (!selectedLayerId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const layer = layerData.find((l) => l.id === selectedLayerId);
      if (!layer) return;
      if (editingTextId === layer.id) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onLayerDelete(layer.id);
        return;
      }

      const MOVE = 1;
      const ROTATE = 1;
      const SCALE = 0.01;
      const OPACITY = 0.05;

      const newT = { ...layer.transform };

      switch (e.key) {
        case 'ArrowLeft':
          newT.x -= MOVE;
          break;
        case 'ArrowRight':
          newT.x += MOVE;
          break;
        case 'ArrowUp':
          newT.y -= MOVE;
          break;
        case 'ArrowDown':
          newT.y += MOVE;
          break;
        case 'r':
          newT.rotation += ROTATE;
          break;
        case 'R':
          newT.rotation -= ROTATE;
          break;
        case '+':
          newT.scaleX += SCALE;
          newT.scaleY += SCALE;
          break;
        case '-':
          newT.scaleX -= SCALE;
          newT.scaleY -= SCALE;
          break;
        case '[':
          newT.opacity = Math.max(0, newT.opacity - OPACITY);
          break;
        case ']':
          newT.opacity = Math.min(1, newT.opacity + OPACITY);
          break;
        default:
          return;
      }

      onLayerUpdate({ ...layer, transform: newT });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedLayerId, layerData, onLayerUpdate, editingTextId, onLayerDelete]);

  // Text double-click
  const handleTextDoubleClick = (e: React.MouseEvent, layer: Layer) => {
    if (layer.type !== 'text') return;
    e.stopPropagation();
    e.preventDefault();
    setEditingTextId(layer.id);
    onLayerSelect(layer.id);
  };

  // Content editable
  const handleContentEditableChange = (
    e: React.FormEvent<HTMLDivElement>,
    layer: Layer
  ) => {
    if (layer.type !== 'text') return;
    const newContent = e.currentTarget.textContent ?? '';
    if (newContent !== layer.content) {
      onLayerUpdate({ ...layer, content: newContent });
    }
  };

  const handleTextBlur = (e: React.FocusEvent) => {
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

  // Resizing
  const handleResizeStart = (
    e: React.MouseEvent,
    handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  ) => {
    if (!selectedLayerId) return;
    e.stopPropagation();
    e.preventDefault();

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
      origX: layer.transform.x,
      origY: layer.transform.y,
    });
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
    setAlignmentGuides([]);
  };

  // Helper to scale background images properly
  function calculateScaledDimensions(
    imageWidth: number,
    imageHeight: number,
    canvasWidth: number,
    canvasHeight: number
  ) {
    const imageAsp = imageWidth / imageHeight;
    const canvasAsp = canvasWidth / canvasHeight;
    let scaledWidth: number;
    let scaledHeight: number;

    if (imageAsp > canvasAsp) {
      scaledHeight = canvasHeight;
      scaledWidth = canvasHeight * imageAsp;
    } else {
      scaledWidth = canvasWidth;
      scaledHeight = canvasWidth / imageAsp;
    }
    const x = (canvasWidth - scaledWidth) / 2;
    const y = (canvasHeight - scaledHeight) / 2;
    return { width: scaledWidth, height: scaledHeight, x, y };
  }

  // For snapping
  function findClosestGuide(
    value: number,
    guides: AlignmentGuide[],
    type: 'horizontal' | 'vertical'
  ): ClosestGuide | null {
    let closestGuide: AlignmentGuide | null = null;
    let minDistance = SNAP_THRESHOLD;
    for (const g of guides) {
      if (g.type !== type) continue;
      const dist = Math.abs(g.position - value);
      if (dist < minDistance) {
        minDistance = dist;
        closestGuide = g;
      }
    }
    return closestGuide ? { guide: closestGuide, distance: minDistance } : null;
  }

  const calculateAlignmentGuides = (
    activeLayer: Layer,
    skipLayerId?: string
  ): AlignmentGuide[] => {
    const guides: AlignmentGuide[] = [];
    const activeLeft = activeLayer.transform.x;
    const activeRight = activeLeft + activeLayer.transform.width;
    const activeTop = activeLayer.transform.y;
    const activeBottom = activeTop + activeLayer.transform.height;
    const activeCenterX = activeLeft + activeLayer.transform.width / 2;
    const activeCenterY = activeTop + activeLayer.transform.height / 2;

    // Canvas edges
    guides.push(
      { position: 0, type: 'vertical', guideType: 'edge' },
      { position: canvasSize.width, type: 'vertical', guideType: 'edge' },
      { position: 0, type: 'horizontal', guideType: 'edge' },
      { position: canvasSize.height, type: 'horizontal', guideType: 'edge' }
    );

    // Canvas center - also check if active layer center aligns with canvas center
    const canvasCenterX = canvasSize.width / 2;
    const canvasCenterY = canvasSize.height / 2;

    if (Math.abs(activeCenterX - canvasCenterX) < SNAP_THRESHOLD) {
      guides.push({
        position: canvasCenterX,
        type: 'vertical',
        guideType: 'center',
      });
    }
    if (Math.abs(activeCenterY - canvasCenterY) < SNAP_THRESHOLD) {
      guides.push({
        position: canvasCenterY,
        type: 'horizontal',
        guideType: 'center',
      });
    }

    // Grid
    if (gridSettings.enabled) {
      const colWidth = canvasSize.width / gridSettings.columns;
      for (let i = 1; i < gridSettings.columns; i++) {
        guides.push({
          position: colWidth * i,
          type: 'vertical',
          guideType: 'grid',
        });
      }
      const rowHeight = canvasSize.height / gridSettings.rows;
      for (let i = 1; i < gridSettings.rows; i++) {
        guides.push({
          position: rowHeight * i,
          type: 'horizontal',
          guideType: 'grid',
        });
      }
      if (gridSettings.showFractions) {
        [1 / 3, 2 / 3].forEach((f) => {
          guides.push(
            {
              position: canvasSize.width * f,
              type: 'vertical',
              guideType: 'fraction',
            },
            {
              position: canvasSize.height * f,
              type: 'horizontal',
              guideType: 'fraction',
            }
          );
        });
        [1 / 4, 3 / 4].forEach((f) => {
          guides.push(
            {
              position: canvasSize.width * f,
              type: 'vertical',
              guideType: 'fraction',
            },
            {
              position: canvasSize.height * f,
              type: 'horizontal',
              guideType: 'fraction',
            }
          );
        });
      }
    }

    // Background image
    if (canvasBackground.type === 'image' && canvasBackground.imageSize) {
      const scaled = calculateScaledDimensions(
        canvasBackground.imageSize.width,
        canvasBackground.imageSize.height,
        canvasSize.width,
        canvasSize.height
      );
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
        },
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

    // Other layers
    layerData.forEach((other) => {
      if (other.id === skipLayerId) return;
      const left = other.transform.x;
      const right = left + other.transform.width;
      const top = other.transform.y;
      const bottom = top + other.transform.height;
      const centerX = left + other.transform.width / 2;
      const centerY = top + other.transform.height / 2;
      const width = other.transform.width;
      const height = other.transform.height;

      guides.push(
        {
          position: left,
          type: 'vertical',
          layerId: other.id,
          guideType:
            Math.abs(activeLeft - left) < SNAP_THRESHOLD ? 'edge' : 'hidden',
        },
        {
          position: right,
          type: 'vertical',
          layerId: other.id,
          guideType:
            Math.abs(activeRight - right) < SNAP_THRESHOLD ? 'edge' : 'hidden',
        },
        {
          position: top,
          type: 'horizontal',
          layerId: other.id,
          guideType:
            Math.abs(activeTop - top) < SNAP_THRESHOLD ? 'edge' : 'hidden',
        },
        {
          position: bottom,
          type: 'horizontal',
          layerId: other.id,
          guideType:
            Math.abs(activeBottom - bottom) < SNAP_THRESHOLD
              ? 'edge'
              : 'hidden',
        },
        {
          position: centerX,
          type: 'vertical',
          layerId: other.id,
          guideType:
            Math.abs(activeCenterX - centerX) < SNAP_THRESHOLD
              ? 'center'
              : 'hidden',
        },
        {
          position: centerY,
          type: 'horizontal',
          layerId: other.id,
          guideType:
            Math.abs(activeCenterY - centerY) < SNAP_THRESHOLD
              ? 'center'
              : 'hidden',
        }
      );

      // Size matching
      if (Math.abs(activeLayer.transform.width - width) < SNAP_THRESHOLD) {
        guides.push({
          position: width,
          type: 'vertical',
          layerId: other.id,
          guideType: 'size',
        });
      }
      if (Math.abs(height - activeLayer.transform.height) < SNAP_THRESHOLD) {
        guides.push({
          position: height,
          type: 'horizontal',
          layerId: other.id,
          guideType: 'size',
        });
      }
    });

    return guides;
  };

  const renderAlignmentGuides = () => {
    return alignmentGuides.map((g, idx) => {
      const style = {
        position: 'absolute' as const,
        backgroundColor: (() => {
          switch (g.guideType) {
            case 'size':
              return '#00ff00';
            case 'grid':
              return 'rgba(128, 128, 255, 0.5)';
            case 'fraction':
              return 'rgba(128, 128, 255, 0.3)';
            case 'background':
              return 'rgba(255, 128, 0, 0.5)';
            default:
              return '#ff0000'; // edge/center
          }
        })(),
        pointerEvents: 'none' as const,
        zIndex: 9999,
        ...(g.type === 'vertical'
          ? {
              left: `${g.position}px`,
              top: 0,
              width:
                g.guideType === 'grid' || g.guideType === 'fraction'
                  ? '0.5px'
                  : '1px',
              height: '100%',
            }
          : {
              top: `${g.position}px`,
              left: 0,
              height:
                g.guideType === 'grid' || g.guideType === 'fraction'
                  ? '0.5px'
                  : '1px',
              width: '100%',
            }),
      };
      return <div key={`${g.type}-${idx}`} style={style} />;
    });
  };

  // Rotation
  const calculateAngle = (cx: number, cy: number, ex: number, ey: number) => {
    const dx = ex - cx;
    const dy = ey - cy;
    let theta = Math.atan2(dy, dx);
    theta *= 180 / Math.PI;
    return theta;
  };

  const snapAngle = (angle: number, interval = 45) => {
    return Math.round(angle / interval) * interval;
  };

  const handleRotationStart = (e: React.MouseEvent, layer: Layer) => {
    if (layer.id !== selectedLayerId || isResizing || isPanning) return;
    e.stopPropagation();
    e.preventDefault();
    setIsRotating(true);

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const centerX =
      (layer.transform.x + layer.transform.width / 2) * zoom + rect.left;
    const centerY =
      (layer.transform.y + layer.transform.height / 2) * zoom + rect.top;

    const currentAngle = calculateAngle(centerX, centerY, e.clientX, e.clientY);
    setRotationStart({
      x: centerX,
      y: centerY,
      angle: currentAngle - (layer.transform.rotation || 0),
    });
  };

  useEffect(() => {
    if (!isRotating || !selectedLayerId) return;

    const handleRotationMove = (e: MouseEvent) => {
      const layer = layerData.find((l) => l.id === selectedLayerId);
      if (!layer) return;

      const currentAngle = calculateAngle(
        rotationStart.x,
        rotationStart.y,
        e.clientX,
        e.clientY
      );

      let newRotation = currentAngle - rotationStart.angle;
      if (e.shiftKey) {
        newRotation = snapAngle(newRotation);
      }

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
  }, [
    isRotating,
    selectedLayerId,
    rotationStart,
    layerData,
    zoom,
    onLayerUpdate,
  ]);

  // Actual resizing
  useEffect(() => {
    if (!isResizing || !resizeHandle || !selectedLayerId) return;

    const handleResizeMove = (e: MouseEvent) => {
      const layer = layerData.find((l) => l.id === selectedLayerId);
      if (!layer) return;

      const deltaX = (e.clientX - resizeStart.x) / zoom;
      const deltaY = (e.clientY - resizeStart.y) / zoom;

      const {
        origX: startX,
        origY: startY,
        width: startWidth,
        height: startHeight,
      } = resizeStart;
      const { scaleX = 1, scaleY = 1 } = layer.transform;
      const isFlippedX = scaleX < 0;
      const isFlippedY = scaleY < 0;

      // We'll keep these as positive bounding-box width/height
      let newWidth = startWidth;
      let newHeight = startHeight;
      let newX = startX;
      let newY = startY;

      // Decide which edges we're resizing based on the handle
      const resizingNorth = resizeHandle.includes('n');
      const resizingSouth = resizeHandle.includes('s');
      const resizingEast = resizeHandle.includes('e');
      const resizingWest = resizeHandle.includes('w');

      const MIN_SIZE = 20;
      const shouldMaintainAspectRatio =
        layer.type === 'image' || layer.type === 'sticker' || e.shiftKey;
      const aspect = startWidth / startHeight;

      // Handle horizontal resizing
      if (resizingEast) {
        // When resizing from the east edge, adjust width based on drag delta
        const delta = deltaX;
        newWidth = Math.max(
          MIN_SIZE,
          startWidth + (isFlippedX ? delta : delta)
        );
      } else if (resizingWest) {
        // When resizing from the west edge, adjust width and shift x to maintain right edge
        const delta = deltaX;
        const updatedWidth = Math.max(
          MIN_SIZE,
          startWidth - (isFlippedX ? delta : delta)
        );
        newX = startX + (startWidth - updatedWidth);
        newWidth = updatedWidth;
      }

      // Handle vertical resizing
      if (resizingSouth) {
        // When resizing from the south edge, adjust height based on drag delta
        const delta = deltaY;
        newHeight = Math.max(
          MIN_SIZE,
          startHeight + (isFlippedY ? delta : delta)
        );
      } else if (resizingNorth) {
        // When resizing from the north edge, adjust height and shift y to maintain bottom edge
        const delta = deltaY;
        const updatedHeight = Math.max(
          MIN_SIZE,
          startHeight - (isFlippedY ? delta : delta)
        );
        newY = startY + (startHeight - updatedHeight);
        newHeight = updatedHeight;
      }

      // Maintain aspect ratio if needed
      if (
        shouldMaintainAspectRatio &&
        (resizingNorth || resizingSouth || resizingEast || resizingWest)
      ) {
        if (resizingEast || resizingWest) {
          // If resizing horizontally, adjust height based on width
          newHeight = newWidth / aspect;
          if (resizingNorth) {
            newY = startY + (startHeight - newHeight);
          }
        } else {
          // If resizing vertically, adjust width based on height
          newWidth = newHeight * aspect;
          if (resizingWest) {
            newX = startX + (startWidth - newWidth);
          }
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

      // Find closest guides
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

      // Apply snapping
      if (resizingWest && leftGuide) {
        const oldRight = newX + newWidth;
        newX = leftGuide.guide.position;
        newWidth = oldRight - newX;
      } else if (resizingEast && rightGuide) {
        newWidth = rightGuide.guide.position - newX;
      }

      if (resizingNorth && topGuide) {
        const oldBottom = newY + newHeight;
        newY = topGuide.guide.position;
        newHeight = oldBottom - newY;
      } else if (resizingSouth && bottomGuide) {
        newHeight = bottomGuide.guide.position - newY;
      }

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

      // Ensure dimensions stay within bounds
      const maxW = canvasSize.width * 5;
      const maxH = canvasSize.height * 5;
      newWidth = Math.min(maxW, Math.max(MIN_SIZE, newWidth));
      newHeight = Math.min(maxH, Math.max(MIN_SIZE, newHeight));

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

    const handleMouseUp = () => {
      handleResizeEnd();
    };

    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeHandle, resizeStart, zoom, selectedLayerId, layerData]);

  // Canvas resizing
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

    if (canvasResizeHandle.includes('e')) {
      newWidth = Math.min(
        MAX_SIZE,
        Math.max(MIN_SIZE, canvasResizeStart.width + deltaX)
      );
    } else if (canvasResizeHandle.includes('w')) {
      const wDelta = deltaX;
      newWidth = Math.min(
        MAX_SIZE,
        Math.max(MIN_SIZE, canvasResizeStart.width - wDelta)
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
      const hDelta = deltaY;
      newHeight = Math.min(
        MAX_SIZE,
        Math.max(MIN_SIZE, canvasResizeStart.height - hDelta)
      );
      if (newHeight !== canvasResizeStart.height) {
        newY = viewportOffset.y + (canvasResizeStart.height - newHeight) * zoom;
      }
    }

    // aspect ratio if SHIFT + corner
    if (
      canvasResizeHandle.length === 2 &&
      e instanceof MouseEvent &&
      e.shiftKey
    ) {
      const aspect = canvasResizeStart.width / canvasResizeStart.height;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        newHeight = newWidth / aspect;
      } else {
        newWidth = newHeight * aspect;
      }
      newWidth = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, newWidth)));
      newHeight = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, newHeight)));
    }

    newWidth = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, newWidth)));
    newHeight = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, newHeight)));
    setCanvasSize({ width: newWidth, height: newHeight });

    if (canvasResizeHandle.includes('w') || canvasResizeHandle.includes('n')) {
      setViewportOffset({ x: newX, y: newY });
    }
  };

  const handleCanvasResizeEnd = async () => {
    if (isCanvasResizing) {
      try {
        const width = Math.round(canvasSize.width);
        const height = Math.round(canvasSize.height);
        await updateCanvasSettings(projectId, { width, height });
        setCanvasSize({ width, height });
      } catch {
        toast.error('Failed to save canvas size');
      }
    }
    setIsCanvasResizing(false);
    setCanvasResizeHandle(null);
  };

  useEffect(() => {
    if (!isCanvasResizing) return;
    const onMouseMove = (e: MouseEvent) => handleCanvasResizeMove(e);
    const onMouseUp = () => handleCanvasResizeEnd();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isCanvasResizing, canvasResizeHandle, canvasResizeStart, zoom]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case '=':
          case '+':
            e.preventDefault();
            handleZoom(0.1);
            break;
          case '-':
          case '_':
            e.preventDefault();
            handleZoom(-0.1);
            break;
          case '0':
            e.preventDefault();
            centerAndFitCanvas();
            break;
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
    };
  }, [zoom]);

  // Reload if external layers changed
  useEffect(() => {
    const reload = async () => {
      try {
        const loaded = await getProjectLayers(projectId);
        setLayerData(loaded);
      } catch {
        toast.error('Failed to load layers');
      }
    };
    void reload();
  }, [projectId, canvasSettingsVersion, layers]);

  const handleSegmentation = async (images: string[]) => {
    if (!projectId) return;

    try {
      // Create new layers for each segmented image
      for (const imageUrl of images) {
        // Convert data URL to Uint8Array
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        // Create image asset
        const assetId = await createImageAsset(
          'segmented-image.png',
          'image/png',
          data
        );

        // Create blob URL for immediate display
        const url = URL.createObjectURL(blob);

        // Update assetData state first
        setAssetData((prev) => ({
          ...prev,
          [assetId]: {
            url,
            loading: false,
            error: false,
          },
        }));

        // Get image dimensions
        const img = new Image();
        const imageSize = await new Promise<{ width: number; height: number }>(
          (resolve, reject) => {
            img.onload = () =>
              resolve({
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            img.onerror = reject;
            img.src = url;
          }
        );

        // Create the layer
        const newLayer = {
          id: nanoid(),
          type: 'image' as const,
          imageAssetId: assetId,
          transform: {
            x: 960 - imageSize.width / 2,
            y: 540 - imageSize.height / 2,
            width: imageSize.width,
            height: imageSize.height,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
            blendMode: 'normal',
          },
        };

        // Record the action before creating the layer
        await createAction({
          projectId,
          type: 'add_layer',
          layerId: newLayer.id,
          before: null,
          after: {
            ...newLayer,
            index: layers.length,
          },
        });

        // Create the layer in the database
        await createLayer(projectId, newLayer);
      }

      // Get the updated layer data
      const updatedLayers = await getProjectLayers(projectId);

      // Update all states in a single batch
      setLayerData(updatedLayers);
      onLayerSelect(null); // Deselect any selected layer

      // Update the project's last modified timestamp
      await updateProjectTimestamp(projectId);

      toast.success(`Added ${images.length} segmented layers`);
    } catch (error) {
      console.error('Failed to create segmented layers:', error);
      toast.error('Failed to create segmented layers');
    }
  };

  const handleFlipHorizontal = () => {
    if (!selectedLayerId) return;
    const layer = layerData.find((l) => l.id === selectedLayerId);
    if (!layer) return;

    onLayerUpdate({
      ...layer,
      transform: {
        ...layer.transform,
        scaleX: (layer.transform.scaleX ?? 1) * -1,
      },
    });
  };

  const handleFlipVertical = () => {
    if (!selectedLayerId) return;
    const layer = layerData.find((l) => l.id === selectedLayerId);
    if (!layer) return;

    onLayerUpdate({
      ...layer,
      transform: {
        ...layer.transform,
        scaleY: (layer.transform.scaleY ?? 1) * -1,
      },
    });
  };

  const renderLayer = (layer: Layer) => {
    const layerIndex = layers.find((l) => l.id === layer.id)?.index ?? 0;
    const isSelected = selectedLayerId === layer.id;
    const effectiveZIndex = layerIndex * 10 + (isSelected ? 1000 : 0);

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
        zIndex: effectiveZIndex,
        pointerEvents: isResizing ? 'none' : 'auto',
      } as React.CSSProperties,
      onClick: (e: React.MouseEvent) => {
        if (!(e.target as HTMLElement).closest('[data-control]')) {
          handleLayerClick(e, layer.id);
        }
      },
      onMouseDown: (e: React.MouseEvent) => {
        if (!(e.target as HTMLElement).closest('[data-control]')) {
          if (isResizing) {
            e.stopPropagation();
            e.preventDefault();
            return;
          }
          handleMouseDown(e, layer);
        }
      },
    };

    const handleReorder = async (direction: 'up' | 'down') => {
      const idx = layers.find((l) => l.id === layer.id)?.index ?? 0;
      const target = direction === 'up' ? idx + 1 : idx - 1;
      if (target >= 0 && target < layers.length) {
        await onLayerReorder(layer.id, target);
        const updated = await getProjectLayers(projectId);
        setLayerData(updated);
      }
    };

    if (layer.type === 'image' || layer.type === 'sticker') {
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
            onLayerReorder={handleReorder}
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
            onLayerReorder={handleReorder}
          >
            <div {...commonProps}>
              <div className='w-full h-full bg-destructive/20 flex items-center justify-center'>
                <span className='text-destructive'>Failed to load image</span>
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
          onLayerReorder={handleReorder}
        >
          <div {...commonProps}>
            <img
              src={asset.url}
              alt=''
              className='w-full h-full object-contain'
              draggable={false}
            />
            {isSelected && (
              <div
                className='absolute inset-0 z-[1000]'
                style={{ pointerEvents: 'none' }}
              >
                <div className='absolute -inset-[4px] overflow-visible'>
                  <div className='absolute inset-0 rainbow-border' />
                </div>
                <div
                  data-control='rotate'
                  className='absolute left-1/2 -top-8 w-0.5 h-8 bg-orange-500 origin-bottom cursor-grab active:cursor-grabbing'
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    handleRotationStart(e, layer);
                  }}
                  style={{ pointerEvents: 'auto' }}
                >
                  <div className='absolute -top-1.5 left-1/2 w-3 h-3 -translate-x-1/2 bg-orange-500 rounded-full ring-2 ring-background shadow-md' />
                </div>
                {renderResizeHandles(layer)}
              </div>
            )}
          </div>
        </LayerContextMenu>
      );
    }

    // text
    const isEditing = editingTextId === layer.id;
    return (
      <LayerContextMenu
        key={layer.id}
        layer={layer}
        onLayerUpdate={onLayerUpdate}
        onLayerDelete={() => onLayerDelete(layer.id)}
        onLayerDuplicate={() => onLayerDuplicate(layer.id)}
        onLayerReorder={handleReorder}
      >
        <div
          {...commonProps}
          onDoubleClick={(e) => handleTextDoubleClick(e, layer)}
          className={cn(
            commonProps.className,
            'flex items-center justify-center overflow-visible',
            layer.style.wordWrap === 'break-word' && 'break-words',
            layer.style.wordWrap === 'normal' && 'whitespace-nowrap',
            isEditing && 'cursor-text'
          )}
          style={{
            ...commonProps.style,
            pointerEvents: isEditing ? 'none' : 'auto',
          }}
        >
          {isEditing ? (
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
                  const rng = document.createRange();
                  const sel = window.getSelection();
                  rng.selectNodeContents(el);
                  rng.collapse(false);
                  sel?.removeAllRanges();
                  sel?.addRange(rng);
                }
              }}
              style={
                {
                  fontFamily: layer.style.fontFamily,
                  fontSize: layer.style.fontSize,
                  fontWeight: layer.style.fontWeight,
                  color: layer.style.color,
                  backgroundColor: layer.style.backgroundColor || 'transparent',
                  textAlign: layer.style.textAlign,
                  fontStyle: layer.style.italic ? 'italic' : 'normal',
                  textDecoration: layer.style.underline ? 'underline' : 'none',
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
                    layer.style.wordWrap === 'break-word' ? 'pre-wrap' : 'pre',
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
                  '--text-stroke-width': layer.style.stroke?.enabled
                    ? `${layer.style.stroke.width}px`
                    : '0',
                  '--text-stroke-color': layer.style.stroke?.enabled
                    ? layer.style.stroke.color
                    : 'transparent',
                  WebkitTextStrokeWidth: 'var(--text-stroke-width)',
                  WebkitTextStrokeColor: 'var(--text-stroke-color)',
                  pointerEvents: 'auto',
                } as CSSWithVar
              }
              className='w-full h-full bg-transparent outline-none'
            >
              {layer.content}
            </div>
          ) : (
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
                  backgroundColor: layer.style.backgroundColor || 'transparent',
                  textAlign: layer.style.textAlign,
                  fontStyle: layer.style.italic ? 'italic' : 'normal',
                  textDecoration: layer.style.underline ? 'underline' : 'none',
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
                    layer.style.wordWrap === 'break-word' ? 'pre-wrap' : 'pre',
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
                } as CSSWithVar
              }
            >
              <div className='w-full'>{layer.content}</div>
            </div>
          )}

          {isSelected && (
            <div
              className='absolute inset-0 z-[1000]'
              style={{ pointerEvents: 'none' }}
            >
              <div className='absolute -inset-[4px] overflow-visible'>
                <div className='absolute inset-0 rainbow-border' />
              </div>
              <div
                data-control='rotate'
                className='absolute left-1/2 -top-8 w-0.5 h-8 bg-orange-500 origin-bottom cursor-grab active:cursor-grabbing'
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleRotationStart(e, layer);
                }}
                style={{ pointerEvents: 'auto' }}
              >
                <div className='absolute -top-1.5 left-1/2 w-3 h-3 -translate-x-1/2 bg-orange-500 rounded-full ring-2 ring-background shadow-md' />
              </div>
              {renderResizeHandles(layer)}
            </div>
          )}
        </div>
      </LayerContextMenu>
    );
  };

  // Render the 4 corner handles for a layer
  const renderResizeHandles = (layer: Layer) => {
    const isFlippedX = (layer.transform.scaleX ?? 1) < 0;
    const isFlippedY = (layer.transform.scaleY ?? 1) < 0;

    // Single helper to get the correct cursor
    const getCursor = (h: string) => {
      switch (h) {
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

    // Flip handle direction, matching your old approach
    const flipHandle = (base: string) => {
      switch (base) {
        case 'nw':
          return `${isFlippedY ? 's' : 'n'}${isFlippedX ? 'e' : 'w'}`;
        case 'ne':
          return `${isFlippedY ? 's' : 'n'}${isFlippedX ? 'w' : 'e'}`;
        case 'sw':
          return `${isFlippedY ? 'n' : 's'}${isFlippedX ? 'e' : 'w'}`;
        case 'se':
          return `${isFlippedY ? 'n' : 's'}${isFlippedX ? 'w' : 'e'}`;
        default:
          return base;
      }
    };

    return (
      <>
        <div
          data-control='resize'
          className='absolute -top-1.5 -left-1.5 w-3 h-3 bg-orange-500 rounded-full ring-2 ring-background shadow-md'
          style={{ cursor: getCursor('nw'), pointerEvents: 'auto' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            handleResizeStart(e, flipHandle('nw') as any);
          }}
        />
        <div
          data-control='resize'
          className='absolute -top-1.5 -right-1.5 w-3 h-3 bg-orange-500 rounded-full ring-2 ring-background shadow-md'
          style={{ cursor: getCursor('ne'), pointerEvents: 'auto' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            handleResizeStart(e, flipHandle('ne') as any);
          }}
        />
        <div
          data-control='resize'
          className='absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-orange-500 rounded-full ring-2 ring-background shadow-md'
          style={{ cursor: getCursor('sw'), pointerEvents: 'auto' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            handleResizeStart(e, flipHandle('sw') as any);
          }}
        />
        <div
          data-control='resize'
          className='absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-orange-500 rounded-full ring-2 ring-background shadow-md'
          style={{ cursor: getCursor('se'), pointerEvents: 'auto' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            handleResizeStart(e, flipHandle('se') as any);
          }}
        />
      </>
    );
  };

  // Sort for rendering
  const sortedLayers = layerData
    .sort((a, b) => compareLayersForRender(a, b, layers))
    .map((l) => ({
      ...l,
      zIndex: (layers.find((x) => x.id === l.id)?.index ?? 0) * 10,
    }));

  // Mouse wheel for zoom/pan
  const handleWheelEvent = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const delta = -e.deltaY * 0.001;
      handleZoom(delta);
    } else if (e.shiftKey) {
      e.preventDefault();
      setViewportOffset((prev) => ({
        x: prev.x - e.deltaY,
        y: prev.y,
      }));
    } else {
      e.preventDefault();
      setViewportOffset((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  };

  useEffect(() => {
    const ws = workspaceRef.current;
    if (!ws) return;

    ws.addEventListener('wheel', handleWheelEvent, { passive: false });
    return () => {
      ws.removeEventListener('wheel', handleWheelEvent);
    };
  }, [zoom]);

  // Panning
  const handlePanStart = (e: React.MouseEvent) => {
    // Middle mouse
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
    setViewportOffset({ x: newX, y: newY });
  };

  const handlePanEnd = () => {
    setIsPanning(false);
  };

  // Keyboard shortcuts for zoom
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case '=':
          case '+':
            e.preventDefault();
            handleZoom(0.1);
            break;
          case '-':
          case '_':
            e.preventDefault();
            handleZoom(-0.1);
            break;
          case '0':
            e.preventDefault();
            centerAndFitCanvas();
            break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [zoom]);

  // Reload if layers list changes externally
  useEffect(() => {
    const reload = async () => {
      try {
        const loaded = await getProjectLayers(projectId);
        setLayerData(loaded);
      } catch {
        toast.error('Failed to load layers');
      }
    };
    void reload();
  }, [projectId, canvasSettingsVersion, layers]);

  return (
    <div className={cn('relative overflow-hidden bg-neutral-900', className)}>
      <div
        ref={workspaceRef}
        className='absolute inset-0 overflow-auto'
        onMouseDown={(e) => {
          // Deselect if clicking blank space
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
            // handleResizeMove now inside a useEffect
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
          <div
            className='absolute'
            style={{
              left: `${Math.round(viewportOffset.x)}px`,
              top: `${Math.round(viewportOffset.y)}px`,
              width: `${Math.round(canvasSize.width * zoom)}px`,
              height: `${Math.round(canvasSize.height * zoom)}px`,
            }}
          >
            <div
              ref={canvasRef}
              className='absolute bg-background shadow-2xl rounded-lg'
              style={{
                width: `${Math.round(canvasSize.width)}px`,
                height: `${Math.round(canvasSize.height)}px`,
                transform: `scale(${Number(zoom.toFixed(3))})`,
                transformOrigin: '0 0',
                ...(canvasBackground.type === 'color'
                  ? { backgroundColor: canvasBackground.color }
                  : {}),
                ...(canvasBackground.type === 'image' &&
                canvasBackground.imageSize
                  ? {
                      backgroundImage: `url(${canvasBackground.imageUrl})`,
                      backgroundSize: (() => {
                        const scaled = calculateScaledDimensions(
                          canvasBackground.imageSize.width,
                          canvasBackground.imageSize.height,
                          canvasSize.width,
                          canvasSize.height
                        );
                        return `${Math.round(scaled.width)}px ${Math.round(
                          scaled.height
                        )}px`;
                      })(),
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat',
                      willChange: 'transform',
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden',
                    }
                  : {}),
              }}
            >
              {/* Grid overlay (small checker if you want) */}
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

              <div className='absolute inset-0' style={{ overflow: 'visible' }}>
                {sortedLayers.map((ly) => renderLayer(ly))}
                {(isDragging || isResizing) && renderAlignmentGuides()}
              </div>

              {isEraserMode && eraserPath.length > 0 && (
                <svg className='absolute inset-0 pointer-events-none'>
                  <path
                    d={`M ${eraserPath[0][0]} ${eraserPath[0][1]}
                      ${eraserPath
                        .slice(1)
                        .map(([x, y]) => `L ${x} ${y}`)
                        .join(' ')}`}
                    stroke='black'
                    strokeWidth='2'
                    fill='none'
                  />
                </svg>
              )}

              <div
                className='absolute inset-0 pointer-events-none border-2 border-primary'
                style={{
                  zIndex: 9998,
                  boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.1)',
                }}
              />
            </div>

            {showCanvasResizeHandles && (
              <div
                className='absolute inset-0 pointer-events-none'
                style={{ zIndex: 20 }}
              >
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

      {/* Zoom Buttons */}
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
            if (isPanning) setIsPanning(false);
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

      {/* Canvas size display */}
      <div className='absolute bottom-4 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-background/80 backdrop-blur-sm text-xs text-muted-foreground'>
        {canvasSize.width} × {canvasSize.height}
      </div>
    </div>
  );
}
