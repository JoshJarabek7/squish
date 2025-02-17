import { TextLayer } from "@/types/ProjectType";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  Italic,
  WrapText,
  Loader2,
  Palette,
  Square,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface TextToolbarProps {
  layer: TextLayer;
  onUpdate: (updates: Partial<TextLayer>) => void;
  isEditing: boolean;
  style?: React.CSSProperties;
}

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72];

const FALLBACK_FONTS = [
  "Arial",
  "Times New Roman",
  "Helvetica",
  "Courier New",
  "Georgia",
  "Verdana",
  "Inter",
];

let systemFontsCache: string[] | null = null;

export function TextToolbar({ layer, onUpdate, isEditing, style }: TextToolbarProps) {
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [loadingFonts, setLoadingFonts] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  useEffect(() => {
    const loadSystemFonts = async () => {
      try {
        // Use cached fonts if available
        if (systemFontsCache) {
          console.log('Using cached system fonts');
          setSystemFonts(systemFontsCache);
          setLoadingFonts(false);
          return;
        }

        console.log("Starting to load system fonts...");
        setLoadingFonts(true);

        const fonts = await invoke<string[]>("get_system_fonts");
        console.log("Received fonts from backend:", fonts);

        if (fonts && fonts.length > 0) {
          // Sort fonts and remove duplicates
          const uniqueFonts = Array.from(new Set(fonts)).sort();
          console.log(`Setting ${uniqueFonts.length} system fonts`);
          setSystemFonts(uniqueFonts);
          setLoadingFonts(false);
          // Cache the fonts for future use
          systemFontsCache = uniqueFonts;

          // If current font is not in the list, switch to a fallback
          if (!uniqueFonts.includes(layer.style.fontFamily)) {
            onUpdate({
              style: {
                ...layer.style,
                fontFamily: FALLBACK_FONTS[0],
              },
            });
          }
        } else {
          throw new Error("No fonts returned");
        }
      } catch (error) {
        console.error("Failed to load system fonts:", error);
        
        if (retryCount < maxRetries) {
          console.log(`Retrying font load (attempt ${retryCount + 1}/${maxRetries})...`);
          setRetryCount(prev => prev + 1);
          setTimeout(loadSystemFonts, 1000); // Retry after 1 second
        } else {
          console.log("Using fallback fonts after max retries");
          setSystemFonts(FALLBACK_FONTS);
          setLoadingFonts(false);
          
          // Ensure we're using a fallback font
          if (!FALLBACK_FONTS.includes(layer.style.fontFamily)) {
            onUpdate({
              style: {
                ...layer.style,
                fontFamily: FALLBACK_FONTS[0],
              },
            });
          }
          
          toast.error("Failed to load system fonts, using fallbacks");
        }
      }
    };

    loadSystemFonts();
  }, []); // Remove dependencies to only load fonts once

  const handleHorizontalAlign = (align: 'left' | 'center' | 'right') => {
    onUpdate({
      style: {
        ...layer.style,
        textAlign: align,
      },
    });
  };

  const handleVerticalAlign = (align: 'top' | 'center' | 'bottom') => {
    onUpdate({
      style: {
        ...layer.style,
        verticalAlign: align,
      },
    });
  };

  const handleWordWrap = (enabled: boolean) => {
    onUpdate({
      style: {
        ...layer.style,
        wordWrap: enabled ? 'break-word' : 'normal',
      },
    });
  };

  const handleFontFamily = (family: string) => {
    if (!loadingFonts && systemFonts.includes(family)) {
      onUpdate({
        style: {
          ...layer.style,
          fontFamily: family,
        },
      });
    }
  };

  const handleFontSize = (size: string) => {
    onUpdate({
      style: {
        ...layer.style,
        fontSize: parseInt(size, 10),
      },
    });
  };

  const handleBold = () => {
    onUpdate({
      style: {
        ...layer.style,
        fontWeight: layer.style.fontWeight === 700 ? 400 : 700,
      },
    });
  };

  const handleItalic = () => {
    onUpdate({
      style: {
        ...layer.style,
        italic: !layer.style.italic,
      },
    });
  };

  const handleTextColor = (color: string) => {
    onUpdate({
      style: {
        ...layer.style,
        color,
      },
    });
  };

  const handleBackgroundColor = (color: string) => {
    onUpdate({
      style: {
        ...layer.style,
        backgroundColor: color,
      },
    });
  };

  const handleStrokeColor = (color: string) => {
    onUpdate({
      style: {
        ...layer.style,
        stroke: {
          ...(layer.style.stroke || { width: 1, enabled: true }),
          color,
        },
      },
    });
  };

  const handleStrokeWidth = (width: number) => {
    onUpdate({
      style: {
        ...layer.style,
        stroke: {
          ...(layer.style.stroke || { color: '#000000', enabled: true }),
          width,
        },
      },
    });
  };

  const handleStrokeToggle = () => {
    onUpdate({
      style: {
        ...layer.style,
        stroke: layer.style.stroke?.enabled
          ? { ...layer.style.stroke, enabled: false }
          : { width: 1, color: '#000000', enabled: true },
      },
    });
  };

  return (
    <div 
      className="absolute -top-14 left-1/2 -translate-x-1/2 flex items-center gap-1 p-2 bg-background/95 backdrop-blur-sm rounded-lg shadow-lg border z-[100]"
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onPointerDownCapture={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onMouseDownCapture={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      {/* Font Family */}
      <Select
        value={layer.style.fontFamily}
        onValueChange={handleFontFamily}
        disabled={loadingFonts}
        onOpenChange={(open) => {
          console.log('Font dropdown open state:', open);
        }}
      >
        <SelectTrigger 
          className="w-[120px] h-8"
          onClick={(e) => {
            console.log('Font trigger clicked');
            e.stopPropagation();
          }}
        >
          <SelectValue>
            {loadingFonts ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : (
              <span style={{ fontFamily: layer.style.fontFamily }}>
                {layer.style.fontFamily}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent 
          className="max-h-[300px] bg-popover z-[9999]"
          align="center"
          side="top"
          sideOffset={4}
          position="popper"
          avoidCollisions={false}
        >
          <SelectGroup>
            {systemFonts.map(font => (
              <SelectItem 
                key={font} 
                value={font}
                className="cursor-pointer"
              >
                <span style={{ fontFamily: font }}>{font}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {/* Font Size */}
      <Select
        value={layer.style.fontSize.toString()}
        onValueChange={handleFontSize}
        onOpenChange={(open) => {
          console.log('Font size dropdown open state:', open);
        }}
      >
        <SelectTrigger 
          className="w-[70px] h-8"
          onClick={(e) => {
            console.log('Font size trigger clicked');
            e.stopPropagation();
          }}
        >
          <SelectValue placeholder="Size" />
        </SelectTrigger>
        <SelectContent
          className="max-h-[300px] bg-popover z-[9999]"
          align="center"
          side="top"
          sideOffset={4}
          position="popper"
          avoidCollisions={false}
        >
          {FONT_SIZES.map(size => (
            <SelectItem 
              key={size} 
              value={size.toString()}
              className="cursor-pointer"
            >
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Bold & Italic */}
      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${layer.style.fontWeight === 700 ? 'bg-accent' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleBold();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        title="Bold"
      >
        <Bold className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${layer.style.italic ? 'bg-accent' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleItalic();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        title="Italic"
      >
        <Italic className="h-4 w-4" />
      </Button>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Horizontal Alignment */}
      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${layer.style.textAlign === 'left' ? 'bg-accent' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleHorizontalAlign('left');
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        title="Align Left"
      >
        <AlignHorizontalJustifyStart className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${layer.style.textAlign === 'center' ? 'bg-accent' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleHorizontalAlign('center');
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        title="Align Center"
      >
        <AlignHorizontalJustifyCenter className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${layer.style.textAlign === 'right' ? 'bg-accent' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleHorizontalAlign('right');
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        title="Align Right"
      >
        <AlignHorizontalJustifyEnd className="h-4 w-4" />
      </Button>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Vertical Alignment */}
      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${layer.style.verticalAlign === 'top' ? 'bg-accent' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleVerticalAlign('top');
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        title="Align Top"
      >
        <AlignVerticalJustifyStart className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${layer.style.verticalAlign === 'center' ? 'bg-accent' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleVerticalAlign('center');
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        title="Align Middle"
      >
        <AlignVerticalJustifyCenter className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${layer.style.verticalAlign === 'bottom' ? 'bg-accent' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleVerticalAlign('bottom');
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        title="Align Bottom"
      >
        <AlignVerticalJustifyEnd className="h-4 w-4" />
      </Button>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Word Wrap Toggle */}
      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${layer.style.wordWrap === 'break-word' ? 'bg-accent' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleWordWrap(layer.style.wordWrap !== 'break-word');
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        title="Word Wrap"
      >
        <WrapText className="h-4 w-4" />
      </Button>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Text Color */}
      <Popover modal={true}>
        <PopoverTrigger>
          <div
            className={cn(
              "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8 relative"
            )}
          >
            <Palette className="h-4 w-4" />
            <div 
              className="absolute bottom-1 right-1 w-2 h-2 rounded-full ring-1 ring-border"
              style={{ backgroundColor: layer.style.color }}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent 
          className="w-48 p-2 bg-popover z-[9999]"
          align="center"
          side="top"
          sideOffset={4}
        >
          <div className="grid grid-cols-5 gap-1">
            {[
              '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
              '#FFFF00', '#FF00FF', '#00FFFF', '#808080', '#C0C0C0',
              '#800000', '#008000', '#000080', '#808000', '#800080',
              '#008080', '#FFA500', '#FFC0CB', '#A52A2A', '#32CD32'
            ].map((color) => (
              <button
                key={color}
                className="h-6 w-6 rounded-md border border-border hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
                onClick={() => handleTextColor(color)}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Background Color */}
      <Popover modal={true}>
        <PopoverTrigger>
          <div
            className={cn(
              "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8 relative"
            )}
          >
            <Square className="h-4 w-4" />
            <div 
              className="absolute bottom-1 right-1 w-2 h-2 rounded-full ring-1 ring-border"
              style={{ backgroundColor: layer.style.backgroundColor || 'transparent' }}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent 
          className="w-48 p-2 bg-popover z-[9999]"
          align="center"
          side="top"
          sideOffset={4}
        >
          <div className="grid grid-cols-5 gap-1">
            <button
              className="h-6 w-6 rounded-md border border-border hover:scale-110 transition-transform bg-transparent flex items-center justify-center"
              onClick={() => handleBackgroundColor('transparent')}
            >
              <Square className="h-4 w-4" />
            </button>
            {[
              '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
              '#FF00FF', '#00FFFF', '#808080', '#C0C0C0', '#800000',
              '#008000', '#000080', '#808000', '#800080', '#008080',
              '#FFA500', '#FFC0CB', '#A52A2A', '#32CD32'
            ].map((color) => (
              <button
                key={color}
                className="h-6 w-6 rounded-md border border-border hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
                onClick={() => handleBackgroundColor(color)}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Text Stroke Controls */}
      <Popover modal={true}>
        <PopoverTrigger>
          <div
            className={cn(
              "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8 relative",
              layer.style.stroke?.enabled && "bg-accent"
            )}
          >
            <Type className="h-4 w-4" />
            <div 
              className="absolute bottom-1 right-1 w-2 h-2 rounded-full ring-1 ring-border"
              style={{ backgroundColor: layer.style.stroke?.color || '#000000' }}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent 
          className="w-48 p-2 bg-popover z-[9999]"
          align="center"
          side="top"
          sideOffset={4}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">Enable Outline</span>
              <Button
                variant="ghost"
                size="sm"
                className={layer.style.stroke?.enabled ? 'bg-accent' : ''}
                onClick={handleStrokeToggle}
              >
                {layer.style.stroke?.enabled ? 'On' : 'Off'}
              </Button>
            </div>
            
            {layer.style.stroke?.enabled && (
              <>
                <div className="space-y-1">
                  <span className="text-sm">Width</span>
                  <Select
                    value={layer.style.stroke.width.toString()}
                    onValueChange={(value) => handleStrokeWidth(Number(value))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((width) => (
                        <SelectItem key={width} value={width.toString()}>
                          {width}px
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <span className="text-sm">Color</span>
                  <div className="grid grid-cols-5 gap-1">
                    {[
                      '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
                      '#FFFF00', '#FF00FF', '#00FFFF', '#808080', '#C0C0C0'
                    ].map((color) => (
                      <button
                        key={color}
                        className="h-6 w-6 rounded-md border border-border hover:scale-110 transition-transform"
                        style={{ backgroundColor: color }}
                        onClick={() => handleStrokeColor(color)}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
} 