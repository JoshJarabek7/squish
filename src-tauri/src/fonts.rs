use font_kit::source::SystemSource;
use std::sync::Mutex;
use tauri::State;

// Store fonts in app state
pub struct FontState(pub(crate) Mutex<Vec<String>>);

#[tauri::command]
pub fn get_system_fonts(state: State<FontState>) -> Result<Vec<String>, String> {
    println!("Retrieving system fonts from state...");
    match state.0.lock() {
        Ok(fonts) => {
            let fonts = fonts.clone();
            println!("Successfully retrieved {} fonts", fonts.len());
            if fonts.is_empty() {
                println!("Warning: Font list is empty, reinitializing...");
                return Ok(initialize_fonts());
            }
            Ok(fonts)
        },
        Err(e) => {
            let error_msg = format!("Failed to access font cache: {}", e);
            println!("{}", error_msg);
            Err(error_msg)
        }
    }
}

pub fn initialize_fonts() -> Vec<String> {
    println!("Loading system fonts during setup...");
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