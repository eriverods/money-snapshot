// ─── TRANSACTION ENVELOPE + CATEGORY ASSIGNMENT (pure helpers) ────────────────
// Shared by the Add / Edit / inbox flows so the envelope + category controls
// behave identically everywhere. Envelope-via-category is the single source of
// truth: categories map many→one to an envelope (categories.envelope_id), so the
// two controls can NEVER end up in conflicting states.

export function liveCategories(categories) {
  return (categories || []).filter(c => !c.archived)
}

// Categories that belong to a given envelope — drives the filtered category picker.
export function categoriesForEnvelope(categories, envelopeId) {
  if (!envelopeId) return []
  return liveCategories(categories).filter(c => String(c.envelope_id) === String(envelopeId))
}

// The envelope a category name maps to (or '' when unmapped).
export function envelopeForCategory(categories, name) {
  if (!name) return ''
  const c = liveCategories(categories).find(c => c.name === name)
  return c && c.envelope_id ? String(c.envelope_id) : ''
}

// Resolve the next { envelopeId, category } after the user picks an ENVELOPE.
//  • Clears a category that belongs to a *different* envelope (never conflicting).
//  • Auto-selects the envelope's only category when category is still empty.
export function applyEnvelopePick(state, envelopeId, categories) {
  const id = envelopeId ? String(envelopeId) : ''
  let category = state.category || ''
  if (category) {
    const owner = envelopeForCategory(categories, category)
    if (owner && owner !== id) category = ''
  }
  if (id && !category) {
    const cats = categoriesForEnvelope(categories, id)
    if (cats.length === 1) category = cats[0].name
  }
  return { envelopeId: id, category }
}

// Resolve the next { envelopeId, category } after the user picks a CATEGORY.
// A category that maps to an envelope auto-sets that envelope (single source of
// truth), so picking a category can never leave the envelope in conflict.
export function applyCategoryPick(state, name, categories) {
  const category = name || ''
  let envelopeId = state.envelopeId || ''
  const owner = envelopeForCategory(categories, category)
  if (owner) envelopeId = owner
  return { envelopeId, category }
}
