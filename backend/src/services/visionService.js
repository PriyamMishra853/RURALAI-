import { geminiGenerateJson } from '../config/gemini.js';
import { GEMINI_VISION_MODEL } from '../config/models.js';

/**
 * Computer Vision Assessment for Wounds and Clinical Photos.
 *
 * Engine: Gemini 2.5 Flash multimodal (the configured Groq key exposes no
 * vision models).
 *
 * SAFETY: output is observational only — never diagnostic. If the engine is
 * unavailable, the photo is stored and flagged for direct doctor review;
 * no visual findings are invented.
 */

const VISION_SYSTEM_PROMPT = `You are an AI medical computer-vision assistant for rural health clinics in India.
Perform a detailed OBSERVATIONAL assessment of the uploaded wound/injury/skin photograph.

STRICT SAFETY RULES:
- Use cautious, observational language only. Never state a definitive diagnosis (no "cellulitis", "abscess", "infection" as conclusions — describing visible redness or discharge is fine).
- Describe only what is actually visible in the image. Never invent features.
- If the image is not a wound/clinical photo or is unreadable, say so in cautious_summary and set analysis_possible to false.

Return strictly a JSON object:
{
  "analysis_possible": true,
  "image_type": "Wound / Skin Observation",
  "computer_vision_analysis": {
    "tissue_margin": "Observation of the wound edge and surrounding skin colour",
    "surface_features": "Observation of swelling, lesion type, abrasion, tissue surface",
    "exudate_observation": "Observation of bleeding, discharge, or moisture",
    "size_estimate": "Approximate visible size relative to anatomy, or Unknown"
  },
  "observable_features": ["Visible feature 1", "Visible feature 2"],
  "cautious_summary": "Cautious observational summary for the reviewing doctor",
  "severity_impression": "LOW" | "MEDIUM" | "HIGH",
  "warnings": ["Safety warning for the clinic assistant, e.g. escalation triggers"]
}

severity_impression guidance (observational, not diagnostic):
- HIGH: active heavy bleeding, dark/black tissue, deep exposed tissue, rapidly spreading redness
- MEDIUM: pus-like discharge, notable swelling with spreading redness, large affected area
- LOW: superficial abrasion, small cut, mild localized redness`;

export const analyzeInjuryImage = async (imageBuffer, mimeType = 'image/jpeg') => {
  if (!imageBuffer) {
    return analysisUnavailable(null, 'No image data was received.');
  }

  const base64Data = imageBuffer.toString('base64');
  const imageUrl = `data:${mimeType};base64,${base64Data}`;

  console.log('🖼️ Running Gemini computer-vision wound analysis...');
  const parsed = await geminiGenerateJson(
    VISION_SYSTEM_PROMPT,
    'Analyze this clinical wound / injury photograph and return the observational JSON.',
    { base64: base64Data, mimeType }
  );

  if (parsed && parsed.cautious_summary) {
    console.log('✅ Gemini vision analysis complete.');
    return {
      analysis_possible: parsed.analysis_possible !== false,
      image_type: parsed.image_type || 'Wound / Skin Observation',
      image_url: imageUrl,
      computer_vision_analysis: parsed.computer_vision_analysis || {},
      observable_features: Array.isArray(parsed.observable_features) ? parsed.observable_features : [],
      cautious_summary: parsed.cautious_summary,
      severity_impression: ['LOW', 'MEDIUM', 'HIGH'].includes(parsed.severity_impression) ? parsed.severity_impression : 'MEDIUM',
      warnings: [
        ...(Array.isArray(parsed.warnings) ? parsed.warnings : []),
        'This computer-vision observation is non-diagnostic. Final clinical judgement rests with the reviewing doctor.'
      ],
      engine: GEMINI_VISION_MODEL
    };
  }

  return analysisUnavailable(imageUrl, 'Automated image analysis was unavailable for this photo.');
};

function analysisUnavailable(imageUrl, reason) {
  console.warn(`⚠️ Vision analysis unavailable: ${reason}`);
  return {
    analysis_possible: false,
    image_type: 'Clinical Photograph',
    image_url: imageUrl,
    computer_vision_analysis: {},
    observable_features: [],
    cautious_summary: `${reason} The photograph has been saved and flagged for direct doctor review — no automated visual findings were generated.`,
    severity_impression: 'MEDIUM',
    warnings: [
      'Automated analysis unavailable — the doctor must review this photograph directly.',
      'If pain rapidly worsens, skin darkens, or active bleeding occurs, escalate immediately.'
    ],
    engine: 'none'
  };
}
