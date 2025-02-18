import { TextLayer } from '@/types/ProjectType';
import { useEffect, useState, forwardRef } from 'react';
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
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getEnabledFonts, DEFAULT_FONTS } from '@/lib/db';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';

// Create a custom hook for font loading
function useFonts() {
  const [fonts, setFonts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load fonts once on mount
  useEffect(() => {
    let mounted = true;

    const loadFonts = async () => {
      try {
        const fonts = await getEnabledFonts();
        if (mounted) {
          setFonts(fonts);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Failed to load fonts:', error);
        if (mounted) {
          toast.error('Failed to load fonts, using defaults');
          setFonts(Array.from(DEFAULT_FONTS));
          setIsLoading(false);
        }
      }
    };

    loadFonts();
    return () => {
      mounted = false;
    };
  }, []); // Empty deps since we only want to load once

  return { fonts, isLoading };
}

interface TextToolbarProps {
  layer: TextLayer;
  onUpdate: (updates: Partial<TextLayer>) => void;
  className?: string;
}

const FONT_SIZES = [
  8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 112,
  128,
];

const ColorButton = forwardRef<
  HTMLButtonElement,
  {
    color: string;
    icon: React.ReactNode;
    indicatorColor?: string;
    isActive?: boolean;
    onClick?: () => void;
  }
>(({ color, icon, indicatorColor, isActive, onClick }, ref) => (
  <Button
    ref={ref}
    variant='ghost'
    size='icon'
    className={cn('h-8 w-8 relative', isActive && 'bg-accent')}
    onClick={onClick}
  >
    {icon}
    <div
      className='absolute bottom-1 right-1 w-2 h-2 rounded-full ring-1 ring-border'
      style={{ backgroundColor: indicatorColor || color }}
    />
  </Button>
));
ColorButton.displayName = 'ColorButton';

export function TextToolbar({ layer, onUpdate, className }: TextToolbarProps) {
  const { fonts, isLoading } = useFonts();
  const [isOpen, setIsOpen] = useState(true);

  const handleInvalidFont = () => {
    if (
      !isLoading &&
      fonts.length > 0 &&
      !fonts.includes(layer.style.fontFamily)
    ) {
      onUpdate({
        style: {
          ...layer.style,
          fontFamily: DEFAULT_FONTS[0],
        },
      });
    }
  };

  // Check font validity whenever fonts or current font changes
  useEffect(() => {
    handleInvalidFont();
  }, [fonts, layer.style.fontFamily]);

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
    if (!isLoading && fonts.includes(family)) {
      onUpdate({
        ...layer,
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
      className={cn(
        'absolute top-full left-0 right-0 z-[1000] bg-background border-b',
        className
      )}
    >
      <div className='h-10 flex-none'>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant='ghost' size='sm' className='w-full h-10 gap-2'>
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform',
                  isOpen ? 'rotate-180' : ''
                )}
              />
              Text Controls
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className='bg-background border-b shadow-md'>
            <div className='flex items-center justify-center gap-2 px-4 py-2'>
              {/* Font Family */}
              <Select
                value={layer.style.fontFamily}
                onValueChange={handleFontFamily}
                disabled={isLoading}
              >
                <SelectTrigger className='w-[180px] whitespace-nowrap'>
                  {isLoading ? (
                    <div className='flex items-center gap-2'>
                      <Loader2 className='h-4 w-4 animate-spin' />
                      <span>Loading...</span>
                    </div>
                  ) : (
                    <span style={{ fontFamily: layer.style.fontFamily }}>
                      {layer.style.fontFamily}
                    </span>
                  )}
                </SelectTrigger>
                <SelectContent
                  className='max-h-[300px]'
                  align='start'
                  side='bottom'
                  sideOffset={4}
                >
                  <SelectGroup>
                    {fonts.length > 0 ? (
                      fonts.map((font) => (
                        <SelectItem
                          key={font}
                          value={font}
                          className='cursor-pointer'
                        >
                          <span style={{ fontFamily: font }}>{font}</span>
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value='Inter' disabled>
                        No fonts available
                      </SelectItem>
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>

              {/* Font Size */}
              <Select
                value={layer.style.fontSize.toString()}
                onValueChange={handleFontSize}
              >
                <SelectTrigger className='w-[70px] h-8'>
                  <SelectValue placeholder='Size' />
                </SelectTrigger>
                <SelectContent align='start' side='bottom' sideOffset={4}>
                  {FONT_SIZES.map((size) => (
                    <SelectItem key={size} value={size.toString()}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className='h-8 w-px bg-border' />

              {/* Text Style Controls */}
              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'h-8 w-8',
                  layer.style.fontWeight === 700 && 'bg-accent'
                )}
                onClick={handleBold}
                title='Bold'
              >
                <Bold className='h-4 w-4' />
              </Button>

              <Button
                variant='ghost'
                size='icon'
                className={cn('h-8 w-8', layer.style.italic && 'bg-accent')}
                onClick={handleItalic}
                title='Italic'
              >
                <Italic className='h-4 w-4' />
              </Button>

              <div className='h-8 w-px bg-border' />

              {/* Alignment Controls */}
              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'h-8 w-8',
                  layer.style.textAlign === 'left' && 'bg-accent'
                )}
                onClick={() => handleHorizontalAlign('left')}
                title='Align Left'
              >
                <AlignHorizontalJustifyStart className='h-4 w-4' />
              </Button>

              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'h-8 w-8',
                  layer.style.textAlign === 'center' && 'bg-accent'
                )}
                onClick={() => handleHorizontalAlign('center')}
                title='Align Center'
              >
                <AlignHorizontalJustifyCenter className='h-4 w-4' />
              </Button>

              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'h-8 w-8',
                  layer.style.textAlign === 'right' && 'bg-accent'
                )}
                onClick={() => handleHorizontalAlign('right')}
                title='Align Right'
              >
                <AlignHorizontalJustifyEnd className='h-4 w-4' />
              </Button>

              <div className='h-8 w-px bg-border' />

              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'h-8 w-8',
                  layer.style.verticalAlign === 'top' && 'bg-accent'
                )}
                onClick={() => handleVerticalAlign('top')}
                title='Align Top'
              >
                <AlignVerticalJustifyStart className='h-4 w-4' />
              </Button>

              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'h-8 w-8',
                  layer.style.verticalAlign === 'center' && 'bg-accent'
                )}
                onClick={() => handleVerticalAlign('center')}
                title='Align Middle'
              >
                <AlignVerticalJustifyCenter className='h-4 w-4' />
              </Button>

              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'h-8 w-8',
                  layer.style.verticalAlign === 'bottom' && 'bg-accent'
                )}
                onClick={() => handleVerticalAlign('bottom')}
                title='Align Bottom'
              >
                <AlignVerticalJustifyEnd className='h-4 w-4' />
              </Button>

              <div className='h-8 w-px bg-border' />

              {/* Word Wrap */}
              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'h-8 w-8',
                  layer.style.wordWrap === 'break-word' && 'bg-accent'
                )}
                onClick={() =>
                  handleWordWrap(layer.style.wordWrap !== 'break-word')
                }
                title='Word Wrap'
              >
                <WrapText className='h-4 w-4' />
              </Button>

              <div className='h-8 w-px bg-border' />

              {/* Colors */}
              <Popover>
                <PopoverTrigger asChild>
                  <ColorButton
                    color={layer.style.color}
                    icon={<Palette className='h-4 w-4' />}
                    indicatorColor={layer.style.color}
                  />
                </PopoverTrigger>
                <PopoverContent
                  className='w-48 p-2 bg-background border shadow-md'
                  align='center'
                  side='bottom'
                  sideOffset={4}
                >
                  <div className='grid grid-cols-5 gap-1'>
                    {[
                      '#000000',
                      '#FFFFFF',
                      '#FF0000',
                      '#00FF00',
                      '#0000FF',
                      '#FFFF00',
                      '#FF00FF',
                      '#00FFFF',
                      '#808080',
                      '#C0C0C0',
                      '#800000',
                      '#008000',
                      '#000080',
                      '#808000',
                      '#800080',
                      '#008080',
                      '#FFA500',
                      '#FFC0CB',
                      '#A52A2A',
                      '#32CD32',
                    ].map((color) => (
                      <button
                        key={color}
                        className='h-6 w-6 rounded-md border border-border hover:scale-110 transition-transform'
                        style={{ backgroundColor: color }}
                        onClick={() => handleTextColor(color)}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <ColorButton
                    color={layer.style.backgroundColor || 'transparent'}
                    icon={<Square className='h-4 w-4' />}
                    indicatorColor={layer.style.backgroundColor}
                  />
                </PopoverTrigger>
                <PopoverContent
                  className='w-48 p-2 bg-background border shadow-md'
                  align='center'
                  side='bottom'
                  sideOffset={4}
                >
                  <div className='grid grid-cols-5 gap-1'>
                    <button
                      className='h-6 w-6 rounded-md border border-border hover:scale-110 transition-transform bg-transparent flex items-center justify-center'
                      onClick={() => handleBackgroundColor('transparent')}
                    >
                      <Square className='h-4 w-4' />
                    </button>
                    {[
                      '#FFFFFF',
                      '#FF0000',
                      '#00FF00',
                      '#0000FF',
                      '#FFFF00',
                      '#FF00FF',
                      '#00FFFF',
                      '#808080',
                      '#C0C0C0',
                      '#800000',
                      '#008000',
                      '#000080',
                      '#808000',
                      '#800080',
                      '#008080',
                      '#FFA500',
                      '#FFC0CB',
                      '#A52A2A',
                      '#32CD32',
                    ].map((color) => (
                      <button
                        key={color}
                        className='h-6 w-6 rounded-md border border-border hover:scale-110 transition-transform'
                        style={{ backgroundColor: color }}
                        onClick={() => handleBackgroundColor(color)}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <ColorButton
                    color={layer.style.stroke?.color || '#000000'}
                    icon={<Type className='h-4 w-4' />}
                    indicatorColor={layer.style.stroke?.color}
                    isActive={layer.style.stroke?.enabled}
                  />
                </PopoverTrigger>
                <PopoverContent
                  className='w-48 p-2 bg-background border shadow-md'
                  align='center'
                  side='bottom'
                  sideOffset={4}
                >
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between'>
                      <span className='text-sm'>Enable Outline</span>
                      <Button
                        variant='ghost'
                        size='sm'
                        className={
                          layer.style.stroke?.enabled ? 'bg-accent' : ''
                        }
                        onClick={handleStrokeToggle}
                      >
                        {layer.style.stroke?.enabled ? 'On' : 'Off'}
                      </Button>
                    </div>

                    {layer.style.stroke?.enabled && (
                      <>
                        <div className='space-y-1'>
                          <span className='text-sm'>Width</span>
                          <Select>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={layer.style.stroke.width.toString()}
                              />
                            </SelectTrigger>
                            <SelectContent
                              align='center'
                              side='top'
                              className='bg-background border shadow-md'
                            >
                              {[1, 2, 3, 4, 5].map((width) => (
                                <SelectItem
                                  key={width}
                                  value={width.toString()}
                                  onClick={() => handleStrokeWidth(width)}
                                >
                                  {width}px
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className='space-y-1'>
                          <span className='text-sm'>Color</span>
                          <div className='grid grid-cols-5 gap-1'>
                            {[
                              '#000000',
                              '#FFFFFF',
                              '#FF0000',
                              '#00FF00',
                              '#0000FF',
                              '#FFFF00',
                              '#FF00FF',
                              '#00FFFF',
                              '#808080',
                              '#C0C0C0',
                            ].map((color) => (
                              <button
                                key={color}
                                className='h-6 w-6 rounded-md border border-border hover:scale-110 transition-transform'
                                style={{ backgroundColor: color }}
                                onClick={(e) => {
                                  console.log('Color selected:', color);
                                  e.stopPropagation();
                                  handleStrokeColor(color);
                                }}
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
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
