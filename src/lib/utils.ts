import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { memoize, isEqual } from 'es-toolkit';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LayerRef {
  id: string;
}

interface LayerIndex {
  id: string;
  index: number;
}

// Create a type-safe memoized comparison function for layer ordering
const memoizedCompare = memoize(
  (aId: string, bId: string, layers: LayerIndex[]): number => {
    try {
      if (!layers?.length) return 0;
      if (aId === bId) return 0;

      const aLayer = layers.find((l) => l?.id === aId);
      const bLayer = layers.find((l) => l?.id === bId);

      if (!aLayer || !bLayer) return 0;

      return (aLayer.index ?? 0) - (bLayer.index ?? 0);
    } catch (error) {
      console.error('Layer comparison error:', error);
      return 0;
    }
  }
);

export const compareLayersForRender = (
  a: LayerRef | null | undefined,
  b: LayerRef | null | undefined,
  layers: LayerIndex[] | null | undefined
): number => {
  try {
    if (!a || !b || !layers?.length) return 0;
    if (a.id === b.id) return 0;
    return memoizedCompare(a.id, b.id, layers);
  } catch (error) {
    console.error('Layer comparison error:', error);
    return 0;
  }
};

// Deep equality check for objects
export const deepEqual = isEqual;

// Convert image to transparent PNG
export const convertToTransparentPng = async (
  data: Uint8Array,
  mimeType: string | undefined
): Promise<{ data: Uint8Array; mimeType: string }> => {
  // Use a default mimeType if none provided
  const effectiveMimeType = mimeType || 'image/png';
  
  // Create a blob from the input data
  const blob = new Blob([data], { type: effectiveMimeType });
  const imageUrl = URL.createObjectURL(blob);

  try {
    // Load the image
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = imageUrl;
    });

    // Create a canvas with the image dimensions
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // Get the 2D context
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Could not get canvas context');
    }

    // Clear the canvas with transparency
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw the image
    ctx.drawImage(img, 0, 0);

    // Get the image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixelData = imageData.data;

    // If the image is already PNG with transparency, return as is
    if (effectiveMimeType === 'image/png') {
      const hasTransparency = Array.from(pixelData).some(
        (value, index) => (index + 1) % 4 === 0 && value < 255
      );
      if (hasTransparency) {
        // Convert Uint8ClampedArray to Uint8Array
        const uint8Array = new Uint8Array(pixelData.buffer);
        return { data: uint8Array, mimeType: 'image/png' };
      }
    }

    // Convert to PNG with transparency
    const pngBlob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob!);
      }, 'image/png');
    });

    // Convert blob to Uint8Array
    const arrayBuffer = await pngBlob.arrayBuffer();
    const pngData = new Uint8Array(arrayBuffer);

    // Clean up
    URL.revokeObjectURL(imageUrl);

    return {
      data: pngData,
      mimeType: 'image/png',
    };
  } catch (error) {
    // Clean up on error
    URL.revokeObjectURL(imageUrl);
    console.error('Error converting image:', error);

    // Return original data if conversion fails
    return { data, mimeType: effectiveMimeType };
  }
};

// Export canvas as image
export type ExportLayer = {
  type: 'text' | 'image' | 'sticker';
  transform: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    opacity: number;
    blendMode: string;
  };
} & (
  | {
      type: 'text';
      content: string;
      style: {
        fontFamily: string;
        fontSize: number;
        fontWeight: number;
        color: string;
        backgroundColor?: string;
        textAlign: 'left' | 'center' | 'right';
        italic: boolean;
        underline: boolean;
        verticalAlign: 'top' | 'center' | 'bottom';
        wordWrap: 'normal' | 'break-word';
        stroke?: {
          enabled: boolean;
          width: number;
          color: string;
        };
      };
    }
  | {
      type: 'image' | 'sticker';
      imageUrl: string;
    }
);

// Update the background type to be more specific
type ExportBackground = {
  type: 'color';
  color: string;
} | {
  type: 'image';
  imageUrl: string;
} | {
  type: 'none';
};

