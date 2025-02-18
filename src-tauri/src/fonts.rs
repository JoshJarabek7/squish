use font_kit::source::SystemSource;
use std::sync::Mutex;
use tauri::State;

// Store fonts in app state with a loaded flag
pub struct FontState(pub(crate) Mutex<(Vec<String>, bool)>);

#[tauri::command]
pub fn get_system_fonts(state: State<FontState>) -> Result<Vec<String>, String> {
    let mut state_guard = state.0.lock().map_err(|e| format!("Failed to lock state: {}", e))?;
    let (fonts, loaded) = &mut *state_guard;
    
    if !*loaded {
        println!("Loading system fonts on first request...");
        *fonts = initialize_fonts();
        *loaded = true;
    } else {
        println!("Using cached system fonts");
    }
    
    Ok(fonts.clone())
}

pub fn initialize_empty_state() -> (Vec<String>, bool) {
    (Vec::new(), false)
}

fn initialize_fonts() -> Vec<String> {
    println!("Loading system fonts...");
    let source = SystemSource::new();
    
    let fallback_fonts = vec![
        "Arial".to_string(),
        "Times New Roman".to_string(),
        "Helvetica".to_string(),
        "Courier New".to_string(),
        "Georgia".to_string(),
        "Verdana".to_string(),
        "Inter".to_string(),
    ];

    match source.all_fonts() {
        Ok(fonts) => {
            println!("Found {} raw font handles", fonts.len());
            let mut font_names: Vec<String> = Vec::new();
            
            // Process each font handle
            for handle in fonts.iter() {
                match handle.load() {
                    Ok(font) => {
                        let name = font.family_name().to_string();
                        // Only add valid font names (non-empty and contains valid characters)
                        if !name.is_empty() && name.chars().all(|c| c.is_ascii() || c.is_alphabetic()) {
                            font_names.push(name);
                        }
                    },
                    Err(e) => {
                        println!("Skipping invalid font: {:?}", e);
                        continue;
                    }
                }
            }

            if font_names.is_empty() {
                println!("No valid system fonts found, using fallbacks");
                return fallback_fonts;
            }

            println!("Collected {} valid font names", font_names.len());
            font_names.sort();
            font_names.dedup();
            println!("After deduplication: {} unique fonts", font_names.len());
            
            // Ensure common fonts are available
            for fallback in fallback_fonts {
                if !font_names.contains(&fallback) {
                    font_names.push(fallback);
                }
            }
            
            font_names.sort();
            font_names
        },
        Err(e) => {
            println!("Error loading system fonts: {:?}", e);
            println!("Using fallback fonts");
            fallback_fonts
        }
    }
} 