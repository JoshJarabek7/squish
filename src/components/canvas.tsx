import { useRef, useState, useEffect } from "react";
import { Layer } from "@/types/ProjectType";
import { cn } from "@/lib/utils";
import { getProjectLayers, getImageAssetData, getStickerAssetData, getCanvasSettings, updateCanvasSettings } from "@/lib/db";
import { LayerToolbar, TextLayerToolbar } from "@/components/layer-toolbar";
import { ZoomIn, ZoomOut, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPortal } from "react-dom";

interface CanvasProps {
  projectId: string;
  layers: Array<{ id: string; index: number }>;
  selectedLayerId: string | null;
  onLayerSelect: (id: string | null) => void;
  onLayerUpdate: (layer: Layer) => void;
  onLayerReorder: (layerId: string, newIndex: number) => void;
  onLayerDelete: (layerId: string) => void;
  onLayerDuplicate: (layerId: string) => void;
  showCanvasResizeHandles?: boolean;
  className?: string;
}

// Add type for asset loading results
type AssetLoadResult = [string, string] | null;

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
  className 
}: CanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [layerData, setLayerData] = useState<Layer[]>([]);
  const [assetData, setAssetData] = useState<Record<string, string>>({});
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [eraserPath, setEraserPath] = useState<Array<[number, number]>>([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null>(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [dragLayer, setDragLayer] = useState<Layer | null>(null);
  const [isCanvasResizing, setIsCanvasResizing] = useState(false);
  const [canvasResizeStart, setCanvasResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [canvasResizeHandle, setCanvasResizeHandle] = useState<'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null>(null);

  // Add this helper function near the top of the component
  const logLayerOrder = (message: string) => {
    const layerOrder = layers.map(l => ({
      id: l.id,
      index: l.index,
      type: layerData.find(ld => ld.id === l.id)?.type
    }));

    const renderOrder = [...layerData]
      .sort((a, b) => {
        const aIndex = layers.find(l => l.id === a.id)?.index ?? 0;
        const bIndex = layers.find(l => l.id === b.id)?.index ?? 0;
        return aIndex - bIndex;
      })
      .map(l => ({
        id: l.id,
        type: l.type,
        index: layers.find(layer => layer.id === l.id)?.index
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
    const workspaceWidth = Math.round(workspaceRect.width);
    const workspaceHeight = Math.round(workspaceRect.height);

    // Calculate zoom to fit canvas in viewport with padding
    const padding = 40; // 20px padding on each side
    const horizontalZoom = (workspaceWidth - padding * 2) / canvasSize.width;
    const verticalZoom = (workspaceHeight - padding * 2) / canvasSize.height;
    const newZoom = Number(Math.min(horizontalZoom, verticalZoom, 1).toFixed(3)); // Don't zoom in past 100%

    // Calculate the scaled canvas dimensions
    const scaledCanvasWidth = Math.round(canvasSize.width * newZoom);
    const scaledCanvasHeight = Math.round(canvasSize.height * newZoom);

    // Calculate the position to center the canvas in the workspace
    const newX = Math.round((workspaceWidth - scaledCanvasWidth) / 2);
    const newY = Math.round((workspaceHeight - scaledCanvasHeight) / 2);

    // Batch the state updates to prevent multiple rerenders
    requestAnimationFrame(() => {
      setZoom(newZoom);
      setViewportOffset({ x: newX, y: newY });
    });
  };

  // Call centerAndFitCanvas when project is loaded or canvas size changes
  useEffect(() => {
    const timer = setTimeout(centerAndFitCanvas, 100);
    return () => clearTimeout(timer);
  }, [projectId, canvasSize.width, canvasSize.height]);

  // Also call centerAndFitCanvas when workspace is resized
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    let resizeTimeout: number | null = null;
    let isInitialResize = true;

    const handleResize = () => {
      if (resizeTimeout) {
        window.clearTimeout(resizeTimeout);
      }

      // Skip the first resize after mounting
      if (isInitialResize) {
        isInitialResize = false;
        return;
      }

      resizeTimeout = window.setTimeout(() => {
        requestAnimationFrame(centerAndFitCanvas);
      }, 100);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(workspace);

    return () => {
      if (resizeTimeout) {
        window.clearTimeout(resizeTimeout);
      }
      resizeObserver.disconnect();
    };
  }, [canvasSize.width, canvasSize.height]);

  // Load layer data
  useEffect(() => {
    const loadLayers = async () => {
      try {
        console.log('Loading layers for project:', projectId);
        const layers = await getProjectLayers(projectId);
        console.log('Loaded layers:', layers);
        setLayerData(layers);
        logLayerOrder('After loading layers');

        // Load assets for image and sticker layers
        const assetPromises = layers
          .filter(layer => layer.type === 'image' || layer.type === 'sticker')
          .map(async layer => {
            try {
              console.log('Loading asset for layer:', {
                layerId: layer.id,
                type: layer.type,
                assetId: layer.type === 'image' ? layer.imageAssetId : layer.stickerAssetId
              });

              const data = layer.type === 'image'
                ? await getImageAssetData(layer.imageAssetId)
                : await getStickerAssetData(layer.stickerAssetId);

              console.log('Asset data loaded:', {
                type: layer.type,
                id: layer.type === 'image' ? layer.imageAssetId : layer.stickerAssetId,
                dataLength: data instanceof Uint8Array ? data.length : data.data.length,
                mimeType: 'mimeType' in data ? data.mimeType : 'image/jpeg',
                isUint8Array: data instanceof Uint8Array,
                hasData: Boolean(data),
                firstFewBytes: Array.from(data instanceof Uint8Array ? data : data.data).slice(0, 4)
              });

              return [
                layer.type === 'image' ? layer.imageAssetId : layer.stickerAssetId,
                data
              ] as [string, any];
            } catch (error) {
              console.error(
                `Failed to load asset ${
                  layer.type === 'image' ? layer.imageAssetId : layer.stickerAssetId
                }:`, 
                error
              );
              return null;
            }
          });

        const loadedAssets = (await Promise.all(assetPromises))
          .filter((result): result is [string, any] => result !== null)
          .reduce((acc, [id, data]) => {
            try {
              // Get the correct MIME type and data
              const mimeType = data instanceof Uint8Array ? 'image/jpeg' : data.mimeType;
              const binaryData = data instanceof Uint8Array ? data : data.data;

              if (!binaryData || binaryData.length === 0) {
                console.error('Invalid binary data:', {
                  id,
                  hasData: Boolean(binaryData),
                  length: binaryData?.length,
                  type: typeof binaryData,
                  isUint8Array: binaryData instanceof Uint8Array
                });
                return acc;
              }

              // Ensure we have a Uint8Array
              const uint8Array = binaryData instanceof Uint8Array 
                ? binaryData 
                : new Uint8Array(binaryData);

              if (uint8Array.length === 0) {
                console.error('Empty Uint8Array after conversion:', {
                  id,
                  originalLength: binaryData.length,
                  convertedLength: uint8Array.length
                });
                return acc;
              }

              console.log('Creating asset URL:', {
                id,
                mimeType,
                dataLength: uint8Array.length,
                firstFewBytes: Array.from(uint8Array.slice(0, 4))
              });

              // Create a blob from the Uint8Array
              const blob = new Blob([uint8Array], { type: mimeType });
              const assetUrl = URL.createObjectURL(blob);

              console.log('Asset URL created:', {
                id,
                urlLength: assetUrl.length,
                previewUrl: assetUrl.substring(0, 100) + '...'
              });

              return { ...acc, [id]: assetUrl };
            } catch (error) {
              console.error('Failed to create asset URL:', {
                id,
                error,
                data: data instanceof Uint8Array ? 'Uint8Array' : typeof data,
                hasData: Boolean(data),
                dataLength: data instanceof Uint8Array ? data.length : data?.data?.length
              });
              return acc;
            }
          }, {});

        console.log('Loaded assets:', Object.keys(loadedAssets));
        setAssetData(loadedAssets);
      } catch (error) {
        console.error("Failed to load layers:", error);
      }
    };

    loadLayers();
  }, [projectId, layers]);

  // Load canvas settings
  useEffect(() => {
    const loadCanvasSettings = async () => {
      try {
        const settings = await getCanvasSettings(projectId);
        setCanvasSize(settings);
      } catch (error) {
        console.error("Failed to load canvas settings:", error);
      }
    };
    loadCanvasSettings();
  }, [projectId]);

  // Handle layer selection
  const handleLayerClick = (e: React.MouseEvent, layerId: string) => {
    e.stopPropagation();
    // Don't change selection if we're editing text
    if (editingTextId) {
      return;
    }
    onLayerSelect(layerId);
  };

  // Handle canvas click (deselect)
  const handleCanvasClick = (e: React.MouseEvent) => {
    // Only deselect if clicking directly on the canvas background
    if (e.target === e.currentTarget || e.target === canvasRef.current) {
      onLayerSelect(null);
      setEditingTextId(null);
    }
  };

  // Handle layer dragging
  const handleMouseDown = (e: React.MouseEvent, layer: Layer) => {
    if (editingTextId === layer.id) return; // Don't start drag while editing text
    if (layer.id !== selectedLayerId || isResizing || isPanning) return;
    e.stopPropagation();
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

      console.log('Moving layer to:', { newX, newY });

      // Update local state immediately for smooth dragging
      setLayerData(prev => 
        prev.map(l => l.id === dragLayer.id ? {
          ...l,
          transform: {
            ...l.transform,
            x: newX,
            y: newY,
          },
        } : l)
      );
    };

    const handleMouseUp = () => {
      console.log('Ending drag for layer:', dragLayer.id);
      
      // Get the final position and update the database
      const layer = layerData.find(l => l.id === dragLayer.id);
      if (layer) {
        onLayerUpdate(layer);
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
      const layer = layerData.find(l => l.id === selectedLayerId);
      if (!layer) return;

      const MOVE_AMOUNT = 1;
      const ROTATE_AMOUNT = 1;
      const SCALE_AMOUNT = 0.01;
      const OPACITY_AMOUNT = 0.05;

      let newTransform = { ...layer.transform };

      switch (e.key) {
        case "ArrowLeft":
          newTransform.x -= MOVE_AMOUNT;
          break;
        case "ArrowRight":
          newTransform.x += MOVE_AMOUNT;
          break;
        case "ArrowUp":
          newTransform.y -= MOVE_AMOUNT;
          break;
        case "ArrowDown":
          newTransform.y += MOVE_AMOUNT;
          break;
        case "r":
          newTransform.rotation += ROTATE_AMOUNT;
          break;
        case "R":
          newTransform.rotation -= ROTATE_AMOUNT;
          break;
        case "+":
          newTransform.scale += SCALE_AMOUNT;
          break;
        case "-":
          newTransform.scale -= SCALE_AMOUNT;
          break;
        case "[":
          newTransform.opacity = Math.max(0, newTransform.opacity - OPACITY_AMOUNT);
          break;
        case "]":
          newTransform.opacity = Math.min(1, newTransform.opacity + OPACITY_AMOUNT);
          break;
        default:
          return;
      }

      onLayerUpdate({
        ...layer,
        transform: newTransform,
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLayerId, layerData, onLayerUpdate]);

  const handleFlipHorizontal = () => {
    const layer = layerData.find(l => l.id === selectedLayerId);
    if (!layer) return;

    onLayerUpdate({
      ...layer,
      transform: {
        ...layer.transform,
        scale: layer.transform.scale * -1, // Flip by inverting scale
      },
    });
  };

  const handleFlipVertical = () => {
    const layer = layerData.find(l => l.id === selectedLayerId);
    if (!layer) return;

    onLayerUpdate({
      ...layer,
      transform: {
        ...layer.transform,
        scale: layer.transform.scale * -1, // Flip by inverting scale
        rotation: layer.transform.rotation + 180, // Rotate to maintain orientation
      },
    });
  };

  const handleStartEraserMode = () => {
    setIsEraserMode(true);
    setEraserPath([]);
  };

  const handleEraserMouseMove = (e: React.MouseEvent) => {
    if (!isEraserMode || !isDragging) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setEraserPath(prev => [...prev, [x, y]]);
  };

  const handleSplitByTransparency = () => {
    if (eraserPath.length === 0) return;
    // TODO: Implement transparency-based splitting using the eraser path
    setIsEraserMode(false);
    setEraserPath([]);
  };

  const handleMoveForward = () => {
    const currentIndex = layers.find(l => l.id === selectedLayerId)?.index ?? 0;
    const nextLayer = layers
      .filter(l => l.id !== selectedLayerId)
      .find(l => l.index > currentIndex);
    if (nextLayer) {
      console.log('Moving layer forward:', {
        layerId: selectedLayerId,
        fromIndex: currentIndex,
        toIndex: nextLayer.index,
        affectedLayer: nextLayer.id
      });
      onLayerReorder(selectedLayerId!, nextLayer.index);
      logLayerOrder('After moving layer forward');
    }
  };

  const handleMoveBackward = () => {
    const currentIndex = layers.find(l => l.id === selectedLayerId)?.index ?? 0;
    const prevLayer = layers
      .filter(l => l.id !== selectedLayerId)
      .sort((a, b) => b.index - a.index)  // Sort in descending order to find closest lower index
      .find(l => l.index < currentIndex);
    if (prevLayer) {
      console.log('Moving layer backward:', {
        layerId: selectedLayerId,
        fromIndex: currentIndex,
        toIndex: prevLayer.index,
        affectedLayer: prevLayer.id
      });
      onLayerReorder(selectedLayerId!, prevLayer.index);
      logLayerOrder('After moving layer backward');
    }
  };

  const handleSegment = (mode: 'bounding-box' | 'auto' | 'semantic') => {
    // TODO: Implement segmentation using the selected mode
    console.log('Segmentation mode:', mode);
  };

  const handleTextDoubleClick = (e: React.MouseEvent, layer: Layer) => {
    if (layer.type !== 'text') return;
    e.stopPropagation();
    e.preventDefault(); // Prevent any drag start
    setEditingTextId(layer.id);
    onLayerSelect(layer.id);
  };

  // ContentEditable change handler. Grabs textContent from the editing div.
  const handleContentEditableChange = (e: React.FormEvent<HTMLDivElement>, layer: Layer) => {
    if (layer.type !== 'text') return;
    const newContent = e.currentTarget.textContent ?? "";
    if (newContent !== layer.content) {
      onLayerUpdate({
        ...layer,
        content: newContent,
      });
    }
  };

  const handleTextBlur = (e: React.FocusEvent) => {
    // Prevent blur if clicking within the toolbar, on elements marked with data-ignore-blur, or within a contenteditable
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (relatedTarget && (
      relatedTarget.closest('.text-toolbar') ||
      relatedTarget.closest('[data-ignore-blur]') ||
      relatedTarget.closest('[contenteditable="true"]')
    )) {
      return;
    }
    setEditingTextId(null);
  };

  const renderLayer = (layer: Layer) => {
    // Get the layer's current index from the layers prop
    const layerIndex = layers.find(l => l.id === layer.id)?.index ?? 0;
    const isSelected = selectedLayerId === layer.id;
    
    console.log('Rendering layer:', {
      id: layer.id,
      type: layer.type,
      index: layerIndex,
      zIndex: layerIndex * 10 // Use multiplier to leave room between indices
    });

    // Get layer element position for toolbar positioning
    const getLayerPosition = () => {
      if (!canvasRef.current) return { top: 0, left: 0 };
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const x = canvasRect.left + (layer.transform.x * zoom);
      const y = canvasRect.top + (layer.transform.y * zoom);
      return { top: y, left: x };
    };

    const commonProps = {
      className: cn(
        "absolute select-none",
        isSelected && "ring-2 ring-primary ring-offset-2",
        isDragging && isSelected ? "cursor-grabbing" : "cursor-grab",
        layer.type === 'text' && editingTextId === layer.id && "cursor-text"
      ),
      style: {
        transform: `translate(${layer.transform.x}px, ${layer.transform.y}px) 
                   rotate(${layer.transform.rotation}deg) 
                   scale(${layer.transform.scale})`,
        width: layer.transform.width,
        height: layer.transform.height,
        opacity: layer.transform.opacity,
        mixBlendMode: layer.transform.blendMode as React.CSSProperties['mixBlendMode'],
        zIndex: layerIndex * 10, // Use multiplier to leave room between indices
      },
      onClick: (e: React.MouseEvent) => handleLayerClick(e, layer.id),
      onMouseDown: (e: React.MouseEvent) => handleMouseDown(e, layer),
    };

    // Render toolbar in portal
    const renderToolbar = () => {
      if (!isSelected) return null;
      const pos = getLayerPosition();
      
      return createPortal(
        <div 
          className="fixed"
          style={{ 
            top: pos.top - 48,
            left: pos.left,
            transform: `scale(${zoom})`,
            transformOrigin: 'bottom left',
            zIndex: 9999,
          }}
        >
          {layer.type === 'text' ? (
            <TextLayerToolbar
              layer={layer as any}
              isEditing={editingTextId === layer.id}
              onMoveForward={handleMoveForward}
              onMoveBackward={handleMoveBackward}
              onDelete={() => onLayerDelete(layer.id)}
              onDuplicate={() => onLayerDuplicate(layer.id)}
              onUpdate={(updates) => onLayerUpdate({ ...layer, ...updates } as Layer)}
            />
          ) : (
            <LayerToolbar
              layer={layer}
              onFlipHorizontal={handleFlipHorizontal}
              onFlipVertical={handleFlipVertical}
              onStartEraserMode={handleStartEraserMode}
              onSplitByTransparency={handleSplitByTransparency}
              onMoveForward={handleMoveForward}
              onMoveBackward={handleMoveBackward}
              onDelete={() => onLayerDelete(layer.id)}
              onDuplicate={() => onLayerDuplicate(layer.id)}
              onSegment={handleSegment}
            />
          )}
        </div>,
        document.body
      );
    };

    switch (layer.type) {
      case 'image':
      case 'sticker': {
        const assetId = layer.type === 'image' ? layer.imageAssetId : layer.stickerAssetId;
        const assetUrl = assetData[assetId];
        
        if (!assetUrl) {
          return (
            <div key={layer.id} {...commonProps}>
              <div className="w-full h-full bg-red-500/20 flex items-center justify-center">
                <span className="text-red-500">Failed to load image</span>
              </div>
              {renderToolbar()}
            </div>
          );
        }

        return (
          <div key={layer.id} {...commonProps}>
            <img
              src={assetUrl}
              alt=""
              className="w-full h-full object-contain"
              draggable={false}
            />
            <div className="absolute inset-0 border-2 border-dashed border-primary border-opacity-50" />
            {/* Resize handles */}
            {isSelected && (
              <>
                <div className="absolute -top-1 -left-1 w-2 h-2 bg-primary rounded-full cursor-nw-resize transform -translate-x-1/2 -translate-y-1/2"
                  onMouseDown={(e) => handleResizeStart(e, 'nw')} />
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full cursor-ne-resize transform translate-x-1/2 -translate-y-1/2"
                  onMouseDown={(e) => handleResizeStart(e, 'ne')} />
                <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-primary rounded-full cursor-sw-resize transform -translate-x-1/2 translate-y-1/2"
                  onMouseDown={(e) => handleResizeStart(e, 'sw')} />
                <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-primary rounded-full cursor-se-resize transform translate-x-1/2 translate-y-1/2"
                  onMouseDown={(e) => handleResizeStart(e, 'se')} />
                <div className="absolute top-1/2 -left-1 w-2 h-2 bg-primary rounded-full cursor-w-resize transform -translate-x-1/2 -translate-y-1/2"
                  onMouseDown={(e) => handleResizeStart(e, 'w')} />
                <div className="absolute top-1/2 -right-1 w-2 h-2 bg-primary rounded-full cursor-e-resize transform translate-x-1/2 -translate-y-1/2"
                  onMouseDown={(e) => handleResizeStart(e, 'e')} />
                <div className="absolute -top-1 left-1/2 w-2 h-2 bg-primary rounded-full cursor-n-resize transform -translate-x-1/2 -translate-y-1/2"
                  onMouseDown={(e) => handleResizeStart(e, 'n')} />
                <div className="absolute -bottom-1 left-1/2 w-2 h-2 bg-primary rounded-full cursor-s-resize transform -translate-x-1/2 translate-y-1/2"
                  onMouseDown={(e) => handleResizeStart(e, 's')} />
              </>
            )}
            {renderToolbar()}
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
              "flex items-center justify-center overflow-visible",
              layer.style.wordWrap === 'break-word' && "whitespace-normal break-words",
              layer.style.wordWrap === 'normal' && "whitespace-nowrap",
              isEditing && "cursor-text"
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
                  className="w-full h-full bg-transparent outline-none"
                  style={{
                    fontFamily: layer.style.fontFamily,
                    fontSize: layer.style.fontSize,
                    fontWeight: layer.style.fontWeight,
                    color: layer.style.color,
                    backgroundColor: layer.style.backgroundColor || 'transparent',
                    textAlign: layer.style.textAlign,
                    fontStyle: layer.style.italic ? 'italic' : 'normal',
                    textDecoration: layer.style.underline ? 'underline' : 'none',
                    display: 'flex',
                    alignItems:
                      layer.style.verticalAlign === 'top'
                        ? 'flex-start'
                        : layer.style.verticalAlign === 'bottom'
                        ? 'flex-end'
                        : 'center',
                    justifyContent:
                      layer.style.textAlign === 'left'
                        ? 'flex-start'
                        : layer.style.textAlign === 'right'
                        ? 'flex-end'
                        : 'center',
                    whiteSpace: layer.style.wordWrap === 'break-word' ? 'pre-wrap' : 'pre',
                    overflow: 'hidden',
                    width: '100%',
                    height: '100%',
                    userSelect: 'text',
                    cursor: 'text',
                    wordBreak: layer.style.wordWrap === 'break-word' ? 'break-word' : 'normal',
                    wordWrap: layer.style.wordWrap,
                    pointerEvents: 'auto',
                    '--text-stroke-width': layer.style.stroke?.enabled ? `${layer.style.stroke.width}px` : '0',
                    '--text-stroke-color': layer.style.stroke?.enabled ? layer.style.stroke.color : 'transparent',
                    WebkitTextStrokeWidth: 'var(--text-stroke-width)',
                    WebkitTextStrokeColor: 'var(--text-stroke-color)',
                  } as React.CSSProperties}
                >
                  {layer.content}
                </div>
              </>
            ) : (
              // Non-editing view
              <div
                className="w-full h-full"
                onClick={(e) => handleLayerClick(e, layer.id)}
                onMouseDown={(e) => handleMouseDown(e, layer)}
                style={{
                  fontFamily: layer.style.fontFamily,
                  fontSize: layer.style.fontSize,
                  fontWeight: layer.style.fontWeight,
                  color: layer.style.color,
                  backgroundColor: layer.style.backgroundColor || 'transparent',
                  textAlign: layer.style.textAlign,
                  fontStyle: layer.style.italic ? 'italic' : 'normal',
                  textDecoration: layer.style.underline ? 'underline' : 'none',
                  display: 'flex',
                  alignItems:
                    layer.style.verticalAlign === 'top'
                      ? 'flex-start'
                      : layer.style.verticalAlign === 'bottom'
                      ? 'flex-end'
                      : 'center',
                  justifyContent:
                    layer.style.textAlign === 'left'
                      ? 'flex-start'
                      : layer.style.textAlign === 'right'
                      ? 'flex-end'
                      : 'center',
                  whiteSpace: layer.style.wordWrap === 'break-word' ? 'pre-wrap' : 'pre',
                  wordBreak: layer.style.wordWrap === 'break-word' ? 'break-word' : 'normal',
                  wordWrap: layer.style.wordWrap,
                  '--text-stroke-width': layer.style.stroke?.enabled ? `${layer.style.stroke.width}px` : '0',
                  '--text-stroke-color': layer.style.stroke?.enabled ? layer.style.stroke.color : 'transparent',
                  WebkitTextStrokeWidth: 'var(--text-stroke-width)',
                  WebkitTextStrokeColor: 'var(--text-stroke-color)',
                } as React.CSSProperties}
              >
                {layer.content}
              </div>
            )}
            
            {/* Selection border and toolbars */}
            {selectedLayerId === layer.id && (
              <>
                <div className="absolute inset-0 border-2 border-dashed border-primary border-opacity-50" />
                {renderToolbar()}
              </>
            )}
          </div>
        );
      }
    }
  };

  // Handle zooming
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
      setViewportOffset(prev => ({
        x: prev.x + newOffsetX,
        y: prev.y + newOffsetY,
      }));
    }
    
    setZoom(newZoom);
  };

  // Handle wheel events for trackpad gestures
  const handleWheel = (e: WheelEvent) => {
    // Check if it's a pinch gesture (ctrl/cmd + wheel)
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const delta = -e.deltaY * 0.001; // Adjust sensitivity
      handleZoom(delta, e.clientX, e.clientY);
    } else if (e.shiftKey) {
      // Horizontal scroll with shift
      e.preventDefault();
      setViewportOffset(prev => ({
        x: prev.x - e.deltaY,
        y: prev.y,
      }));
    } else {
      // Normal scroll
      e.preventDefault();
      setViewportOffset(prev => ({
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
      y: e.clientY - viewportOffset.y 
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

  // Handle resize
  const handleResizeStart = (
    e: React.MouseEvent<HTMLDivElement>, 
    handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  ) => {
    if (!selectedLayerId) return;
    
    e.stopPropagation();
    e.preventDefault();
    
    const layer = layerData.find(l => l.id === selectedLayerId);
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

  const handleResizeMove = (e: MouseEvent | React.MouseEvent) => {
    if (!isResizing || !resizeHandle || !selectedLayerId) return;

    const layer = layerData.find(l => l.id === selectedLayerId);
    if (!layer) return;

    const deltaX = (e.clientX - resizeStart.x) / zoom;
    const deltaY = (e.clientY - resizeStart.y) / zoom;
    let newWidth = resizeStart.width;
    let newHeight = resizeStart.height;
    let newX = layer.transform.x;
    let newY = layer.transform.y;

    // Handle different resize directions
    if (resizeHandle.includes('e')) {
      newWidth = Math.max(50, resizeStart.width + deltaX);
    }
    if (resizeHandle.includes('w')) {
      const width = Math.max(50, resizeStart.width - deltaX);
      newX = layer.transform.x + (resizeStart.width - width);
      newWidth = width;
    }
    if (resizeHandle.includes('s')) {
      newHeight = Math.max(50, resizeStart.height + deltaY);
    }
    if (resizeHandle.includes('n')) {
      const height = Math.max(50, resizeStart.height - deltaY);
      newY = layer.transform.y + (resizeStart.height - height);
      newHeight = height;
    }

    // Update layer with new dimensions
    setLayerData(prev => 
      prev.map(l => l.id === selectedLayerId ? {
        ...l,
        transform: {
          ...l.transform,
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
        },
      } : l)
    );
  };

  const handleResizeEnd = () => {
    if (isResizing && selectedLayerId) {
      const layer = layerData.find(l => l.id === selectedLayerId);
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
      newWidth = Math.min(MAX_SIZE, Math.max(MIN_SIZE, canvasResizeStart.width + deltaX));
    } else if (canvasResizeHandle.includes('w')) {
      const widthDelta = deltaX;
      newWidth = Math.min(MAX_SIZE, Math.max(MIN_SIZE, canvasResizeStart.width - widthDelta));
      if (newWidth !== canvasResizeStart.width) {
        newX = viewportOffset.x + (canvasResizeStart.width - newWidth) * zoom;
      }
    }

    if (canvasResizeHandle.includes('s')) {
      newHeight = Math.min(MAX_SIZE, Math.max(MIN_SIZE, canvasResizeStart.height + deltaY));
    } else if (canvasResizeHandle.includes('n')) {
      const heightDelta = deltaY;
      newHeight = Math.min(MAX_SIZE, Math.max(MIN_SIZE, canvasResizeStart.height - heightDelta));
      if (newHeight !== canvasResizeStart.height) {
        newY = viewportOffset.y + (canvasResizeStart.height - newHeight) * zoom;
      }
    }

    // For corner handles, maintain aspect ratio if shift is held
    if (canvasResizeHandle.length === 2 && e instanceof MouseEvent && e.shiftKey) {
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

    setCanvasSize({
      width: newWidth,
      height: newHeight,
    });

    setViewportOffset({
      x: newX,
      y: newY,
    });
  };

  const handleCanvasResizeEnd = async () => {
    if (isCanvasResizing) {
      try {
        await updateCanvasSettings(projectId, {
          width: Math.round(canvasSize.width),
          height: Math.round(canvasSize.height),
        });
      } catch (error) {
        console.error("Failed to update canvas settings:", error);
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

  const compareLayersForRender = (a: Layer, b: Layer) => {
    const aIndex = layers.find(l => l.id === a.id)?.index ?? 0;
    const bIndex = layers.find(l => l.id === b.id)?.index ?? 0;
    console.log('Comparing layers for render:', {
      a: { id: a.id, type: a.type, index: aIndex },
      b: { id: b.id, type: b.type, index: bIndex },
      result: aIndex - bIndex
    });
    return aIndex - bIndex;
  };

  return (
    <div className={cn("relative overflow-hidden bg-neutral-900", className)}>
      {/* Infinite scrollable workspace */}
      <div
        ref={workspaceRef}
        className="absolute inset-0 overflow-auto"
        onMouseDown={(e) => {
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
        onClick={handleCanvasClick}
      >
        <div 
          className="relative"
          style={{ 
            width: `${Math.round(workspaceRef.current?.clientWidth || 0)}px`,
            height: `${Math.round(workspaceRef.current?.clientHeight || 0)}px`,
          }}
        >
          {/* Canvas container */}
          <div 
            className="absolute"
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
              className="absolute bg-background shadow-2xl rounded-lg overflow-hidden border border-border/20"
              style={{
                width: `${Math.round(canvasSize.width)}px`,
                height: `${Math.round(canvasSize.height)}px`,
                transform: `scale(${Number(zoom.toFixed(3))})`,
                transformOrigin: "0 0",
              }}
            >
              {/* Canvas grid background */}
              <div 
                className="absolute inset-0 pointer-events-none opacity-5"
                style={{
                  backgroundImage: `
                    linear-gradient(to right, gray 1px, transparent 1px),
                    linear-gradient(to bottom, gray 1px, transparent 1px)
                  `,
                  backgroundSize: '20px 20px'
                }}
              />

              {/* Render layers */}
              {layerData
                .sort(compareLayersForRender)
                .map(layer => {
                  const layerIndex = layers.find(l => l.id === layer.id)?.index ?? 0;
                  console.log('Rendering layer:', {
                    id: layer.id,
                    type: layer.type,
                    index: layerIndex,
                    zIndex: layerIndex * 10 // Use multiplier to leave room between indices
                  });
                  return renderLayer(layer);
                })}
              
              {/* Eraser path overlay */}
              {isEraserMode && eraserPath.length > 0 && (
                <svg className="absolute inset-0 pointer-events-none">
                  <path
                    d={`M ${eraserPath[0][0]} ${eraserPath[0][1]} ${eraserPath
                      .slice(1)
                      .map(([x, y]) => `L ${x} ${y}`)
                      .join(' ')}`}
                    stroke="black"
                    strokeWidth="2"
                    fill="none"
                  />
                </svg>
              )}
            </div>

            {/* Canvas resize handles */}
            {showCanvasResizeHandles && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Corner handles */}
                <div
                  className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-primary rounded-full cursor-nw-resize pointer-events-auto ring-2 ring-background"
                  onMouseDown={(e) => handleCanvasResizeStart(e, 'nw')}
                />
                <div
                  className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-primary rounded-full cursor-ne-resize pointer-events-auto ring-2 ring-background"
                  onMouseDown={(e) => handleCanvasResizeStart(e, 'ne')}
                />
                <div
                  className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-primary rounded-full cursor-sw-resize pointer-events-auto ring-2 ring-background"
                  onMouseDown={(e) => handleCanvasResizeStart(e, 'sw')}
                />
                <div
                  className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-primary rounded-full cursor-se-resize pointer-events-auto ring-2 ring-background"
                  onMouseDown={(e) => handleCanvasResizeStart(e, 'se')}
                />

                {/* Edge handles */}
                <div
                  className="absolute -top-1.5 left-1/2 w-3 h-3 bg-primary rounded-full cursor-n-resize -translate-x-1/2 pointer-events-auto ring-2 ring-background"
                  onMouseDown={(e) => handleCanvasResizeStart(e, 'n')}
                />
                <div
                  className="absolute -bottom-1.5 left-1/2 w-3 h-3 bg-primary rounded-full cursor-s-resize -translate-x-1/2 pointer-events-auto ring-2 ring-background"
                  onMouseDown={(e) => handleCanvasResizeStart(e, 's')}
                />
                <div
                  className="absolute -left-1.5 top-1/2 w-3 h-3 bg-primary rounded-full cursor-w-resize -translate-y-1/2 pointer-events-auto ring-2 ring-background"
                  onMouseDown={(e) => handleCanvasResizeStart(e, 'w')}
                />
                <div
                  className="absolute -right-1.5 top-1/2 w-3 h-3 bg-primary rounded-full cursor-e-resize -translate-y-1/2 pointer-events-auto ring-2 ring-background"
                  onMouseDown={(e) => handleCanvasResizeStart(e, 'e')}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => handleZoom(0.1)}
          className="rounded-full bg-background/80 backdrop-blur-sm shadow-lg hover:bg-accent"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => handleZoom(-0.1)}
          className="rounded-full bg-background/80 backdrop-blur-sm shadow-lg hover:bg-accent"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => {
            centerAndFitCanvas();
            // Only toggle panning if it's not already active
            if (isPanning) {
              setIsPanning(false);
            }
          }}
          className={cn(
            "rounded-full bg-background/80 backdrop-blur-sm shadow-lg hover:bg-accent",
            isPanning && "bg-accent text-accent-foreground"
          )}
          title="Center Canvas (Ctrl/Cmd + 0)"
        >
          <Move className="h-4 w-4" />
        </Button>
      </div>

      {/* Canvas dimensions display */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-background/80 backdrop-blur-sm text-xs text-muted-foreground">
        {canvasSize.width} × {canvasSize.height}
      </div>
    </div>
  );
}