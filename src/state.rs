use std::sync::Mutex;

pub struct AppState {
    pub room_id: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            room_id: Mutex::new(None),
        }
    }
}
