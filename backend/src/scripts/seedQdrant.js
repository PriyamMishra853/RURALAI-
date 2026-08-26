import dotenv from 'dotenv';
dotenv.config();
import { QdrantClient } from '@qdrant/js-client-rest';

if (!process.env.QDRANT_CLUSTER_ENDPOINT && !process.env.QDRANT_URL) {
  console.error('Set QDRANT_CLUSTER_ENDPOINT (or QDRANT_URL) and QDRANT_API_KEY in backend/.env');
  process.exit(1);
}

// No hardcoded fallbacks. This file previously carried a live cluster URL and
// API key as defaults, in a public repository.
const client = new QdrantClient({
  url: process.env.QDRANT_CLUSTER_ENDPOINT || process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false
});

const COLLECTION_NAME = 'clinical_protocols';

async function seedQdrant() {
  try {
    console.log('📡 Connecting to Qdrant Cloud...');

    // 1. Create collection if not exists
    try {
      await client.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 384,
          distance: 'Cosine'
        }
      });
      console.log(`📦 Created collection '${COLLECTION_NAME}'`);
    } catch (e) {
      console.log(`Note on collection creation: ${e.message}`);
    }

    // A payload index is REQUIRED before Qdrant will filter on a field.
    // Without it, `filter: { must: [{ key: 'approved', ... }] }` returns
    // 400 "Index required but not found", the whole vector-search block throws,
    // and retrieval silently falls through to the keyword store — so the
    // approved-only safety filter never actually applies. Plan §D.1 requires
    // that only protocols tagged approved are retrievable.
    try {
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'approved',
        field_schema: 'bool',
        wait: true
      });
      console.log("🔎 Created payload index on 'approved'");
    } catch (e) {
      console.log(`Note on payload index: ${e.message}`);
    }

    // 2. Sample MoHFW Clinical Protocols
    const protocols = [
      {
        id: 101,
        payload: {
          title: 'Minor Superficial Wound & Abrasion First-Aid Protocol',
          category: 'First Aid',
          source: 'Ministry of Health & Family Welfare, Govt of India',
          version: '1.0',
          approved: true,
          content: 'PROCEDURE: 1. Wash hands with soap and water. 2. Clean wound gently with sterile saline or clean water. 3. Apply povidone-iodine antiseptic. 4. Apply clean dry sterile dressing. 5. Instruct patient to keep clean and dry. WARNING SIGNS: Continuous bleeding > 10 mins, pus, fever, severe pain -> Escalate to Doctor.'
        }
      },
      {
        id: 102,
        payload: {
          title: 'Acute Febrile Illness (Fever < 3 days) Triage Protocol',
          category: 'General Medicine',
          source: 'Indian Public Health Standards (IPHS) STG',
          version: '1.0',
          approved: true,
          content: 'PROCEDURE: 1. Record body temperature, SpO2, and BP. 2. Encourage oral fluids (ORS/water). 3. Cold sponging if temp > 101F. 4. Paracetamol 500mg symptomatic relief after doctor approval. WARNING SIGNS: SpO2 < 94%, breathlessness, stiff neck, altered sensorium -> Doctor consultation mandatory.'
        }
      },
      {
        id: 103,
        payload: {
          title: 'Emergency Triage Red-Flag Escalation Protocol',
          category: 'Emergency',
          source: 'Ministry of Health & Family Welfare, Govt of India',
          version: '1.0',
          approved: true,
          content: 'CRITICAL ESCALATION: SpO2 < 90%, Severe dyspnea, chest pain, systolic BP < 90 or > 180, unconsciousness, severe hemorrhage. ACTION: Immediate Doctor notification + Dispatch District Hospital Referral. Stop protocol guidance.'
        }
      }
    ];

    const points = protocols.map(p => {
      const vector = new Array(384).fill(0);
      const text = `${p.payload.title} ${p.payload.content}`.toLowerCase();
      text.split(/\s+/).forEach((w, idx) => {
        vector[idx % 384] = (w.charCodeAt(0) % 100) / 100;
      });
      return {
        id: p.id,
        vector,
        payload: p.payload
      };
    });

    console.log(`🚀 Upserting ${points.length} approved protocols into Qdrant vector DB...`);
    await client.upsert(COLLECTION_NAME, {
      wait: true,
      points
    });

    console.log('✅ Qdrant RAG Knowledge Base successfully seeded with metadata approved = true!');
  } catch (error) {
    console.error('❌ Qdrant seed error:', error.message);
  }
}

seedQdrant();
