import '@/App.css';
import { Button } from '@/components/ui/button';
import { motion, Variants } from 'framer-motion';
import { initializeLocalSettings, initializeRunpodSettings } from '@/lib/db';
import { useNavigate } from 'react-router';
import { useState, useContext } from 'react';
import { SettingsUpdateSchema } from '@/types/SettingsType';
import { toast } from 'sonner';
import { SettingsContext } from '@/main';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Welcome() {
  const navigate = useNavigate();
  const { refreshSettings } = useContext(SettingsContext);
  const [runpodOpen, setRunpodOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [instanceId, setInstanceId] = useState('');

  const squishAnimation: Variants = {
    initial: {
      scaleX: 1,
      originX: 0.5,
    },
    animate: {
      scaleX: [1, 0.75, 1],
      transition: {
        duration: 2.5,
        repeat: 1,
        repeatType: 'reverse',
        ease: 'easeInOut',
      },
    },
  };

  const handleLocalSetup = async () => {
    try {
      const settings = { localHosted: true as const };
      SettingsUpdateSchema.parse(settings);
      await initializeLocalSettings();
      refreshSettings();
      navigate('/');
    } catch (error) {
      console.error('Failed to initialize local settings:', error);
      toast.error('Failed to initialize local settings', {
        description: 'Please try again.',
      });
    }
  };

  const handleRunpodSetup = async () => {
    try {
      const settings = {
        localHosted: false as const,
        runpodApiKey: apiKey.trim(),
        runpodInstanceId: instanceId.trim(),
      };

      // This will throw if validation fails
      SettingsUpdateSchema.parse(settings);

      await initializeRunpodSettings(
        settings.runpodApiKey,
        settings.runpodInstanceId
      );
      refreshSettings();
      navigate('/');
    } catch (error) {
      console.error('Failed to initialize RunPod settings:', error);
      toast.error('Failed to initialize RunPod settings', {
        description:
          error instanceof Error
            ? error.message
            : 'Please check your inputs and try again.',
      });
    }
  };

  return (
    <main className='w-screen h-screen bg-background text-foreground flex flex-col items-center justify-center'>
      <div className='flex items-center justify-center gap-2'>
        <h1 className='text-4xl font-bold'>Welcome to</h1>
        <motion.div
          className='origin-center'
          variants={squishAnimation}
          initial='initial'
          animate='animate'
        >
          <h1 className='text-4xl font-bold text-orange-500'>Squish</h1>
        </motion.div>
      </div>
      <h3 className='text-2xl text-muted-foreground animate-in fade-in-0 duration-300'>
        Your new home for cooking up memes
      </h3>
      <div className='flex gap-4 items-center justify-center pt-4'>
        <Button
          variant='outline'
          className='cursor-pointer'
          onClick={handleLocalSetup}
        >
          Run Locally
        </Button>
        <Button
          variant='default'
          className='cursor-pointer'
          onClick={() => setRunpodOpen(true)}
        >
          Use RunPod
        </Button>
      </div>

      <Dialog open={runpodOpen} onOpenChange={setRunpodOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>RunPod Configuration</DialogTitle>
            <DialogDescription>
              Enter your RunPod API key and instance ID to get started.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label htmlFor='apiKey'>RunPod API Key</Label>
              <Input
                id='apiKey'
                type='password'
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder='Enter your RunPod API key'
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='instanceId'>Instance ID</Label>
              <Input
                id='instanceId'
                value={instanceId}
                onChange={(e) => setInstanceId(e.target.value)}
                placeholder='Enter your RunPod instance ID'
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleRunpodSetup}>Save Configuration</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default Welcome;