export const exportCanvasAsImage = async (
  layers: ExportLayer[],
  canvasWidth: number,
  canvasHeight: number,
  background: ExportBackground
): Promise<Blob> => {
  // Create a canvas with the specified dimensions
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d')!;

  // Clear canvas with white background by default
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw background
  if (background.type === 'color') {
    ctx.fillStyle = background.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (background.type === 'image') {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = background.imageUrl;
      });

      // Calculate dimensions to cover the canvas while maintaining aspect ratio
      const imgAspect = img.width / img.height;
      const canvasAspect = canvas.width / canvas.height;
      let drawWidth = canvas.width;
      let drawHeight = canvas.height;
      let x = 0;
      let y = 0;

      if (imgAspect > canvasAspect) {
        drawWidth = canvas.height * imgAspect;
        x = (canvas.width - drawWidth) / 2;
      } else {
        drawHeight = canvas.width / imgAspect;
        y = (canvas.height - drawHeight) / 2;
      }

      ctx.drawImage(img, x, y, drawWidth, drawHeight);
    } catch (error) {
      console.error('Failed to load background image:', error);
    }
  }

  // Draw each layer
  for (const layer of layers) {
    ctx.save();

    // Set global alpha and blend mode
    ctx.globalAlpha = layer.transform.opacity;
    ctx.globalCompositeOperation = layer.transform
      .blendMode as GlobalCompositeOperation;

    // Apply transform
    const centerX = layer.transform.x + layer.transform.width / 2;
    const centerY = layer.transform.y + layer.transform.height / 2;

    ctx.translate(centerX, centerY);
    ctx.rotate((layer.transform.rotation * Math.PI) / 180);
    ctx.scale(layer.transform.scaleX, layer.transform.scaleY);
    ctx.translate(-centerX, -centerY);

    if (layer.type === 'text') {
      // Text layer rendering
      const { content, style } = layer;
      // Set text styles
      const fontStyle = style.italic ? 'italic ' : '';
      const fontWeight = style.fontWeight;
      ctx.font = `${fontStyle}${fontWeight} ${style.fontSize}px ${style.fontFamily}`;
      ctx.fillStyle = style.color;
      ctx.textAlign = style.textAlign;
      ctx.textBaseline = 'middle';

      // Handle background color
      if (style.backgroundColor) {
        ctx.fillStyle = style.backgroundColor;
        ctx.fillRect(
          layer.transform.x,
          layer.transform.y,
          layer.transform.width,
          layer.transform.height
        );
        ctx.fillStyle = style.color;
      }

      // Calculate text position based on alignment
      let x = layer.transform.x;
      if (style.textAlign === 'center') {
        x += layer.transform.width / 2;
      } else if (style.textAlign === 'right') {
        x += layer.transform.width;
      }

      let y = layer.transform.y;
      if (style.verticalAlign === 'center') {
        y += layer.transform.height / 2;
      } else if (style.verticalAlign === 'bottom') {
        y += layer.transform.height;
      }

      // Handle word wrap
      if (style.wordWrap === 'break-word') {
        const words = content.split(' ');
        let line = '';
        let lines: string[] = [];
        const maxWidth = layer.transform.width;

        for (const word of words) {
          const testLine = line + word + ' ';
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxWidth && line !== '') {
            lines.push(line);
            line = word + ' ';
          } else {
            line = testLine;
          }
        }
        lines.push(line);

        const lineHeight = style.fontSize * 1.2;
        lines.forEach((line, i) => {
          // Draw text stroke if enabled
          if (style.stroke?.enabled) {
            ctx.strokeStyle = style.stroke.color;
            ctx.lineWidth = style.stroke.width;
            ctx.strokeText(line, x, y + i * lineHeight);
          }
          ctx.fillText(line, x, y + i * lineHeight);
        });
      } else {
        // Draw text stroke if enabled
        if (style.stroke?.enabled) {
          ctx.strokeStyle = style.stroke.color;
          ctx.lineWidth = style.stroke.width;
          ctx.strokeText(content, x, y);
        }
        ctx.fillText(content, x, y);
      }

      // Draw underline if enabled
      if (style.underline) {
        const metrics = ctx.measureText(content);
        const underlineY = y + style.fontSize * 0.1;
        ctx.beginPath();
        ctx.moveTo(x, underlineY);
        ctx.lineTo(x + metrics.width, underlineY);
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.fontSize * 0.05;
        ctx.stroke();
      }
    } else {
      // Image or sticker layer rendering
      const { imageUrl } = layer;
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = imageUrl;
        });

        ctx.drawImage(
          img,
          layer.transform.x,
          layer.transform.y,
          layer.transform.width,
          layer.transform.height
        );
      } catch (error) {
        console.error('Failed to load image:', error);
      }
    }

    ctx.restore();
  }

  // Convert canvas to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to create image blob'));
      }
    }, 'image/png');
  });
};
