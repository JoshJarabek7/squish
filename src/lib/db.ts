import {
  Project,
  ProjectSchema,
  type ProjectCreate,
  type Layer,
  type Action,
  type ActionType,
  type LayerCreateSchema,
} from '@/types/ProjectType';
import {
  Settings,
  SettingsSchema,
  SettingsUpdateSchema,
  type SettingsUpdate,
} from '@/types/SettingsType';
import Database from '@tauri-apps/plugin-sql';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { convertToTransparentPng } from '@/lib/utils';

type LayerCreate = z.infer<typeof LayerCreateSchema>;

// Create a store for the database connection
let db: Database | null = null;
let initializationPromise: Promise<Database | null> | null = null;

// Update canvas_settings in TABLES
const TABLES = {
  projects: `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      current_action_index INTEGER DEFAULT -1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  settings: `
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      local_hosted INTEGER NOT NULL CHECK (local_hosted IN (0, 1)),
      runpod_api_key TEXT,
      runpod_instance_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (local_hosted = 1 AND runpod_api_key IS NULL AND runpod_instance_id IS NULL) OR
        (local_hosted = 0 AND runpod_api_key IS NOT NULL AND runpod_instance_id IS NOT NULL)
      )
    )
  `,
  fonts: `
    CREATE TABLE IF NOT EXISTS fonts (
      name TEXT PRIMARY KEY,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  image_assets: `
    CREATE TABLE IF NOT EXISTS image_assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  sticker_assets: `
    CREATE TABLE IF NOT EXISTS sticker_assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_image_id TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_image_id) REFERENCES image_assets(id)
    )
  `,
  layers: `
    CREATE TABLE IF NOT EXISTS layers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('image', 'sticker', 'text')),
      image_asset_id TEXT,
      sticker_asset_id TEXT,
      content TEXT,
      transform TEXT NOT NULL, -- JSON object
      style TEXT, -- JSON object for text layers
      crop TEXT, -- JSON object for image layers
      vertical_align TEXT CHECK (vertical_align IN ('top', 'center', 'bottom')),
      word_wrap TEXT CHECK (word_wrap IN ('normal', 'break-word')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (image_asset_id) REFERENCES image_assets(id) ON DELETE SET NULL,
      FOREIGN KEY (sticker_asset_id) REFERENCES sticker_assets(id) ON DELETE SET NULL,
      CHECK (
        (type = 'image' AND image_asset_id IS NOT NULL AND sticker_asset_id IS NULL AND content IS NULL AND style IS NULL AND vertical_align IS NULL AND word_wrap IS NULL) OR
        (type = 'sticker' AND sticker_asset_id IS NOT NULL AND image_asset_id IS NULL AND content IS NULL AND style IS NULL AND vertical_align IS NULL AND word_wrap IS NULL) OR
        (type = 'text' AND image_asset_id IS NULL AND sticker_asset_id IS NULL AND content IS NOT NULL AND style IS NOT NULL)
      )
    )
  `,
  layer_order: `
    CREATE TABLE IF NOT EXISTS layer_order (
      project_id TEXT NOT NULL,
      layer_id TEXT NOT NULL,
      index_number INTEGER NOT NULL,
      PRIMARY KEY (project_id, layer_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (layer_id) REFERENCES layers(id) ON DELETE CASCADE
    )
  `,
  actions: `
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      layer_id TEXT NOT NULL,
      before TEXT NOT NULL, -- JSON object
      after TEXT NOT NULL, -- JSON object
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (layer_id) REFERENCES layers(id) ON DELETE CASCADE
    )
  `,
  canvas_settings: `
    CREATE TABLE IF NOT EXISTS canvas_settings (
      project_id TEXT PRIMARY KEY,
      width INTEGER NOT NULL DEFAULT 1920,
      height INTEGER NOT NULL DEFAULT 1080,
      background_type TEXT CHECK(background_type IN ('color', 'image', 'none')) NOT NULL DEFAULT 'none',
      background_color TEXT DEFAULT '#FFFFFF',
      background_image_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (background_image_id) REFERENCES image_assets(id)
    )
  `,
} as const;

// Get the absolute path to the database
export async function getDatabasePath(): Promise<string> {
  const configDir = await appConfigDir();
  console.log('Config directory:', configDir);
  return join(configDir, 'squish.db');
}

// Initialize database tables
export async function initTables(db: Database) {
  try {
    console.log('Initializing tables...');
    for (const [tableName, createTable] of Object.entries(TABLES)) {
      console.log(`Creating table: ${tableName}`);
      await db.execute(createTable);
      console.log(`Table ${tableName} created successfully`);
    }
    console.log('All tables initialized successfully');
  } catch (error) {
    console.error('Error during table initialization:', error);
    throw error;
  }
}

// Project operations
export async function getProjects(): Promise<Project[]> {
  const db = await getDatabase();
  const result = await db.select<
    Array<{
      id: string;
      name: string;
      current_action_index: number;
      created_at: string;
      updated_at: string;
    }>
  >('SELECT * FROM projects ORDER BY updated_at DESC');

  const projects = await Promise.all(
    result.map(async (row) => {
      const layers = await getLayerOrder(row.id);
      const project = {
        id: row.id,
        name: row.name,
        layers,
        currentActionIndex: row.current_action_index,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
      return ProjectSchema.parse(project);
    })
  );

  return projects;
}

export async function createProject(project: ProjectCreate): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  await withTransaction(db, async () => {
    // Create project
    await db.execute(
      'INSERT INTO projects (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)',
      [project.id, project.name, now, now]
    );

    // Create initial canvas settings
    await db.execute(
      `INSERT INTO canvas_settings (
        project_id, 
        width, 
        height, 
        background_type,
        created_at
      ) VALUES ($1, $2, $3, $4, $5)`,
      [project.id, 1920, 1080, 'none', now]
    );
  });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute('DELETE FROM projects WHERE id = $1', [id]);
}

// Settings operations
export async function getSettings(): Promise<Settings | null> {
  const db = await getDatabase();
  console.log('Getting settings from database...');
  const result = await db.select<
    Array<{
      id: number;
      local_hosted: number;
      runpod_api_key: string | null;
      runpod_instance_id: string | null;
      created_at: string;
    }>
  >('SELECT * FROM settings WHERE id = 1');

  console.log('Raw settings result:', result);

  if (result.length === 0) {
    console.log('No settings found in database');
    return null;
  }

  const settings = {
    localHosted: Boolean(result[0].local_hosted),
    runpodApiKey: result[0].runpod_api_key,
    runpodInstanceId: result[0].runpod_instance_id,
    createdAt: new Date(result[0].created_at),
  };

  console.log('Parsed settings:', settings);
  return SettingsSchema.parse(settings);
}

export async function initializeLocalSettings(): Promise<void> {
  const db = await getDatabase();
  const settings: SettingsUpdate = { localHosted: true };
  SettingsUpdateSchema.parse(settings);

  await db.execute(
    'INSERT OR REPLACE INTO settings (id, local_hosted, runpod_api_key, runpod_instance_id) VALUES (1, 1, NULL, NULL)'
  );
}

export async function initializeRunpodSettings(
  apiKey: string,
  instanceId: string
): Promise<void> {
  const db = await getDatabase();
  const settings: SettingsUpdate = {
    localHosted: false,
    runpodApiKey: apiKey,
    runpodInstanceId: instanceId,
  };
  SettingsUpdateSchema.parse(settings);

  await db.execute(
    'INSERT OR REPLACE INTO settings (id, local_hosted, runpod_api_key, runpod_instance_id) VALUES (1, 0, $1, $2)',
    [apiKey, instanceId]
  );
}

export async function updateSettings(settings: SettingsUpdate): Promise<void> {
  const db = await getDatabase();
  const validatedSettings = SettingsUpdateSchema.parse(settings);

  // Check if settings already exist
  const currentSettings = await getSettings();
  const exists = currentSettings !== null;

  if (validatedSettings.localHosted) {
    if (exists) {
      await db.execute(
        'UPDATE settings SET local_hosted = 1, runpod_api_key = NULL, runpod_instance_id = NULL WHERE id = 1'
      );
    } else {
      await db.execute('INSERT INTO settings (id, local_hosted) VALUES (1, 1)');
    }
  } else {
    if (
      !validatedSettings.runpodApiKey ||
      !validatedSettings.runpodInstanceId
    ) {
      throw new Error(
        'RunPod API key and instance ID are required when not using local hosting'
      );
    }

    if (exists) {
      await db.execute(
        'UPDATE settings SET local_hosted = 0, runpod_api_key = $1, runpod_instance_id = $2 WHERE id = 1',
        [validatedSettings.runpodApiKey, validatedSettings.runpodInstanceId]
      );
    } else {
      await db.execute(
        'INSERT INTO settings (id, local_hosted, runpod_api_key, runpod_instance_id) VALUES (1, 0, $1, $2)',
        [validatedSettings.runpodApiKey, validatedSettings.runpodInstanceId]
      );
    }
  }
}

// Asset operations
export async function createImageAsset(
  name: string,
  mimeType: string,
  data: Uint8Array
): Promise<string> {
  const db = await getDatabase();
  const id = nanoid();

  console.log('Creating image asset:', {
    name,
    mimeType,
    dataLength: data.length,
    id,
    dataPreview: Array.from(data.slice(0, 10)),
  });

  try {
    // Convert the image to a transparent PNG
    const { data: pngData } = await convertToTransparentPng(data, mimeType);

    // Convert Uint8Array to array and then to string for consistent storage
    const dataArray = Array.from(pngData);
    const dataString = JSON.stringify(dataArray);

    console.log('Storing PNG data as string:', {
      originalLength: data.length,
      pngLength: pngData.length,
      stringLength: dataString.length,
      preview: dataString.substring(0, 50),
    });

    // Store the stringified array with PNG mime type
    await db.execute(
      'INSERT INTO image_assets (id, name, mime_type, data) VALUES ($1, $2, $3, $4)',
      [id, name, 'image/png', dataString]
    );

    // Verify the asset was created and data is correct
    const result = await db.select<Array<{ id: string; data: string }>>(
      'SELECT id, data FROM image_assets WHERE id = $1',
      [id]
    );

    if (result.length === 0) {
      throw new Error('Image asset was not created successfully');
    }

    // Parse the stored data back to verify it's correct
    const storedData = result[0].data;
    const parsedArray = JSON.parse(storedData);
    const verificationData = new Uint8Array(parsedArray);

    console.log('Image asset created and verified:', {
      id,
      originalLength: data.length,
      pngLength: pngData.length,
      storedLength: verificationData.length,
      dataMatches: pngData.length === verificationData.length,
      preview: Array.from(verificationData.slice(0, 10)),
    });

    if (pngData.length !== verificationData.length) {
      throw new Error('Stored data length does not match PNG data');
    }

    return id;
  } catch (error) {
    console.error('Failed to create image asset:', error);
    throw error;
  }
}

export async function createStickerAsset(
  name: string,
  sourceImageId: string,
  data: Uint8Array
): Promise<string> {
  const db = await getDatabase();
  const id = nanoid();

  await db.execute(
    'INSERT INTO sticker_assets (id, name, source_image_id, data) VALUES ($1, $2, $3, $4)',
    [id, name, sourceImageId, data]
  );

  return id;
}

export async function getImageAsset(id: string): Promise<Uint8Array> {
  const db = await getDatabase();
  const result = await db.select<Array<{ data: Uint8Array }>>(
    'SELECT data FROM image_assets WHERE id = $1',
    [id]
  );

  if (result.length === 0) {
    throw new Error(`Image asset not found: ${id}`);
  }

  return result[0].data;
}

// Layer operations
export async function createLayer(
  projectId: string,
  layer: LayerCreate
): Promise<string> {
  const db = await getDatabase();
  const layerId = layer.id;

  // Get the next available index first
  const maxIndex = await db.select<Array<{ max_index: number }>>(
    'SELECT COALESCE(MAX(index_number), -1) as max_index FROM layer_order WHERE project_id = $1',
    [projectId]
  );
  const nextIndex = (maxIndex[0]?.max_index ?? -1) + 1;

  if (layer.type === 'text') {
    const style = {
      fontFamily: layer.style?.fontFamily ?? 'Inter',
      fontSize: layer.style?.fontSize ?? 24,
      fontWeight: layer.style?.fontWeight ?? 400,
      color: layer.style?.color ?? '#FFFFFF',
      textAlign: layer.style?.textAlign ?? 'left',
      italic: layer.style?.italic ?? false,
      underline: layer.style?.underline ?? false,
      verticalAlign: layer.style?.verticalAlign ?? 'center',
      wordWrap: layer.style?.wordWrap ?? 'normal',
    };

    await db.execute(
      `INSERT INTO layers (
        id, 
        project_id, 
        type, 
        content, 
        style, 
        transform,
        vertical_align,
        word_wrap
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        layerId,
        projectId,
        layer.type,
        layer.content ?? '',
        JSON.stringify(style),
        JSON.stringify(layer.transform),
        style.verticalAlign,
        style.wordWrap,
      ]
    );
  } else if (layer.type === 'image') {
    await db.execute(
      `INSERT INTO layers (
        id, 
        project_id, 
        type, 
        transform, 
        image_asset_id
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        layerId,
        projectId,
        layer.type,
        JSON.stringify(layer.transform),
        layer.imageAssetId,
      ]
    );
  } else if (layer.type === 'sticker') {
    await db.execute(
      `INSERT INTO layers (
        id, 
        project_id, 
        type, 
        transform, 
        sticker_asset_id
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        layerId,
        projectId,
        layer.type,
        JSON.stringify(layer.transform),
        layer.stickerAssetId,
      ]
    );
  }

  // Add layer to layer_order with the next available index
  await db.execute(
    'INSERT INTO layer_order (project_id, layer_id, index_number) VALUES ($1, $2, $3)',
    [projectId, layerId, nextIndex]
  );

  return layerId;
}

