import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { renderReport, REPORT_TYPES } from '../services/reportPdfService.js';
import { buildTierWorkflow } from '../services/tierWorkflowService.js';
import { ROLES } from '../config/roles.js';

/**
 * PDF hardcopy of an assessment — spec §3.6.
 *
 * Streams rather than buffering: a referral sheet is wanted in an emergency,
 * and the first byte should leave as soon as the header is drawn.
 *
 * Access is the same rule as the rest of the clinical surface — an assistant
 * gets visits in their own district, a doctor gets visits assigned to them.
 * The PDF must never be a way around that, because a printable document is the
 * easiest kind of record to forward on.
 */
const router = Router();

router.use(authenticateUser);
router.use(denyAdminClinicalAccess);

router.get(
  '/visits/:id/:type.pdf',
  authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR),
  async (req, res) => {
    const { id, type } = req.params;

    if (!REPORT_TYPES.includes(type)) {
      return res.status(400).json({ error: `Report type must be one of: ${REPORT_TYPES.join(', ')}` });
    }

    let q = supabaseAdmin
      .from('visits')
      .select(`
        *,
        patients ( aadhaar_number, full_name, gender, date_of_birth, village_line1,
                   village_line2, address_district, pin_code, phone ),
        visit_vitals ( * ),
        ai_assessments ( * )
      `)
      .eq('id', id);

    // Same scoping as every other clinical read.
    q = req.user.role === ROLES.DOCTOR
      ? q.eq('assigned_doctor_id', req.user.id)
      : q.eq('district_id', req.user.districtId);

    const { data: visit, error } = await q.maybeSingle();
    if (error) return res.status(500).json({ error: 'Could not load the visit.' });
    if (!visit) return res.status(404).json({ error: 'No such visit available to you.' });

    const patient = visit.patients;
    const assessment = Array.isArray(visit.ai_assessments) ? visit.ai_assessments[0] : visit.ai_assessments;

    if (!assessment) {
      return res.status(409).json({ error: 'This visit has no AI assessment yet — run the assessment first.' });
    }

    // Rebuilt rather than stored: precautions, medication availability and the
    // nearest hospital can all change between the assessment and the reprint,
    // and a stale referral distance is worse than a slower render.
    const workflow = await buildTierWorkflow({
      assessment,
      patient,
      visit,
      districtName: patient?.address_district || null
    });

    // A referral sheet only makes sense for a HIGH case; printing one for a
    // low-risk visit would put an "URGENT" banner on a routine record.
    if (type === 'referral' && workflow.tier !== 'HIGH') {
      return res.status(409).json({
        error: `A referral sheet is only issued for HIGH-risk cases. This visit is ${workflow.tier}.`
      });
    }

    await logAuditEvent({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'REPORT_PDF_GENERATED',
      entityType: 'VISITS',
      entityId: id,
      metadata: { type, tier: workflow.tier },
      ip: req.ip
    });

    const filename = `${type}-${visit.visit_code || id.slice(0, 8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    const doc = renderReport(type, { patient, visit, assessment, workflow });
    doc.pipe(res);
  }
);

export default router;
