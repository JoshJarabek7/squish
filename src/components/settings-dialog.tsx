import { useState, useEffect, useCallback } from 'react';
import {
  getSettings,
  updateSettings,
  getDatabasePath,
  DEFAULT_FONTS,
  getEnabledFonts,
  updateFontEnabled,
  addSystemFont,
  initializeDefaultFonts,
} from '@/lib/db';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Copy, Plus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [localHosted, setLocalHosted] = useState(true);
  const [runpodApiKey, setRunpodApiKey] = useState('');
  const [runpodInstanceId, setRunpodInstanceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [dbPath, setDbPath] = useState<string>('');
  const [enabledFonts, setEnabledFonts] = useState<string[]>([]);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [loadingFonts, setLoadingFonts] = useState(false);
  const [fontSectionExpanded, setFontSectionExpanded] = useState(false);

  // Memoize loading functions
  const loadSettings = useCallback(async () => {
    try {
      const settings = await getSettings();
      if (settings) {
        setLocalHosted(settings.localHosted);
        setRunpodApiKey(settings.runpodApiKey || '');
        setRunpodInstanceId(settings.runpodInstanceId || '');
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      toast.error('Failed to load settings');
    }
  }, []);

  const loadDbPath = useCallback(async () => {
    try {
      const path = await getDatabasePath();
      setDbPath(path);
    } catch (error) {
      console.error('Failed to get database path:', error);
    }
  }, []);

  const loadFonts = useCallback(async () => {
    try {
      setLoadingFonts(true);
      await initializeDefaultFonts();
      const fonts = await getEnabledFonts();
      setEnabledFonts(fonts);

      // Only load system fonts if the font section is expanded
      if (fontSectionExpanded) {
        const sysFonts = await invoke<string[]>('get_system_fonts');
        setSystemFonts(sysFonts);
      }
    } catch (error) {
      console.error('Failed to load fonts:', error);
      toast.error('Failed to load fonts');
    } finally {
      setLoadingFonts(false);
    }
  }, [fontSectionExpanded]);

  // Load data when dialog opens
  useEffect(() => {
    if (open) {
      Promise.all([loadSettings(), loadDbPath(), loadFonts()]).catch(
        (error) => {
          console.error('Failed to load dialog data:', error);
        }
      );
    }
  }, [open, loadSettings, loadDbPath, loadFonts]);

  // Load system fonts when font section is expanded
  useEffect(() => {
    if (fontSectionExpanded && systemFonts.length === 0) {
      invoke<string[]>('get_system_fonts')
        .then((fonts) => setSystemFonts(fonts))
        .catch((error) => {
          console.error('Failed to load system fonts:', error);
          toast.error('Failed to load system fonts');
        });
    }
  }, [fontSectionExpanded]);

  const handleCopyDbPath = async () => {
    try {
      await navigator.clipboard.writeText(dbPath);
      toast.success('Database path copied to clipboard');
    } catch (error) {
      toast.error('Failed to copy database path');
    }
  };

  const handleFontToggle = async (font: string, enabled: boolean) => {
    try {
      await updateFontEnabled(font, enabled);
      const fonts = await getEnabledFonts();
      setEnabledFonts(fonts);
    } catch (error) {
      console.error('Failed to update font:', error);
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Failed to update font');
      }
    }
  };

  const handleAddSystemFont = async (font: string) => {
    try {
      await addSystemFont(font);
      const fonts = await getEnabledFonts();
      setEnabledFonts(fonts);
      toast.success(`Added ${font} to available fonts`);
    } catch (error) {
      console.error('Failed to add font:', error);
      toast.error('Failed to add font');
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
      toast.success('Settings saved successfully');
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast.error('Failed to save settings', {
        description:
          error instanceof Error
            ? error.message
            : 'Please check your inputs and try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[425px]'>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure how you want to run Squish.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='flex items-center justify-between'>
            <div className='space-y-0.5'>
              <Label htmlFor='localHosted'>Run Locally</Label>
              <p className='text-sm text-muted-foreground'>
                Use your local machine for processing
              </p>
            </div>
            <Switch
              id='localHosted'
              checked={localHosted}
              onCheckedChange={setLocalHosted}
            />
          </div>

          {!localHosted && (
            <div className='space-y-4 border-t pt-4'>
              <div className='space-y-2'>
                <Label htmlFor='apiKey'>RunPod API Key</Label>
                <Input
                  id='apiKey'
                  type='password'
                  value={runpodApiKey}
                  onChange={(e) => setRunpodApiKey(e.target.value)}
                  placeholder='Enter your RunPod API key'
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='instanceId'>RunPod Instance ID</Label>
                <Input
                  id='instanceId'
                  value={runpodInstanceId}
                  onChange={(e) => setRunpodInstanceId(e.target.value)}
                  placeholder='Enter your RunPod instance ID'
                />
              </div>
            </div>
          )}

          <div className='space-y-4 border-t pt-4'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label>Font Management</Label>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setFontSectionExpanded(!fontSectionExpanded)}
                >
                  {fontSectionExpanded ? 'Collapse' : 'Expand'}
                </Button>
              </div>
              {fontSectionExpanded && (
                <div className='space-y-4'>
                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>Default Fonts</Label>
                    <div className='space-y-2'>
                      {DEFAULT_FONTS.map((font) => (
                        <div
                          key={font}
                          className='flex items-center justify-between'
                        >
                          <span style={{ fontFamily: font }}>{font}</span>
                          <Switch
                            checked={enabledFonts.includes(font)}
                            onCheckedChange={(checked) =>
                              handleFontToggle(font, checked)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>System Fonts</Label>
                    {loadingFonts ? (
                      <p className='text-sm text-muted-foreground'>
                        Loading fonts...
                      </p>
                    ) : (
                      <div className='max-h-[200px] overflow-y-auto space-y-2'>
                        {systemFonts
                          .filter((font) => !DEFAULT_FONTS.includes(font))
                          .map((font) => (
                            <div
                              key={font}
                              className='flex items-center justify-between'
                            >
                              <span style={{ fontFamily: font }}>{font}</span>
                              {enabledFonts.includes(font) ? (
                                <Switch
                                  checked={true}
                                  onCheckedChange={(checked) =>
                                    handleFontToggle(font, checked)
                                  }
                                />
                              ) : (
                                <Button
                                  variant='outline'
                                  size='sm'
                                  onClick={() => handleAddSystemFont(font)}
                                >
                                  <Plus className='h-4 w-4' />
                                </Button>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className='space-y-4 border-t pt-4'>
            <div className='space-y-2'>
              <Label>Database Location</Label>
              <div className='flex items-center gap-2'>
                <Input value={dbPath} readOnly className='font-mono text-sm' />
                <Button
                  variant='outline'
                  size='icon'
                  onClick={handleCopyDbPath}
                  title='Copy database path'
                >
                  <Copy className='h-4 w-4' />
                </Button>
              </div>
              <p className='text-sm text-muted-foreground'>
                Use this path to connect to the database with SQL Tools
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
