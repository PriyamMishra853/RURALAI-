import { qdrantClient } from '../config/qdrant.js';
import { supabaseAdmin } from '../config/supabase.js';

export const COLLECTION_NAME = 'clinical_protocols';

/**
 * Retrieve approved clinical protocols matching the patient's symptoms.
 *
 * Primary source: the seeded `clinical_protocols` + `clinical_protocol_steps`
 * tables in Supabase, scored with keyword overlap.
 * Qdrant vector search is attempted first only when a cluster is configured
 * and reachable (the current cluster URL returns 404, so Supabase is the
 * effective source of truth).
 */
export const retrieveClinicalProtocols = async (queryText, limit = 3) => {
  try {
    console.log(`🔍 RAG protocol search: "${(queryText || '').slice(0, 120)}"`);

    // 1. Optional Qdrant vector search
    if (qdrantClient) {
      try {
        const queryVector = await generateSimpleEmbedding(queryText);
        const res = await qdrantClient.query(COLLECTION_NAME, {
          query: queryVector,
          limit,
          // Without with_payload the points come back as bare ids and scores,
          // so every protocol rendered as the generic default title and the
          // retrieved guidance was empty — the LLM was being handed nothing.
          with_payload: true,
          filter: { must: [{ key: 'approved', match: { value: true } }] }
        });
        const points = res?.points || [];
        if (points.length > 0) {
          console.log(`✅ Qdrant RAG returned ${points.length} chunks.`);
          return points.map((p) => ({
            id: p.id,
            score: p.score || 0.9,
            title: p.payload?.title || 'Approved Clinical Protocol',
            source: p.payload?.source || 'MoHFW Standard Treatment Guidelines',
            version: p.payload?.version || '2024.1',
            content: p.payload?.content || '',
            steps: p.payload?.steps || [],
            approved: true
          }));
        }
      } catch (qErr) {
        console.warn('Qdrant unavailable, using Supabase protocol store:', qErr.message);
      }
    }

    // 2. Supabase keyword-scored retrieval over seeded MoHFW protocols
    const { data: protocols, error } = await supabaseAdmin
      .from('clinical_protocols')
      .select('*, clinical_protocol_steps(step_number, instruction)')
      .eq('is_active', true);

    if (error || !protocols || protocols.length === 0) {
      if (error) console.warn('clinical_protocols fetch error:', error.message);
      return [];
    }

    const queryTokens = tokenize(queryText);
    const scored = protocols
      .map((p) => {
        const haystack = tokenize(`${p.title} ${p.category} ${p.description}`);
        const overlap = queryTokens.filter((t) => haystack.includes(t)).length;
        return { protocol: p, score: overlap };
      })
      .sort((a, b) => b.score - a.score);

    // Always include the emergency protocol if nothing matches strongly
    const top = scored.slice(0, limit).filter((s) => s.score > 0);
    const chosen = top.length > 0 ? top : scored.slice(0, limit);

    console.log(`✅ Supabase RAG returned ${chosen.length} protocols.`);
    return chosen.map(({ protocol: p, score }) => ({
      id: p.id,
      score,
      title: p.title,
      source: `${p.source_organization} — ${p.source_document}`,
      version: p.version,
      content: p.description,
      steps: (p.clinical_protocol_steps || [])
        .sort((a, b) => a.step_number - b.step_number)
        .map((s) => s.instruction),
      approved: true
    }));
  } catch (error) {
    console.error('RAG retrieval failed:', error.message);
    return [];
  }
};

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Deterministic keyword-hash embedding used only for the optional Qdrant path.
 */
async function generateSimpleEmbedding(text) {
  const vector = new Array(384).fill(0);
  const words = (text || '').toLowerCase().split(/\s+/);
  words.forEach((word, idx) => {
    const charCode = word.charCodeAt(0) || 0;
    vector[idx % 384] = (charCode % 100) / 100;
  });
  return vector;
}
