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
  mimeType: string
): Promise<{ data: Uint8Array; mimeType: string }> => {
  // Create a blob from the input data
  const blob = new Blob([data], { type: mimeType });
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
    if (mimeType === 'image/png') {
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
    return { data, mimeType };
  }
};