// Add transaction helper function
export async function withTransaction<T>(
  db: Database,
  operation: () => Promise<T>
): Promise<T> {
  let inTransaction = false;
  try {
    // Check if we're already in a transaction
    const transactionState = await db.select<Array<{ count: number }>>(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='sqlite_master'"
    );
    inTransaction = transactionState[0].count === 0;

    if (!inTransaction) {
      await db.execute('BEGIN IMMEDIATE');
    }

    const result = await operation();

    if (!inTransaction) {
      await db.execute('COMMIT');
    }

    return result;
  } catch (error) {
    if (!inTransaction) {
      try {
        await db.execute('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback:', rollbackError);
      }
    }
    throw error;
  }
}

// Modify updateLayer to use the transaction helper
export async function updateLayer(
  layerId: string,
  layer: Layer
): Promise<void> {
  const db = await getDatabase();
  const { transform } = layer;

  await withTransaction(db, async () => {
    await db.execute('UPDATE layers SET transform = $1 WHERE id = $2', [
      JSON.stringify(transform),
      layerId,
    ]);

    switch (layer.type) {
      case 'text':
        await db.execute(
          'UPDATE layers SET content = $1, style = $2, vertical_align = $3, word_wrap = $4 WHERE id = $5',
          [
            layer.content,
            JSON.stringify(layer.style),
            layer.style.verticalAlign,
            layer.style.wordWrap,
            layerId,
          ]
        );
        break;
      case 'image':
        if (layer.crop) {
          await db.execute('UPDATE layers SET crop = $1 WHERE id = $2', [
            JSON.stringify(layer.crop),
            layerId,
          ]);
        }
        break;
    }
  });
}

