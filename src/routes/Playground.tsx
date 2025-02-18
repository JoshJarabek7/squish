import '@/App.css';
import { Project, Layer } from '@/types/ProjectType';
import { Plus, Folder, Cog, Trash2, ZoomIn, ZoomOut, Move } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import {
  getProjects,
  createProject,
  deleteProject,
  createImageAsset,
  createLayer,
  getProjectWithLayers,
  getDatabase,
  updateLayer,
  updateProjectTimestamp,
  getProjectLayers,
  updateCanvasSettings,
  getCanvasSettings,
  getImageAssetData,
  dbQueue,
  withTransaction,
} from '@/lib/db';
import { nanoid } from 'nanoid';
import { SettingsDialog } from '@/components/settings-dialog';
import { Canvas } from '@/components/canvas';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

import { HeaderToolbar } from '@/components/header-toolbar';
import { LayerPanel, LayerPanelTrigger } from '@/components/layer-panel';

// Create a custom hook for project loading
function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadProjects = async () => {
    try {
      setLoading(true);
      setError(null);
      const loadedProjects = await getProjects();
      setProjects(loadedProjects);
    } catch (error) {
      console.error('Failed to load projects:', error);
      setError(
        error instanceof Error ? error : new Error('Failed to load projects')
      );
      toast.error('Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  return { projects, loading, error, reloadProjects: loadProjects };
}

export default function Playground() {
  const { projects: history, reloadProjects } = useProjects();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [currentProject, setCurrentProject] = useState<Project>();
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [showCanvasResizeHandles, setShowCanvasResizeHandles] = useState(true);
  const [layerData, setLayerData] = useState<Layer[]>([]);
  const [canvasBackground, setCanvasBackground] = useState<{
    type: 'color' | 'image' | 'none';
    color?: string;
    imageId?: string;
    imageUrl?: string;
    imageSize?: { width: number; height: number };
  }>({ type: 'none' });
  const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(false);
  const layerPanelTriggerRef = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [assetData, setAssetData] = useState<{
    [key: string]: { url: string; loading: boolean; error: boolean };
  }>({});
  const [canvasSettingsVersion, setCanvasSettingsVersion] = useState(0);

  // Add a ref to track if we're currently deleting a project
  const isDeletingProject = useRef(false);

  // Log layer panel state changes
  useEffect(() => {
    console.log('Layer panel trigger state:', {
      isOpen: isLayerPanelOpen,
      triggerRef: layerPanelTriggerRef.current,
    });
  }, [isLayerPanelOpen, layerPanelTriggerRef.current]);

  const handleAddProject = async () => {
    if (!newProjectName.trim()) {
      toast.error('Please enter a project name');
      return;
    }

    try {
      const newProject = {
        id: nanoid(),
        name: newProjectName.trim(),
      };

      // Create project in database first
      await createProject(newProject);

      // Clear form state immediately
      setNewProjectName('');
      setNewProjectOpen(false);

      // Load the full project data
      const fullProject = await getProjectWithLayers(newProject.id);

      // Update all state in one batch
      setCurrentProject(fullProject);
      setSelectedLayerId(null);
      setLayerData([]); // New project has no layers
      setCanvasBackground({ type: 'none' }); // Reset canvas background

      // Reload project list after everything else
      await reloadProjects();

      toast.success('Project created successfully');
    } catch (error) {
      console.error('Failed to create project:', error);
      toast.error('Failed to create project');
    }
  };

  // Add a cleanup function
  const cleanupProjectState = () => {
    // Clean up any existing background image URLs
    if (canvasBackground.type === 'image' && canvasBackground.imageUrl) {
      URL.revokeObjectURL(canvasBackground.imageUrl);
    }

    // Clean up any existing asset URLs
    Object.values(assetData).forEach((asset) => {
      if (asset.url) {
        URL.revokeObjectURL(asset.url);
      }
    });

    // Reset all state
    setCurrentProject(undefined);
    setSelectedLayerId(null);
    setLayerData([]);
    setCanvasBackground({ type: 'none' });
    setZoom(1);
    setAssetData({});
    setCanvasSettingsVersion((v) => v + 1);
    setIsLayerPanelOpen(false);
  };

  // Update the useEffect to be more resilient
  useEffect(() => {
    if (!currentProject?.id || isDeletingProject.current) return;

    let mounted = true;
    let loadingProject = true;

    const loadProjectData = async () => {
      try {
        const layers = await getProjectLayers(currentProject.id);
        if (mounted && !isDeletingProject.current && loadingProject) {
          setLayerData(layers);
        }
      } catch (error) {
        console.error('Failed to load project layers:', error);
        if (mounted && !isDeletingProject.current && loadingProject) {
          toast.error('Failed to load project layers');
          cleanupProjectState();
        }
      }
    };

    void loadProjectData();

    return () => {
      mounted = false;
      loadingProject = false;
    };
  }, [currentProject?.id]);

  const handleDeleteProject = async (project: Project) => {
    try {
      // Set deleting flag
      isDeletingProject.current = true;

      // Delete from database first
      await deleteProject(project.id);

      // Then reload the project list
      await reloadProjects();

      // Finally clean up state if it was the current project
      if (currentProject?.id === project.id) {
        cleanupProjectState();
      }

      toast.success('Project deleted successfully');
    } catch (error) {
      console.error('Failed to delete project:', error);
      toast.error('Failed to delete project');
    } finally {
      // Reset deleting flag
      isDeletingProject.current = false;
    }
  };

  const handleProjectClick = async (project: Project) => {
    try {
      // Clean up current state
      cleanupProjectState();

      // Load new project data
      const [fullProject, layers, settings] = await Promise.all([
        getProjectWithLayers(project.id),
        getProjectLayers(project.id),
        getCanvasSettings(project.id),
      ]);

      // Load background if it exists
      let background: {
        type: 'color' | 'image' | 'none';
        color?: string;
        imageId?: string;
        imageUrl?: string;
        imageSize?: { width: number; height: number };
      } = { type: 'none' };

      if (settings.backgroundType === 'image' && settings.backgroundImageId) {
        try {
          const imageData = await getImageAssetData(settings.backgroundImageId);
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

          // Get image dimensions
          const img = new Image();
          const imageSize = await new Promise<{
            width: number;
            height: number;
          }>((resolve, reject) => {
            img.onload = () =>
              resolve({
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            img.onerror = reject;
            img.src = imageUrl;
          });

          background = {
            type: 'image',
            imageId: settings.backgroundImageId,
            imageUrl,
            imageSize,
          };
        } catch (error) {
          console.error('Failed to load background image:', error);
          background = { type: 'none' };
        }
      } else if (
        settings.backgroundType === 'color' &&
        settings.backgroundColor
      ) {
        background = {
          type: 'color',
          color: settings.backgroundColor,
        };
      }

      // Load image data for all image and sticker layers
      const newAssetData: {
        [key: string]: { url: string; loading: boolean; error: boolean };
      } = {};

      await Promise.all(
        layers
          .filter((layer) => layer.type === 'image' || layer.type === 'sticker')
          .map(async (layer) => {
            const assetId =
              layer.type === 'image'
                ? layer.imageAssetId
                : layer.stickerAssetId;
            try {
              const imageData = await getImageAssetData(assetId);
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
              newAssetData[assetId] = {
                url: imageUrl,
                loading: false,
                error: false,
              };
            } catch (error) {
              console.error(`Failed to load image asset ${assetId}:`, error);
              newAssetData[assetId] = {
                url: '',
                loading: false,
                error: true,
              };
            }
          })
      );

      // Update all state
      setCurrentProject(fullProject);
      setLayerData(layers);
      setCanvasBackground(background);
      setAssetData(newAssetData);

      // Update canvas settings
      await updateCanvasSettings(project.id, {
        width: settings.width,
        height: settings.height,
        backgroundType: settings.backgroundType,
        backgroundColor: settings.backgroundColor,
        backgroundImageId: settings.backgroundImageId,
      });

      // Trigger canvas refresh
      setCanvasSettingsVersion((v) => v + 1);
    } catch (error) {
      console.error('Failed to load project:', error);
      toast.error('Failed to load project');
      // Clean up on error
      cleanupProjectState();
    }
  };

  const handleAddImage = async () => {
    if (!currentProject) return;

    try {
      // Open file picker
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        // Create asset from file
        const reader = new FileReader();
        reader.onload = async (e) => {
          if (!e.target?.result || typeof e.target.result === 'string') return;

          try {
            const arrayBuffer = e.target.result as ArrayBuffer;
            const data = new Uint8Array(arrayBuffer);

            // Create image asset
            const assetId = await createImageAsset(file.name, file.type, data);

            // Create blob URL for immediate display
            const blob = new Blob([data], { type: file.type });
            const imageUrl = URL.createObjectURL(blob);

            // Get image dimensions
            const img = new Image();
            const imageSize = await new Promise<{
              width: number;
              height: number;
            }>((resolve, reject) => {
              img.onload = () =>
                resolve({
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                });
              img.onerror = reject;
              img.src = imageUrl;
            });

            // Create the layer first
            const layerId = await createLayer(currentProject.id, {
              id: nanoid(),
              type: 'image' as const,
              imageAssetId: assetId,
              transform: {
                x: 960 - imageSize.width / 2,
                y: 540 - imageSize.height / 2,
                width: imageSize.width,
                height: imageSize.height,
                rotation: 0,
                scale: 1,
                opacity: 1,
                blendMode: 'normal',
              },
            });

            // Get the updated layer data
            const [layers, fullProject] = await Promise.all([
              getProjectLayers(currentProject.id),
              getProjectWithLayers(currentProject.id),
            ]);

            // Update all states in a single batch to ensure synchronization
            setAssetData((prev) => ({
              ...prev,
              [assetId]: {
                url: imageUrl,
                loading: false,
                error: false,
              },
            }));
            setLayerData(layers);
            setCurrentProject(fullProject);
            setSelectedLayerId(layerId);
            setCanvasSettingsVersion((v) => v + 1);

            // Update the project's last modified timestamp
            await updateProjectTimestamp(currentProject.id);
          } catch (error) {
            console.error('Failed to create image layer:', error);
            toast.error('Failed to create image layer');
          }
        };

        reader.readAsArrayBuffer(file);
      };

      input.click();
    } catch (error) {
      console.error('Failed to add image:', error);
      toast.error('Failed to add image');
    }
  };

  const handleAddText = async () => {
    if (!currentProject) return;

    try {
      // Create text layer with default properties
      const newLayer = {
        id: nanoid(),
        type: 'text' as const,
        content: 'Double click to edit',
        transform: {
          x: 960 - 100, // Center of canvas
          y: 540 - 25, // Center of canvas
          width: 200,
          height: 50,
          rotation: 0,
          scale: 1,
          opacity: 1,
          blendMode: 'normal',
        },
        style: {
          fontFamily: 'Inter',
          fontSize: 24,
          fontWeight: 400,
          color: '#FFFFFF',
          textAlign: 'left' as const,
          italic: false,
          underline: false,
          verticalAlign: 'center' as const,
          wordWrap: 'normal' as const,
        },
      };

      const layerId = await createLayer(currentProject.id, newLayer);

      // Update current project with new layer
      const newLayerIndex = currentProject.layers.length;
      setCurrentProject({
        ...currentProject,
        layers: [
          ...currentProject.layers,
          { id: layerId, index: newLayerIndex },
        ],
      });

      // Update layerData state
      setLayerData((prev) => [
        ...prev,
        { ...newLayer, id: layerId, createdAt: new Date() },
      ]);
      setSelectedLayerId(layerId);

      // Update the project's last modified timestamp
      await updateProjectTimestamp(currentProject.id);
    } catch (error) {
      console.error('Failed to create text layer:', error);
      toast.error('Failed to create text layer');
    }
  };

  const handleLayerUpdate = async (updatedLayer: Layer) => {
    if (!currentProject) return;

    try {
      // Update the layer in the database
      await updateLayer(updatedLayer.id, updatedLayer);

      // Update local state
      const updatedLayers = currentProject.layers.map((layer) =>
        layer.id === updatedLayer.id ? { ...layer } : layer
      );

      // Get the updated layer data from the database to ensure consistency
      const [layers, fullProject] = await Promise.all([
        getProjectLayers(currentProject.id),
        getProjectWithLayers(currentProject.id),
      ]);

      // Update all states in a single batch
      setCurrentProject(fullProject);
      setLayerData(layers);

      // Update the project's last modified timestamp
      await updateProjectTimestamp(currentProject.id);
    } catch (error) {
      console.error('Failed to update layer:', error);
      toast.error('Failed to update layer');
    }
  };

  const handleLayerReorder = async (layerId: string, newIndex: number) => {
    if (!currentProject) return;

    const db = await getDatabase();

    try {
      // Start a transaction
      await db.execute('BEGIN IMMEDIATE');

      // Get current index of the layer being moved
      const currentIndex =
        currentProject.layers.find((l) => l.id === layerId)?.index ?? 0;

      // Create a new array of layers with updated indices
      const updatedLayers = currentProject.layers.map((layer) => {
        if (layer.id === layerId) {
          // This is the layer being moved
          return { ...layer, index: newIndex };
        } else if (currentIndex < newIndex) {
          // Moving forward: decrement indices of layers between old and new position
          if (layer.index > currentIndex && layer.index <= newIndex) {
            return { ...layer, index: layer.index - 1 };
          }
        } else if (currentIndex > newIndex) {
          // Moving backward: increment indices of layers between new and old position
          if (layer.index >= newIndex && layer.index < currentIndex) {
            return { ...layer, index: layer.index + 1 };
          }
        }
        return layer;
      });

      // Update all layer indices in the database
      await Promise.all(
        updatedLayers.map((layer) =>
          db.execute(
            'UPDATE layer_order SET index_number = $1 WHERE project_id = $2 AND layer_id = $3',
            [layer.index, currentProject.id, layer.id]
          )
        )
      );

      // Commit the transaction
      await db.execute('COMMIT');

      // Update local state
      setCurrentProject({
        ...currentProject,
        layers: updatedLayers,
      });

      // Update the project's last modified timestamp
      await updateProjectTimestamp(currentProject.id);
    } catch (error) {
      console.error('Failed to reorder layer:', error);
      try {
        await db.execute('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback:', rollbackError);
      }
      toast.error('Failed to reorder layer');
    }
  };

  const handleLayerDelete = async (layerId: string) => {
    if (!currentProject) return;

    const db = await getDatabase();

    try {
      await withTransaction(db, async () => {
        // Delete layer from the database
        await db.execute('DELETE FROM layers WHERE id = $1', [layerId]);

        // Get remaining layers and their current indices
        const remainingLayers = await db.select<
          Array<{ layer_id: string; index_number: number }>
        >(
          'SELECT layer_id, index_number FROM layer_order WHERE project_id = $1 ORDER BY index_number',
          [currentProject.id]
        );

        // Reindex remaining layers
        await Promise.all(
          remainingLayers.map((layer, newIndex) =>
            db.execute(
              'UPDATE layer_order SET index_number = $1 WHERE project_id = $2 AND layer_id = $3',
              [newIndex, currentProject.id, layer.layer_id]
            )
          )
        );
      });

      // Update local state
      const [updatedLayers, updatedProject] = await Promise.all([
        getProjectLayers(currentProject.id),
        getProjectWithLayers(currentProject.id),
      ]);

      // Update both currentProject and layerData states
      setCurrentProject(updatedProject);
      setLayerData(updatedLayers);

      if (selectedLayerId === layerId) {
        setSelectedLayerId(null);
      }

      // Update the project's last modified timestamp
      await updateProjectTimestamp(currentProject.id);

      toast.success('Layer deleted successfully');
    } catch (error) {
      console.error('Failed to delete layer:', error);
      toast.error('Failed to delete layer');
    }
  };

  const handleLayerDuplicate = async (layerId: string) => {
    if (!currentProject) return;

    try {
      const db = await getDatabase();

      // Get the layer to duplicate
      const layer = await db.select<
        Array<{
          type: 'image' | 'sticker' | 'text';
          image_asset_id: string | null;
          sticker_asset_id: string | null;
          content: string | null;
          transform: string;
          style: string | null;
          crop: string | null;
        }>
      >(
        'SELECT type, image_asset_id, sticker_asset_id, content, transform, style, crop FROM layers WHERE id = $1',
        [layerId]
      );

      if (layer.length === 0) {
        throw new Error('Layer not found');
      }

      const originalLayer = layer[0];
      const transform = JSON.parse(originalLayer.transform);
      const newLayerId = nanoid();

      // Create layer data based on type
      let layerData: any;

      switch (originalLayer.type) {
        case 'image':
          layerData = {
            id: newLayerId,
            type: 'image' as const,
            imageAssetId: originalLayer.image_asset_id!,
            transform: {
              ...transform,
              x: transform.x + 20,
              y: transform.y + 20,
              opacity: transform.opacity ?? 1,
              blendMode: transform.blendMode ?? 'normal',
            },
            ...(originalLayer.crop
              ? { crop: JSON.parse(originalLayer.crop) }
              : {}),
          };
          break;

        case 'sticker':
          layerData = {
            id: newLayerId,
            type: 'sticker' as const,
            stickerAssetId: originalLayer.sticker_asset_id!,
            transform: {
              ...transform,
              x: transform.x + 20,
              y: transform.y + 20,
              opacity: transform.opacity ?? 1,
              blendMode: transform.blendMode ?? 'normal',
            },
          };
          break;

        case 'text':
          layerData = {
            id: newLayerId,
            type: 'text' as const,
            content: originalLayer.content!,
            style: JSON.parse(originalLayer.style!),
            transform: {
              ...transform,
              x: transform.x + 20,
              y: transform.y + 20,
              opacity: transform.opacity ?? 1,
              blendMode: transform.blendMode ?? 'normal',
            },
          };
          break;
      }

      // Create the new layer
      await createLayer(currentProject.id, layerData);

      // Update local state
      const newLayerIndex = currentProject.layers.length;
      setCurrentProject({
        ...currentProject,
        layers: [
          ...currentProject.layers,
          { id: newLayerId, index: newLayerIndex },
        ],
      });
      setSelectedLayerId(newLayerId);

      // Update the project's last modified timestamp
      await updateProjectTimestamp(currentProject.id);
    } catch (error) {
      console.error('Failed to duplicate layer:', error);
      toast.error('Failed to duplicate layer');
    }
  };

  const handleBackgroundColorChange = async (color: string) => {
    try {
      await updateCanvasSettings(currentProject!.id, {
        backgroundType: 'color',
        backgroundColor: color,
      });
      setCanvasBackground({
        type: 'color',
        color,
      });
      setCanvasSettingsVersion((v) => v + 1);
    } catch (error) {
      console.error('Failed to update background color:', error);
      toast.error('Failed to update background color');
    }
  };

  const handleBackgroundImageChange = async (file: File) => {
    try {
      // First, read the file as an ArrayBuffer
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);

      // Create a new image asset
      const imageId = await createImageAsset(file.name, file.type, data);

      // Get image dimensions
      const img = new Image();
      const imageSize = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          img.onload = () =>
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = reject;
          const blob = new Blob([data], { type: file.type });
          img.src = URL.createObjectURL(blob);
        }
      );

      // Update canvas settings to use the new image and set canvas dimensions
      await updateCanvasSettings(currentProject!.id, {
        backgroundType: 'image',
        backgroundImageId: imageId,
        width: imageSize.width,
        height: imageSize.height,
      });

      // Create blob URL for immediate display
      const blob = new Blob([data], { type: file.type });
      const imageUrl = URL.createObjectURL(blob);

      // Clean up old background image URL if it exists
      if (canvasBackground.type === 'image' && canvasBackground.imageUrl) {
        URL.revokeObjectURL(canvasBackground.imageUrl);
      }

      // Update local state
      setCanvasBackground({
        type: 'image',
        imageId,
        imageUrl,
        imageSize,
      });
      setCanvasSettingsVersion((v) => v + 1);

      toast.success('Background image updated');
    } catch (error) {
      console.error('Failed to update background image:', error);
      toast.error('Failed to update background image');
    }
  };

  const handleClearBackground = async () => {
    try {
      await updateCanvasSettings(currentProject!.id, {
        backgroundType: 'none',
      });
      setCanvasBackground({ type: 'none' });
      setCanvasSettingsVersion((v) => v + 1);
    } catch (error) {
      console.error('Failed to clear background:', error);
      toast.error('Failed to clear background');
    }
  };

  const handleBackgroundChange = (background: {
    type: 'color' | 'image' | 'none';
    color?: string;
    imageId?: string;
    imageUrl?: string;
    imageSize?: { width: number; height: number };
  }) => {
    // Clean up old background image URL if it exists
    if (canvasBackground.type === 'image' && canvasBackground.imageUrl) {
      URL.revokeObjectURL(canvasBackground.imageUrl);
    }
    setCanvasBackground(background);
  };

  const handleZoom = (delta: number) => {
    const minZoom = 0.1;
    const maxZoom = 5;
    setZoom(Math.min(Math.max(minZoom, zoom + delta), maxZoom));
  };

  const handleZoomChange = (newZoom: number) => {
    setZoom(newZoom);
  };

  const centerAndFitCanvas = () => {
    // This will trigger the Canvas component's centerAndFitCanvas function
    // No need to increment canvas version as it's not related to centering
  };

  return (
    <main className='w-screen h-screen bg-background text-foreground flex'>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <span className='font-bold'>Squish</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Projects</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {history.map((project) => (
                    <SidebarMenuItem key={project.id}>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton
                              onClick={() => handleProjectClick(project)}
                              className={cn(
                                currentProject?.id === project.id
                                  ? 'bg-accent'
                                  : '',
                                'group flex justify-between items-center'
                              )}
                            >
                              <div className='flex items-center gap-2'>
                                <Folder className='w-4 h-4' />
                                <span>{project.name}</span>
                              </div>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    className='h-6 w-6 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive'
                                    onClick={(e) => {
                                      e.stopPropagation();
                                    }}
                                  >
                                    <Trash2 className='h-3 w-3' />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Delete Project
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete "
                                      {project.name}"? This action cannot be
                                      undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      className='bg-destructive hover:bg-destructive/90'
                                      onClick={() =>
                                        handleDeleteProject(project)
                                      }
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </SidebarMenuButton>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className='font-medium'>{project.name}</p>
                            <p className='text-sm text-muted-foreground'>
                              Created {project.createdAt.toLocaleDateString()}
                            </p>
                            <p className='text-sm text-muted-foreground'>
                              Last modified{' '}
                              {project.updatedAt.toLocaleDateString()}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </SidebarMenuItem>
                  ))}
                  <Dialog
                    open={newProjectOpen}
                    onOpenChange={setNewProjectOpen}
                  >
                    <DialogTrigger asChild>
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <Plus className='w-4 h-4' />
                          <span>New Project</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Create New Project</DialogTitle>
                        <DialogDescription>
                          Create a new project to start squishing.
                        </DialogDescription>
                      </DialogHeader>
                      <div className='grid gap-4 py-4'>
                        <div className='grid gap-2'>
                          <Label htmlFor='name'>Project name</Label>
                          <Input
                            id='name'
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder='Chief do be spittin no cap fr'
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button onClick={handleAddProject}>
                          Create Project
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => setSettingsOpen(true)}>
                  <Cog className='w-4 h-4' />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <div className='flex-1 flex'>
          <div className='flex-1 relative'>
            {currentProject ? (
              <>
                <div className='w-full h-full flex flex-col'>
                  <div className='relative'>
                    <HeaderToolbar
                      selectedLayer={
                        layerData.find((l) => l.id === selectedLayerId) ?? null
                      }
                      onLayerUpdate={handleLayerUpdate}
                      isEditing={false}
                      onAddImage={handleAddImage}
                      onAddText={handleAddText}
                      onSave={() => {}}
                      onUndo={() => {}}
                      onRedo={() => {}}
                      onExport={() => {}}
                      canUndo={false}
                      canRedo={false}
                      sidebarTrigger={<SidebarTrigger />}
                      onBackgroundColorChange={handleBackgroundColorChange}
                      onBackgroundImageChange={handleBackgroundImageChange}
                      onClearBackground={handleClearBackground}
                      onLayerDelete={handleLayerDelete}
                      onLayerDuplicate={handleLayerDuplicate}
                      canvasBackground={canvasBackground}
                    />
                  </div>
                  <Canvas
                    projectId={currentProject.id}
                    layers={currentProject.layers}
                    selectedLayerId={selectedLayerId}
                    onLayerSelect={setSelectedLayerId}
                    onLayerUpdate={handleLayerUpdate}
                    onLayerReorder={handleLayerReorder}
                    onLayerDelete={handleLayerDelete}
                    onLayerDuplicate={handleLayerDuplicate}
                    showCanvasResizeHandles={showCanvasResizeHandles}
                    className='flex-1'
                    onAssetDataChange={setAssetData}
                    canvasSettingsVersion={canvasSettingsVersion}
                    canvasBackground={canvasBackground}
                    onBackgroundChange={handleBackgroundChange}
                    zoom={zoom}
                    onZoomChange={handleZoomChange}
                  />
                </div>

                {/* Controls */}
                <div className='absolute bottom-4 right-4 flex flex-col gap-2'>
                  <LayerPanelTrigger
                    isOpen={isLayerPanelOpen}
                    onClick={() => setIsLayerPanelOpen(!isLayerPanelOpen)}
                    triggerRef={layerPanelTriggerRef}
                  />
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

                {/* Layer Panel */}
                <LayerPanel
                  layers={currentProject.layers}
                  layerData={layerData}
                  selectedLayerId={selectedLayerId}
                  onLayerSelect={setSelectedLayerId}
                  onLayerReorder={handleLayerReorder}
                  onLayerDelete={handleLayerDelete}
                  onLayerDuplicate={handleLayerDuplicate}
                  isOpen={isLayerPanelOpen}
                  onOpenChange={setIsLayerPanelOpen}
                  triggerRef={layerPanelTriggerRef}
                  assetUrls={Object.fromEntries(
                    Object.entries(assetData)
                      .filter(
                        ([_, asset]) =>
                          asset.url && !asset.loading && !asset.error
                      )
                      .map(([id, asset]) => [id, asset.url])
                  )}
                />
              </>
            ) : (
              <div className='w-full h-full flex justify-center items-center'>
                <h1>Select a project or create a new one to get started</h1>
              </div>
            )}
          </div>
        </div>
      </SidebarProvider>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </main>
  );
}
