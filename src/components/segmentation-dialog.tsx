import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { getSettings } from '@/lib/db';
import { toast } from 'sonner';
import runpodSdk from 'runpod-sdk';
import { Check, Loader2, AlertCircle, Crop } from 'lucide-react';

interface SegmentationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  onSegmentationComplete: (images: string[]) => void;
}

interface RunPodStatus {
  isChecking: boolean;
  isReady: boolean;
  error?: string;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function SegmentationDialog({
  open,
  onOpenChange,
  imageUrl,
  onSegmentationComplete,
}: SegmentationDialogProps) {
  const [runpodStatus, setRunpodStatus] = useState<RunPodStatus>({
    isChecking: true,
    isReady: false,
  });
  const [mode, setMode] = useState<'auto' | 'semantic'>('auto');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [segmentedImages, setSegmentedImages] = useState<string[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<number>>(new Set());
  const [semanticPrompt, setSemanticPrompt] = useState('');
  const [boundingBox, setBoundingBox] = useState<BoundingBox | null>(null);
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null
  );
  const previewRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setMode('auto');
      setSemanticPrompt('');
      setBoundingBox(null);
      setSegmentedImages([]);
      setSelectedImages(new Set());
    }
  }, [open]);

  // Check RunPod health on mount and when dialog opens
  useEffect(() => {
    if (!open) return;
    console.log('Starting RunPod health check...');
    checkRunPodHealth();
  }, [open]);

  const checkRunPodHealth = async () => {
    console.log('Checking RunPod health...');
    try {
      setRunpodStatus({ isChecking: true, isReady: false });
      console.log('Fetching settings...');
      const settings = await getSettings();
      console.log('Settings received:', {
        hasApiKey: !!settings?.runpodApiKey,
        hasInstanceId: !!settings?.runpodInstanceId,
      });

      if (!settings || !settings.runpodApiKey || !settings.runpodInstanceId) {
        console.log('RunPod settings missing');
        setRunpodStatus({
          isChecking: false,
          isReady: false,
          error: 'RunPod settings not configured',
        });
        return;
      }

      console.log('Initializing RunPod SDK...');
      const runpod = runpodSdk(settings.runpodApiKey);
      console.log('Getting endpoint...');
      const endpoint = runpod.endpoint(settings.runpodInstanceId);

      if (!endpoint) {
        console.log('Failed to create endpoint');
        setRunpodStatus({
          isChecking: false,
          isReady: false,
          error: 'Failed to create RunPod endpoint',
        });
        return;
      }

      console.log('Checking endpoint health...');
      const health = await endpoint.health();
      console.log('Health response:', health);

      // Check if the health response indicates the endpoint is ready
      // The endpoint is ready if there are available workers (idle or ready)
      const isReady =
        health &&
        typeof health === 'object' &&
        'workers' in health &&
        typeof health.workers === 'object' &&
        ((health.workers.idle ?? 0) > 0 || (health.workers.ready ?? 0) > 0);

      console.log('Worker status:', {
        idle: health?.workers?.idle ?? 0,
        ready: health?.workers?.ready ?? 0,
        running: health?.workers?.running ?? 0,
        initializing: health?.workers?.initializing ?? 0,
      });

      if (isReady) {
        console.log('RunPod endpoint is ready (has available workers)');
        setRunpodStatus({ isChecking: false, isReady: true });
      } else {
        console.log('RunPod endpoint not ready: no available workers');
        setRunpodStatus({
          isChecking: false,
          isReady: false,
          error: 'No available workers',
        });
      }
    } catch (error) {
      console.error('Failed to check RunPod health:', error);
      setRunpodStatus({
        isChecking: false,
        isReady: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to check RunPod status',
      });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!previewRef.current || !imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    setIsDrawingBox(true);
    setStartPoint({ x, y });
    setBoundingBox({
      x,
      y,
      width: 0,
      height: 0,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawingBox || !startPoint || !imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const currentX = (e.clientX - rect.left) / rect.width;
    const currentY = (e.clientY - rect.top) / rect.height;

    setBoundingBox({
      x: Math.min(startPoint.x, currentX),
      y: Math.min(startPoint.y, currentY),
      width: Math.abs(currentX - startPoint.x),
      height: Math.abs(currentY - startPoint.y),
    });
  };

  const handleMouseUp = () => {
    setIsDrawingBox(false);
    setStartPoint(null);
  };

  const cropAndCompressImage = async (
    imageUrl: string,
    box: BoundingBox | null
  ): Promise<{ data: string; width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // If there's a bounding box, use it to crop
        const sx = box ? box.x * img.width : 0;
        const sy = box ? box.y * img.height : 0;
        const sWidth = box ? box.width * img.width : img.width;
        const sHeight = box ? box.height * img.height : img.height;

        // Set canvas size to the cropped size
        canvas.width = sWidth;
        canvas.height = sHeight;

        // Draw the cropped region
        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

        // Start with high quality
        let quality = 0.95;
        let base64 = canvas.toDataURL('image/jpeg', quality);

        // Reduce quality until size is under 9.5MB
        while (base64.length > 9.5 * 1024 * 1024 && quality > 0.1) {
          quality -= 0.05;
          base64 = canvas.toDataURL('image/jpeg', quality);
        }

        if (base64.length > 9.5 * 1024 * 1024) {
          // If still too large, reduce dimensions
          const scale = Math.sqrt((9.5 * 1024 * 1024) / base64.length);
          canvas.width *= scale;
          canvas.height *= scale;
          ctx.drawImage(
            img,
            sx,
            sy,
            sWidth,
            sHeight,
            0,
            0,
            canvas.width,
            canvas.height
          );
          base64 = canvas.toDataURL('image/jpeg', 0.9);
        }

        resolve({
          data: base64.split(',')[1],
          width: canvas.width,
          height: canvas.height,
        });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageUrl;
    });
  };

  const handleSegment = async () => {
    try {
      setIsProcessing(true);
      setProgress(0);
      setSegmentedImages([]);

      const settings = await getSettings();
      if (!settings?.runpodApiKey || !settings?.runpodInstanceId) {
        throw new Error('RunPod settings not configured');
      }

      // Crop and compress the image
      const {
        data: base64Data,
        width,
        height,
      } = await cropAndCompressImage(imageUrl, boundingBox);

      const runpod = runpodSdk(settings.runpodApiKey);
      const endpoint = runpod.endpoint(settings.runpodInstanceId);
      if (!endpoint) {
        throw new Error('Failed to create RunPod endpoint');
      }

      // Start the segmentation job
      const result = await endpoint.run({
        input: {
          image_base64: base64Data,
          automatic: mode === 'auto',
          semantic_prompt: mode === 'semantic' ? semanticPrompt : undefined,
          image_dimensions: { width, height },
        },
      });

      if (!result.id) {
        throw new Error('No job ID returned');
      }

      // Poll for results
      const { id } = result;
      const images: string[] = [];

      for await (const streamResult of endpoint.stream(id)) {
        if (streamResult.status === 'COMPLETED') {
          setProgress(100);
          break;
        } else if (streamResult.status === 'FAILED') {
          throw new Error(streamResult.error || 'Segmentation failed');
        }

        // Process stream results
        if (streamResult.output?.output?.image_base64) {
          const imageData = streamResult.output.output.image_base64;
          const imageUrl = `data:image/png;base64,${imageData}`;
          images.push(imageUrl);
          setSegmentedImages([...images]);
          setProgress((prev) => Math.min(prev + 20, 90));
        }
      }

      if (images.length === 0) {
        throw new Error('No segments were generated');
      }

      setSegmentedImages(images);
      setSelectedImages(new Set([0])); // Select first image by default
    } catch (error) {
      console.error('Segmentation failed:', error);
      toast.error('Failed to segment image');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirm = () => {
    const selectedSegments = Array.from(selectedImages).map(
      (index) => segmentedImages[index]
    );
    onSegmentationComplete(selectedSegments);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[600px] z-[100000]'>
        <DialogHeader>
          <DialogTitle>Segment Image</DialogTitle>
          <DialogDescription>
            Draw a box to crop the image (optional) and choose a segmentation
            mode.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-6'>
          {/* RunPod Status */}
          <div className='flex items-center gap-2'>
            {runpodStatus.isChecking ? (
              <>
                <Loader2 className='h-4 w-4 animate-spin' />
                <span>Checking RunPod status...</span>
              </>
            ) : runpodStatus.isReady ? (
              <>
                <Check className='h-4 w-4 text-green-500' />
                <span>RunPod ready</span>
              </>
            ) : (
              <>
                <AlertCircle className='h-4 w-4 text-destructive' />
                <span className='text-destructive'>{runpodStatus.error}</span>
              </>
            )}
          </div>

          {/* Mode Selection */}
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className='grid w-full grid-cols-2'>
              <TabsTrigger value='auto'>Automatic</TabsTrigger>
              <TabsTrigger value='semantic'>Semantic</TabsTrigger>
            </TabsList>
            <TabsContent value='auto'>
              Automatically detect and segment objects in the image.
            </TabsContent>
            <TabsContent value='semantic'>
              <div className='space-y-4'>
                <p>Use semantic understanding to segment specific objects.</p>
                <div className='space-y-2'>
                  <Label htmlFor='semantic-prompt'>
                    Describe what to segment
                  </Label>
                  <Input
                    id='semantic-prompt'
                    placeholder='e.g. "person", "cat", "car"'
                    value={semanticPrompt}
                    onChange={(e) => setSemanticPrompt(e.target.value)}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Preview */}
          <div
            ref={previewRef}
            className='aspect-video bg-accent/20 rounded-lg overflow-hidden relative group'
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div className='absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none'>
              <div className='bg-background/80 backdrop-blur-sm rounded-lg px-3 py-1.5 text-sm flex items-center gap-2'>
                <Crop className='h-4 w-4' />
                Click and drag to crop
              </div>
            </div>
            <img
              ref={imageRef}
              src={imageUrl}
              alt='Original'
              className='w-full h-full object-contain'
              draggable={false}
            />
            {boundingBox && (
              <div
                className='absolute border-2 border-primary bg-primary/20'
                style={{
                  left: `${boundingBox.x * 100}%`,
                  top: `${boundingBox.y * 100}%`,
                  width: `${boundingBox.width * 100}%`,
                  height: `${boundingBox.height * 100}%`,
                }}
              />
            )}
          </div>

          {/* Results Carousel */}
          {segmentedImages.length > 0 && (
            <div className='space-y-4'>
              <Label>Segmented Images</Label>
              <Carousel>
                <CarouselContent>
                  {segmentedImages.map((image, index) => (
                    <CarouselItem key={index} className='basis-1/3'>
                      <Card className='relative'>
                        <CardContent className='p-0'>
                          <div className='relative aspect-square'>
                            <img
                              src={image}
                              alt={`Segment ${index + 1}`}
                              className='w-full h-full object-contain'
                            />
                            <div className='absolute top-2 right-2'>
                              <Checkbox
                                checked={selectedImages.has(index)}
                                onCheckedChange={(checked) => {
                                  const newSelected = new Set(selectedImages);
                                  if (checked) {
                                    newSelected.add(index);
                                  } else {
                                    newSelected.delete(index);
                                  }
                                  setSelectedImages(newSelected);
                                }}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </div>
          )}

          {/* Progress */}
          {isProcessing && (
            <div className='space-y-2'>
              <Progress value={progress} />
              <p className='text-sm text-muted-foreground text-center'>
                Processing image...
              </p>
            </div>
          )}

          {/* Actions */}
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {segmentedImages.length > 0 ? (
              <Button
                onClick={handleConfirm}
                disabled={selectedImages.size === 0}
              >
                Add Selected ({selectedImages.size})
              </Button>
            ) : (
              <Button
                onClick={handleSegment}
                disabled={
                  !runpodStatus.isReady ||
                  isProcessing ||
                  (mode === 'semantic' && !semanticPrompt.trim())
                }
              >
                {isProcessing ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Processing
                  </>
                ) : (
                  'Start Segmentation'
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
