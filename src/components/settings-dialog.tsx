import { useState, useEffect } from "react";
import { getSettings, updateSettings, getDatabasePath } from "@/lib/db";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Copy } from "lucide-react";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [localHosted, setLocalHosted] = useState(true);
  const [runpodApiKey, setRunpodApiKey] = useState("");
  const [runpodInstanceId, setRunpodInstanceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [dbPath, setDbPath] = useState<string>("");

  // Load current settings when dialog opens
  useEffect(() => {
    if (open) {
      loadSettings();
      loadDbPath();
    }
  }, [open]);

  const loadSettings = async () => {
    try {
      const settings = await getSettings();
      if (settings) {
        setLocalHosted(settings.localHosted);
        setRunpodApiKey(settings.runpodApiKey || "");
        setRunpodInstanceId(settings.runpodInstanceId || "");
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      toast.error("Failed to load settings");
    }
  };

  const loadDbPath = async () => {
    try {
      const path = await getDatabasePath();
      setDbPath(path);
    } catch (error) {
      console.error("Failed to get database path:", error);
    }
  };

  const handleCopyDbPath = async () => {
    try {
      await navigator.clipboard.writeText(dbPath);
      toast.success("Database path copied to clipboard");
    } catch (error) {
      toast.error("Failed to copy database path");
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      
      const settings = localHosted 
        ? { localHosted: true as const }
        : {
            localHosted: false as const,
            runpodApiKey: runpodApiKey.trim(),
            runpodInstanceId: runpodInstanceId.trim(),
          };

      await updateSettings(settings);
      toast.success("Settings saved successfully");
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save settings", {
        description: error instanceof Error ? error.message : "Please check your inputs and try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure how you want to run Squish.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="localHosted">Run Locally</Label>
              <p className="text-sm text-muted-foreground">
                Use your local machine for processing
              </p>
            </div>
            <Switch
              id="localHosted"
              checked={localHosted}
              onCheckedChange={setLocalHosted}
            />
          </div>

          {!localHosted && (
            <div className="space-y-4 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="apiKey">RunPod API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={runpodApiKey}
                  onChange={(e) => setRunpodApiKey(e.target.value)}
                  placeholder="Enter your RunPod API key"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instanceId">RunPod Instance ID</Label>
                <Input
                  id="instanceId"
                  value={runpodInstanceId}
                  onChange={(e) => setRunpodInstanceId(e.target.value)}
                  placeholder="Enter your RunPod instance ID"
                />
              </div>
            </div>
          )}

          <div className="space-y-4 border-t pt-4">
            <div className="space-y-2">
              <Label>Database Location</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={dbPath}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyDbPath}
                  title="Copy database path"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Use this path to connect to the database with SQL Tools
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 