use crate::types::{CompressedObservation, ObservationCell, ObservationSpan};

pub fn compress_observation(cells: &[ObservationCell]) -> CompressedObservation {
    if cells.is_empty() {
        return CompressedObservation::default();
    }

    let mut sorted = cells.to_vec();
    sorted.sort_by_key(|c| (c.y, c.x, c.signature.clone()));

    let mut spans: Vec<ObservationSpan> = Vec::new();

    for cell in sorted {
        if let Some(last) = spans.last_mut() {
            if last.y == cell.y && last.signature == cell.signature && cell.x == last.x2 + 1 {
                last.x2 = cell.x;
                continue;
            }
        }

        spans.push(ObservationSpan {
            x1: cell.x,
            x2: cell.x,
            y: cell.y,
            signature: cell.signature,
        });
    }

    CompressedObservation { spans }
}

pub fn expand_observation(observation: &CompressedObservation) -> Vec<ObservationCell> {
    let mut cells = Vec::new();

    for span in &observation.spans {
        for x in span.x1..=span.x2 {
            cells.push(ObservationCell {
                x,
                y: span.y,
                signature: span.signature.clone(),
            });
        }
    }

    cells.sort_by_key(|c| (c.y, c.x, c.signature.clone()));
    cells
}
