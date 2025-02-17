import "@/App.css";
import { Project, Layer } from "@/types/ProjectType";
import { Plus, Folder, Cog, Undo2, Redo2, Download, PlusCircle, Type, Maximize2 } from "lucide-react";
import { useState, useEffect } from "react";
import { 
  getProjects, 
  createProject, 
  deleteProject, 
  createImageAsset, 
  createLayer, 
  getProjectWithLayers,
  getDatabase,
  updateLayer,
} from "@/lib/db";
import { nanoid } from "nanoid";
import { SettingsDialog } from "@/components/settings-dialog";
import { Canvas } from "@/components/canvas";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
} from "@/components/ui/sidebar";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";


export default function Playground() {
  const [history, setHistory] = useState<Project[]>([]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [currentProject, setCurrentProject] = useState<Project>();
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [showCanvasResizeHandles, setShowCanvasResizeHandles] = useState(true);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const projects = await getProjects();
      setHistory(projects);
    } catch (error) {
      console.error("Failed to load projects:", error);
    }
  };

  const handleAddProject = async () => {
    if (!newProjectName.trim()) return;

    try {
      const newProject = {
        id: nanoid(),
        name: newProjectName.trim(),
      };

      await createProject(newProject);
      await loadProjects();
      
      // Load and set the newly created project as current
      const fullProject = await getProjectWithLayers(newProject.id);
      setCurrentProject(fullProject);
      
      setNewProjectName("");
      setNewProjectOpen(false);
    } catch (error) {
      console.error("Failed to create project:", error);
      toast.error("Failed to create project");
    }
  };

  const handleDeleteProject = async (project: Project) => {
    try {
      await deleteProject(project.id);
      await loadProjects();
      if (currentProject?.id === project.id) {
        setCurrentProject(undefined);
      }
    } catch (error) {
      console.error("Failed to delete project:", error);
    }
  };

  const handleProjectClick = async (project: Project) => {
    try {
      const fullProject = await getProjectWithLayers(project.id);
      setCurrentProject(fullProject);
    } catch (error) {
      console.error("Failed to load project:", error);
      toast.error("Failed to load project");
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
            // Create image asset
            const assetId = await createImageAsset(
              file.name,
              file.type,
              new Uint8Array(e.target.result)
            );

            // Position in the center of the canvas
            const layerId = await createLayer(currentProject.id, {
              id: nanoid(),
              type: 'image' as const,
              imageAssetId: assetId,
              transform: {
                x: 960 - 100, // Half of 1920 (canvas width) minus half of image width
                y: 540 - 100, // Half of 1080 (canvas height) minus half of image height
                width: 200,
                height: 200,
                rotation: 0,
                scale: 1,
                opacity: 1,
                blendMode: 'normal',
              },
            });

            // Update current project with new layer
            const newLayerIndex = currentProject.layers.length;
            setCurrentProject({
              ...currentProject,
              layers: [
                ...currentProject.layers,
                { id: layerId, index: newLayerIndex }
              ],
            });
            setSelectedLayerId(layerId);
          } catch (error) {
            console.error("Failed to create image layer:", error);
            toast.error("Failed to create image layer");
          }
        };

        reader.readAsArrayBuffer(file);
      };

      input.click();
    } catch (error) {
      console.error("Failed to add image:", error);
      toast.error("Failed to add image");
    }
  };

  const handleAddText = async () => {
    if (!currentProject) return;

    try {
      // Create text layer with default properties
      const layerId = await createLayer(currentProject.id, {
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
          textAlign: 'left',
          italic: false,
          underline: false,
          verticalAlign: 'center',
          wordWrap: 'normal',
        },
      });

      // Update current project with new layer
      const newLayerIndex = currentProject.layers.length;
      setCurrentProject({
        ...currentProject,
        layers: [
          ...currentProject.layers,
          { id: layerId, index: newLayerIndex }
        ],
      });
      setSelectedLayerId(layerId);
    } catch (error) {
      console.error("Failed to create text layer:", error);
      toast.error("Failed to create text layer");
    }
  };

  const handleLayerUpdate = async (updatedLayer: Layer) => {
    if (!currentProject) return;

    try {
      // Update the layer in the database
      await updateLayer(updatedLayer.id, updatedLayer);

      // Update local state
      const updatedLayers = currentProject.layers.map(layer =>
        layer.id === updatedLayer.id ? { ...layer } : layer
      );

      setCurrentProject({
        ...currentProject,
        layers: updatedLayers,
      });
    } catch (error) {
      console.error("Failed to update layer:", error);
      toast.error("Failed to update layer");
    }
  };

  const handleLayerReorder = async (layerId: string, newIndex: number) => {
    if (!currentProject) return;

    try {
      const db = await getDatabase();
      
      // Get current index of the layer being moved
      const currentIndex = currentProject.layers.find(l => l.id === layerId)?.index ?? 0;
      
      // Create a new array of layers with updated indices
      const updatedLayers = currentProject.layers.map(layer => {
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

      // Start a transaction to update all layers atomically
      await db.execute("BEGIN");

      try {
        // Update all layer indices in the database
        await Promise.all(
          updatedLayers.map(layer =>
            db.execute(
              "UPDATE layer_order SET index_number = $1 WHERE project_id = $2 AND layer_id = $3",
              [layer.index, currentProject.id, layer.id]
            )
          )
        );

        await db.execute("COMMIT");

        // Update local state
        setCurrentProject({
          ...currentProject,
          layers: updatedLayers,
        });

        // Log the updated layer order
        console.log('Layer order after reordering:', updatedLayers.map(l => ({
          id: l.id,
          index: l.index
        })));
      } catch (error) {
        await db.execute("ROLLBACK");
        throw error;
      }
    } catch (error) {
      console.error("Failed to reorder layer:", error);
      toast.error("Failed to reorder layer");
    }
  };

  const handleLayerDelete = async (layerId: string) => {
    if (!currentProject) return;

    try {
      const db = await getDatabase();
      
      // Delete layer from the database
      await db.execute(
        "DELETE FROM layers WHERE id = $1",
        [layerId]
      );

      // Update local state
      const updatedLayers = currentProject.layers.filter(layer => layer.id !== layerId);
      
      // Reindex remaining layers
      const reindexedLayers = updatedLayers.map((layer, index) => ({
        ...layer,
        index,
      }));

      // Update indices in the database
      await Promise.all(
        reindexedLayers.map(layer =>
          db.execute(
            "UPDATE layer_order SET index_number = $1 WHERE project_id = $2 AND layer_id = $3",
            [layer.index, currentProject.id, layer.id]
          )
        )
      );

      setCurrentProject({
        ...currentProject,
        layers: reindexedLayers,
      });
      
      if (selectedLayerId === layerId) {
        setSelectedLayerId(null);
      }
    } catch (error) {
      console.error("Failed to delete layer:", error);
      toast.error("Failed to delete layer");
    }
  };

  const handleLayerDuplicate = async (layerId: string) => {
    if (!currentProject) return;

    try {
      const db = await getDatabase();
      
      // Get the layer to duplicate
      const layer = await db.select<Array<{
        type: 'image' | 'sticker' | 'text';
        image_asset_id: string | null;
        sticker_asset_id: string | null;
        content: string | null;
        transform: string;
        style: string | null;
        crop: string | null;
      }>>(
        "SELECT type, image_asset_id, sticker_asset_id, content, transform, style, crop FROM layers WHERE id = $1",
        [layerId]
      );

      if (layer.length === 0) {
        throw new Error("Layer not found");
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
            ...(originalLayer.crop ? { crop: JSON.parse(originalLayer.crop) } : {})
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
            }
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
            }
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
          { id: newLayerId, index: newLayerIndex }
        ],
      });
      setSelectedLayerId(newLayerId);
    } catch (error) {
      console.error("Failed to duplicate layer:", error);
      toast.error("Failed to duplicate layer");
    }
  };

  return (
    <main className="w-screen h-screen bg-background text-foreground flex">
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <span className="font-bold">Squish</span>
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
                      <SidebarMenuButton
                        onClick={() => handleProjectClick(project)}
                        className={
                          currentProject?.id === project.id ? "bg-accent" : ""
                        }
                      >
                        <Folder className="w-4 h-4" />
                        <span>{project.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                  <Dialog
                    open={newProjectOpen}
                    onOpenChange={setNewProjectOpen}
                  >
                    <DialogTrigger asChild>
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <Plus className="w-4 h-4" />
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
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label htmlFor="name">Project name</Label>
                          <Input
                            id="name"
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder="Chief do be spittin no cap fr"
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
                  <Cog className="w-4 h-4" />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <div className="flex-1 flex flex-col">
          <div className="h-14 relative">
            <div className="absolute left-4 top-4 z-50">
              <SidebarTrigger />
            </div>
          </div>
          <div className="flex-1">
            {currentProject ? (
              <>
                <div className="fixed left-1/2 -translate-x-1/2 top-4 flex items-center gap-8 z-40">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={handleAddImage}
                  >
                    <PlusCircle className="w-4 h-4" aria-label="Add Image" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={handleAddText}
                  >
                    <Type className="w-4 h-4" aria-label="Add Text" />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Undo2 className="w-4 h-4" aria-label="Undo" />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Redo2 className="w-4 h-4" aria-label="Redo" />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Download className="w-4 h-4" aria-label="Download" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setShowCanvasResizeHandles(!showCanvasResizeHandles)}
                    className={cn(showCanvasResizeHandles && "bg-accent")}
                  >
                    <Maximize2 className="w-4 h-4" aria-label="Toggle Canvas Resize Handles" />
                  </Button>
                </div>
                <div className="w-full h-full flex flex-col">
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
                    className="flex-1"
                  />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex justify-center items-center">
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