// Action operations
export async function createAction(
  action: Omit<Action, 'id' | 'timestamp'>
): Promise<string> {
  const db = await getDatabase();
  const id = nanoid();

  await db.execute(
    `INSERT INTO actions (
      id, project_id, type, layer_id, before, after
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      action.projectId,
      action.type,
      action.layerId,
      JSON.stringify(action.before),
      JSON.stringify(action.after),
    ]
  );

  return id;
}

export async function getProjectActions(projectId: string): Promise<Action[]> {
  const db = await getDatabase();
  const result = await db.select<
    Array<{
      id: string;
      project_id: string;
      type: string;
      layer_id: string;
      before: string;
      after: string;
      timestamp: string;
    }>
  >('SELECT * FROM actions WHERE project_id = $1 ORDER BY timestamp ASC', [
    projectId,
  ]);

  return result.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    type: row.type as ActionType,
    layerId: row.layer_id,
    before: JSON.parse(row.before),
    after: JSON.parse(row.after),
    timestamp: new Date(row.timestamp),
  }));
}

// Initialize all tables
export async function initializeDatabase() {
  const db = await getDatabase();
  await initTables(db);
}

// Layer operations
export async function getProjectLayers(projectId: string): Promise<Layer[]> {
  const db = await getDatabase();

  // Get all layers for the project
  const layerRows = await db.select<
    Array<{
      id: string;
      type: string;
      content: string | null;
      style: string | null;
      transform: string;
      image_asset_id: string | null;
      sticker_asset_id: string | null;
      vertical_align: string | null;
      word_wrap: string | null;
      created_at: string;
    }>
  >(
    `SELECT l.*, lo.index_number 
     FROM layers l 
     JOIN layer_order lo ON l.id = lo.layer_id 
     WHERE l.project_id = ? 
     ORDER BY lo.index_number`,
    [projectId]
  );

  return layerRows.map((row) => {
    const transform = JSON.parse(row.transform);
    const baseLayer = {
      id: row.id,
      transform,
      createdAt: new Date(row.created_at),
    };

    if (row.type === 'text') {
      const style = JSON.parse(row.style || '{}');
      return {
        ...baseLayer,
        type: 'text' as const,
        content: row.content || '',
        style: {
          ...style,
          verticalAlign: row.vertical_align || 'center',
          wordWrap: row.word_wrap || 'normal',
        },
      };
    } else if (row.type === 'image') {
      return {
        ...baseLayer,
        type: 'image' as const,
        imageAssetId: row.image_asset_id!,
      };
    } else {
      return {
        ...baseLayer,
        type: 'sticker' as const,
        stickerAssetId: row.sticker_asset_id!,
      };
    }
  });
}

export async function getLayerOrder(
  projectId: string
): Promise<Array<{ id: string; index: number }>> {
  const db = await getDatabase();
  const result = await db.select<
    Array<{
      layer_id: string;
      index_number: number;
    }>
  >(
    'SELECT layer_id, index_number FROM layer_order WHERE project_id = $1 ORDER BY index_number',
    [projectId]
  );

  return result.map((row) => ({
    id: row.layer_id,
    index: row.index_number,
  }));
}

export async function getProjectWithLayers(id: string): Promise<Project> {
  const db = await getDatabase();
  const result = await db.select<
    Array<{
      id: string;
      name: string;
      current_action_index: number;
      created_at: string;
      updated_at: string;
    }>
  >('SELECT * FROM projects WHERE id = $1', [id]);

  if (result.length === 0) {
    throw new Error(`Project not found: ${id}`);
  }

  const row = result[0];
  const layers = await getLayerOrder(id);

  return {
    id: row.id,
    name: row.name,
    layers,
    currentActionIndex: row.current_action_index,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// Asset operations
export async function getImageAssetData(
  id: string
): Promise<{ data: Uint8Array; mimeType: string }> {
  const db = await getDatabase();
  console.log('Fetching image asset:', id);

  const result = await db.select<
    Array<{ data: Uint8Array | string; mime_type: string }>
  >('SELECT data, mime_type FROM image_assets WHERE id = $1', [id]);

  if (result.length === 0) {
    console.error('Image asset not found:', id);
    throw new Error(`Image asset not found: ${id}`);
  }

  const rawData = result[0].data;
  console.log(
    'Raw data type:',
    typeof rawData,
    rawData instanceof Uint8Array ? 'Uint8Array' : 'other'
  );
  console.log(
    'Raw data preview:',
    typeof rawData === 'string' ? rawData.substring(0, 50) : 'binary data'
  );

  // Handle string data (which is likely an array-like string from SQLite)
  let data: Uint8Array;
  if (typeof rawData === 'string') {
    try {
      // Check if it's a JSON string of numbers
      if (rawData.startsWith('[') && rawData.endsWith(']')) {
        const numbers = JSON.parse(rawData);
        data = new Uint8Array(numbers);
      } else {
        // Try to parse as comma-separated numbers
        const numbers = rawData.split(',').map((n) => parseInt(n.trim(), 10));
        data = new Uint8Array(numbers);
      }
      console.log('Converted string data to Uint8Array:', {
        originalLength: rawData.length,
        convertedLength: data.length,
        preview: Array.from(data.slice(0, 10)),
      });
    } catch (error) {
      console.error('Failed to parse string data:', error);
      throw new Error('Failed to parse binary data from string format');
    }
  } else if (rawData instanceof Uint8Array) {
    data = rawData;
  } else if (ArrayBuffer.isView(rawData)) {
    data = new Uint8Array((rawData as ArrayBufferView).buffer);
  } else if (
    typeof rawData === 'object' &&
    rawData !== null &&
    'buffer' in rawData
  ) {
    data = new Uint8Array((rawData as { buffer: ArrayBuffer }).buffer);
  } else if (Array.isArray(rawData)) {
    data = new Uint8Array(rawData);
  } else {
    console.error('Unexpected data type:', {
      type: typeof rawData,
      isArray: Array.isArray(rawData),
      preview: rawData,
    });
    throw new Error('Invalid binary data format');
  }

  if (data.length === 0) {
    console.error('Retrieved data is empty:', {
      id,
      dataType: typeof rawData,
      isUint8Array: rawData instanceof Uint8Array,
      rawDataLength: typeof rawData === 'string' ? rawData.length : 'N/A',
      rawDataPreview:
        typeof rawData === 'string' ? rawData.substring(0, 100) : 'N/A',
    });
    throw new Error('Retrieved image data is empty');
  }

  console.log('Image asset retrieved:', {
    id,
    mimeType: result[0].mime_type,
    dataLength: data.length,
    dataPreview: Array.from(data.slice(0, 10)),
  });

  return {
    data,
    mimeType: result[0].mime_type,
  };
}

export async function getStickerAssetData(id: string): Promise<Uint8Array> {
  const db = await getDatabase();
  const result = await db.select<Array<{ data: Uint8Array }>>(
    'SELECT data FROM sticker_assets WHERE id = $1',
    [id]
  );

  if (result.length === 0) {
    throw new Error(`Sticker asset not found: ${id}`);
  }

  return result[0].data;
}

// Add function to get canvas settings
export async function getCanvasSettings(projectId: string): Promise<{
  width: number;
  height: number;
  backgroundType: 'color' | 'image' | 'none';
  backgroundColor?: string;
  backgroundImageId?: string;
}> {
  const db = await getDatabase();
  const result = await db.select<
    Array<{
      width: number;
      height: number;
      background_type: 'color' | 'image' | 'none';
      background_color: string | null;
      background_image_id: string | null;
    }>
  >(
    `SELECT width, height, background_type, background_color, background_image_id 
     FROM canvas_settings WHERE project_id = $1`,
    [projectId]
  );

  if (result.length === 0) {
    // Return default settings if no settings found
    return {
      width: 1920,
      height: 1080,
      backgroundType: 'none',
    };
  }

  return {
    width: result[0].width,
    height: result[0].height,
    backgroundType: result[0].background_type,
    backgroundColor: result[0].background_color || undefined,
    backgroundImageId: result[0].background_image_id || undefined,
  };
}

// Modify updateCanvasSettings to use the transaction helper
export async function updateCanvasSettings(
  projectId: string,
  settings: {
    width?: number;
    height?: number;
    backgroundType?: 'color' | 'image' | 'none';
    backgroundColor?: string;
    backgroundImageId?: string;
  }
): Promise<void> {
  const db = await getDatabase();

  await withTransaction(db, async () => {
    // Check if record exists
    const exists = await db.select<Array<{ count: number }>>(
      'SELECT COUNT(*) as count FROM canvas_settings WHERE project_id = $1',
      [projectId]
    );

    if (exists[0].count === 0) {
      // Create initial record if it doesn't exist
      await db.execute(
        `INSERT INTO canvas_settings (
          project_id, 
          width, 
          height, 
          background_type,
          created_at
        ) VALUES ($1, $2, $3, $4, $5)`,
        [projectId, 1920, 1080, 'none', new Date().toISOString()]
      );
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (settings.width !== undefined) {
      updates.push(`width = $${paramIndex}`);
      values.push(settings.width);
      paramIndex++;
    }

    if (settings.height !== undefined) {
      updates.push(`height = $${paramIndex}`);
      values.push(settings.height);
      paramIndex++;
    }

    if (settings.backgroundType !== undefined) {
      updates.push(`background_type = $${paramIndex}`);
      values.push(settings.backgroundType);
      paramIndex++;

      if (settings.backgroundType === 'color' && settings.backgroundColor) {
        updates.push(`background_color = $${paramIndex}`);
        values.push(settings.backgroundColor);
        paramIndex++;
      } else if (
        settings.backgroundType === 'image' &&
        settings.backgroundImageId
      ) {
        updates.push(`background_image_id = $${paramIndex}`);
        values.push(settings.backgroundImageId);
        paramIndex++;
      }
    }

    if (updates.length > 0) {
      values.push(projectId);
      await db.execute(
        `UPDATE canvas_settings SET ${updates.join(', ')} WHERE project_id = $${paramIndex}`,
        values
      );
    }
  });
}

export async function updateProjectTimestamp(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    'UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [id]
  );
}

// Add after other exports
export const DEFAULT_FONTS = [
  'Times New Roman',
  'Arial',
  'Helvetica',
  'Inter',
  'Georgia',
];

export async function initializeDefaultFonts(): Promise<void> {
  const db = await getDatabase();
  console.log('Initializing default fonts with:', DEFAULT_FONTS);

  try {
    await withTransaction(db, async () => {
      // Insert default fonts if they don't exist
      for (const font of DEFAULT_FONTS) {
        await db.execute(
          'INSERT OR REPLACE INTO fonts (name, is_enabled, is_system) VALUES ($1, 1, 0)',
          [font]
        );
      }
    });
    console.log('Default fonts initialized successfully');
  } catch (error) {
    console.error('Failed to initialize default fonts:', error);
    throw error;
  }
}

export async function getEnabledFonts(): Promise<string[]> {
  const db = await getDatabase();
  try {
    console.log('Fetching enabled fonts...');
    const result = await db.select<Array<{ name: string }>>(
      'SELECT name FROM fonts WHERE is_enabled = 1 ORDER BY name'
    );
    const fonts = result.map((row) => row.name);
    console.log('Enabled fonts:', fonts);
    return fonts;
  } catch (error) {
    console.error('Failed to fetch enabled fonts:', error);
    // Return default fonts as fallback
    return Array.from(DEFAULT_FONTS);
  }
}

export async function getSystemFonts(): Promise<string[]> {
  const db = await getDatabase();
  const result = await db.select<Array<{ name: string }>>(
    'SELECT name FROM fonts WHERE is_system = 1 AND is_enabled = 1 ORDER BY name'
  );
  return result.map((row) => row.name);
}

export async function addSystemFont(name: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    'INSERT OR IGNORE INTO fonts (name, is_enabled, is_system) VALUES ($1, 1, 1)',
    [name]
  );
}

export async function updateFontEnabled(
  name: string,
  isEnabled: boolean
): Promise<void> {
  const db = await getDatabase();

  // Don't allow disabling the last enabled font
  if (!isEnabled) {
    const enabledCount = await db.select<Array<{ count: number }>>(
      'SELECT COUNT(*) as count FROM fonts WHERE is_enabled = 1'
    );
    if (enabledCount[0].count <= 1) {
      throw new Error('Cannot disable the last remaining font');
    }
  }

  await db.execute('UPDATE fonts SET is_enabled = $1 WHERE name = $2', [
    isEnabled ? 1 : 0,
    name,
  ]);
}

// Simplify initDatabase
export async function initDatabase() {
  if (initializationPromise) {
    return initializationPromise;
  }

  if (db) {
    console.log('Database already initialized');
    return db;
  }

  initializationPromise = (async () => {
    try {
      const dbPath = await getDatabasePath();
      console.log('Initializing database at:', dbPath);

      console.log('Loading database...');
      const newDb = await Database.load(`sqlite:${dbPath}`);
      console.log('Database loaded successfully');

      if (newDb) {
        // Enable WAL mode for better concurrency
        console.log('Enabling WAL mode...');
        await newDb.execute('PRAGMA journal_mode=WAL');
        await newDb.execute('PRAGMA synchronous=NORMAL');
        await newDb.execute('PRAGMA busy_timeout=10000'); // Increase timeout to 10 seconds
        await newDb.execute('PRAGMA locking_mode=NORMAL');
        await newDb.execute('PRAGMA cache_size=-2000'); // 2MB cache
        console.log('WAL mode enabled');

        // Use a single transaction for all initialization
        await withTransaction(newDb, async () => {
          console.log('Starting table initialization...');
          await initTables(newDb);
          console.log('Table initialization completed');

          // Initialize default fonts within the same transaction
          console.log('Initializing default fonts...');
          for (const font of DEFAULT_FONTS) {
            await newDb.execute(
              'INSERT OR REPLACE INTO fonts (name, is_enabled, is_system) VALUES ($1, 1, 0)',
              [font]
            );
          }
          console.log('Default fonts initialized');
        });

        // Only set the global db variable after successful initialization
        db = newDb;
      } else {
        console.error('Database failed to load');
      }
      return db;
    } catch (error) {
      console.error('Error during database initialization:', error);
      // Clean up if initialization fails
      if (db) {
        try {
          await db.close();
        } catch (closeError) {
          console.error('Failed to close database:', closeError);
        }
        db = null;
      }
      throw error;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

// Function to get the database connection
export async function getDatabase() {
  if (!db) {
    await initDatabase();
    if (!db) {
      throw new Error('Database initialization failed');
    }
  }
  return db;
}
