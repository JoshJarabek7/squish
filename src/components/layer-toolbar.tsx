import { useState } from "react";
import { Layer, TextLayer } from "@/types/ProjectType";
import { 
  FlipHorizontal, 
  FlipVertical, 
  Eraser, 
  Scissors,
  MoveUp,
  MoveDown,
  Trash2,
  Copy,
  Scan,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { TextToolbar } from "@/components/text-toolbar";

interface LayerToolbarProps {
  layer: Layer;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onStartEraserMode: () => void;
  onSplitByTransparency: () => void;
  onMoveForward: () => void;
  onMoveBackward: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSegment: (mode: 'bounding-box' | 'auto' | 'semantic') => void;
  style?: React.CSSProperties;
}

interface TextLayerToolbarProps {
  layer: TextLayer;
  isEditing: boolean;
  onMoveForward: () => void;
  onMoveBackward: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdate: (updates: Partial<TextLayer>) => void;
  style?: React.CSSProperties;
}

export function TextLayerToolbar({
  layer,
  isEditing,
  onMoveForward,
  onMoveBackward,
  onDelete,
  onDuplicate,
  onUpdate,
  style,
}: TextLayerToolbarProps) {
  return (
    <div 
      className="absolute -top-24 left-1/2 -translate-x-1/2 flex flex-col gap-2 p-2 bg-background/95 backdrop-blur-sm rounded-lg shadow-lg border z-[100]"
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Layer controls (always visible) */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onMoveForward}
          title="Bring Forward"
        >
          <MoveUp className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onMoveBackward}
          title="Send Backward"
        >
          <MoveDown className="h-4 w-4" />
        </Button>

        <div className="w-px h-4 bg-border mx-1" />

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onDuplicate}
          title="Duplicate Layer"
        >
          <Copy className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive"
          onClick={onDelete}
          title="Delete Layer"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Text editing controls */}
      <div className="flex items-center gap-1">
        <TextToolbar
          layer={layer}
          onUpdate={onUpdate}
          isEditing={isEditing}
        />
      </div>
    </div>
  );
}

export function LayerToolbar({
  layer,
  onFlipHorizontal,
  onFlipVertical,
  onStartEraserMode,
  onSplitByTransparency,
  onMoveForward,
  onMoveBackward,
  onDelete,
  onDuplicate,
  onSegment,
  style,
}: LayerToolbarProps) {
  const [segmentationOpen, setSegmentationOpen] = useState(false);

  if (layer.type === 'text') return null;

  return (
    <div 
      className="absolute -top-12 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 bg-background/80 backdrop-blur-sm rounded-lg shadow-lg border z-[100]"
      style={style}
      // Only stopPropagation; remove e.preventDefault so it doesn't block child UI events.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onFlipHorizontal}
        title="Flip Horizontally"
      >
        <FlipHorizontal className="h-4 w-4" />
      </Button>
      
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onFlipVertical}
        title="Flip Vertically"
      >
        <FlipVertical className="h-4 w-4" />
      </Button>

      <div className="w-px h-4 bg-border mx-1" />

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onStartEraserMode}
        title="Eraser Tool"
      >
        <Eraser className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onSplitByTransparency}
        title="Split by Transparency"
      >
        <Scissors className="h-4 w-4" />
      </Button>

      <Dialog open={segmentationOpen} onOpenChange={setSegmentationOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Segment Image"
          >
            <Scan className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Segment Image</DialogTitle>
            <DialogDescription>
              Choose a segmentation mode to extract parts of the image.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ToggleGroup
              type="single"
              onValueChange={(value) => {
                if (value) {
                  onSegment(value as 'bounding-box' | 'auto' | 'semantic');
                  setSegmentationOpen(false);
                }
              }}
            >
              <ToggleGroupItem value="bounding-box">
                Bounding Box
              </ToggleGroupItem>
              <ToggleGroupItem value="auto">
                Auto
              </ToggleGroupItem>
              <ToggleGroupItem value="semantic">
                Semantic
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </DialogContent>
      </Dialog>

      <div className="w-px h-4 bg-border mx-1" />

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onMoveForward}
        title="Bring Forward"
      >
        <MoveUp className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onMoveBackward}
        title="Send Backward"
      >
        <MoveDown className="h-4 w-4" />
      </Button>

      <div className="w-px h-4 bg-border mx-1" />

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onDuplicate}
        title="Duplicate Layer"
      >
        <Copy className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive"
        onClick={onDelete}
        title="Delete Layer"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}