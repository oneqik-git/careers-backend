/**
 * CareerScoreService
 * Calculates and updates Career Score for a candidate
 * based on all five pillars with configurable weights
 */
const { query, queryOne, transaction } = require('../../config/database');

const WEIGHTS = {
  skill_impact:  parseFloat(process.env.WEIGHT_SKILL_IMPACT)  || 0.30,
  credibility:   parseFloat(process.env.WEIGHT_CREDIBILITY)   || 0.25,
  engagement:    parseFloat(process.env.WEIGHT_ENGAGEMENT)    || 0.20,
  values:        parseFloat(process.env.WEIGHT_VALUES)        || 0.15,
  identity:      parseFloat(process.env.WEIGHT_IDENTITY)      || 0.10,
};

const MAX_PTS = {
  skill_impact: 270,
  credibility:  225,
  engagement:   180,
  values:       135,
  identity:     90,
};

const BASE_SCORE = parseInt(process.env.SCORE_BASE) || 300;

// Score band thresholds
function getBand(score) {
  if (score >= 850) return 'excellent';
  if (score >= 750) return 'very_good';
  if (score >= 650) return 'good';
  if (score >= 500) return 'fair';
  return 'needs_work';
}

// ── PILLAR A: SKILL IMPACT (30%) ────────────────────────────────────
async function calcSkillImpact(candidateId) {
  // 1. Skill assessment scores (avg of all assessments)
  const assessments = await query(
    `SELECT AVG(score) as avg_score FROM skill_assessments WHERE candidate_id = ? AND status = 'completed'`,
    [candidateId]
  );
  const skillScore = parseFloat(assessments[0]?.avg_score || 0) / 100;

  // 2. Performance records (target achievement - capped at 100% for scoring)
  const perf = await query(
    `SELECT AVG(LEAST(target_pct, 100)) / 100 as avg_target, AVG(employer_rating) / 5 as avg_rating
     FROM performance_records WHERE candidate_id = ?`,
    [candidateId]
  );
  const targetScore = parseFloat(perf[0]?.avg_target || 0);
  const ratingScore = parseFloat(perf[0]?.avg_rating || 0);

  // 3. Course completion (learning velocity)
  const courses = await query(
    `SELECT COUNT(*) as completed, SUM(score_pts_earned) as pts
     FROM course_enrollments WHERE candidate_id = ? AND status = 'completed'`,
    [candidateId]
  );
  const learningScore = Math.min(parseInt(courses[0]?.completed || 0) / 10, 1);

  // Weighted sub-factors
  const raw = (
    skillScore    * 0.35 +
    targetScore   * 0.35 +
    ratingScore   * 0.15 +
    learningScore * 0.15
  );

  return Math.round(raw * MAX_PTS.skill_impact);
}

// ── PILLAR B: CREDIBILITY & ACCOUNTABILITY (25%) ─────────────────────
async function calcCredibility(candidateId) {
  const score = await queryOne(
    'SELECT * FROM career_scores WHERE candidate_id = ?',
    [candidateId]
  );

  const offerReliability = parseFloat(score?.offer_reliability_pct || 100) / 100;
  const noShowPenalty = Math.max(0, 1 - (score?.no_show_count || 0) * 0.2);
  const ghostingPenalty = Math.max(0, 1 - (score?.ghosting_count || 0) * 0.15);

  // Verified work history
  const exp = await query(
    'SELECT COUNT(*) as total, SUM(is_employer_verified) as verified FROM work_experiences WHERE candidate_id = ?',
    [candidateId]
  );
  const historyScore = exp[0]?.total > 0
    ? parseFloat(exp[0].verified) / parseFloat(exp[0].total)
    : 0;

  const raw = (
    offerReliability * 0.30 +
    noShowPenalty    * 0.35 +
    ghostingPenalty  * 0.20 +
    historyScore     * 0.15
  );

  return Math.round(raw * MAX_PTS.credibility);
}

// ── PILLAR C: ENGAGEMENT QUALITY (20%) ───────────────────────────────
async function calcEngagement(candidateId) {
  const candidate = await queryOne(
    'SELECT * FROM candidates WHERE id = ?', [candidateId]
  );

  // Profile completeness (0-1)
  const fields = ['full_name','headline','summary','location','current_role','domains','preferred_locations'];
  const filled = fields.filter(f => candidate?.[f]).length;
  const completeness = filled / fields.length;

  // Application seriousness: ratio of relevant applications
  const apps = await queryOne(
    `SELECT COUNT(*) as total,
     SUM(CASE WHEN ai_match_score >= 60 THEN 1 ELSE 0 END) as relevant
     FROM job_applications WHERE candidate_id = ?`,
    [candidateId]
  );
  const seriousness = apps?.total > 0
    ? parseFloat(apps.relevant) / parseFloat(apps.total)
    : 0.5;

  // Response rate to shortlists (how quickly they respond)
  const responseRate = 0.85; // TODO: calculate from application_status_history

  const raw = completeness * 0.30 + seriousness * 0.25 + responseRate * 0.25 + 0.7 * 0.20;
  return Math.round(raw * MAX_PTS.engagement);
}

// ── PILLAR D: VALUES & GROWTH MINDSET (15%) ──────────────────────────
async function calcValues(candidateId) {
  // Course enrollments (proactive learning)
  const learning = await queryOne(
    `SELECT COUNT(*) as enrolled, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
     FROM course_enrollments WHERE candidate_id = ?`,
    [candidateId]
  );
  const learningActivity = Math.min(parseFloat(learning?.enrolled || 0) / 5, 1);

  // Adaptability: variety of roles / industries
  const expVariety = await queryOne(
    'SELECT COUNT(DISTINCT department) as variety FROM work_experiences WHERE candidate_id = ?',
    [candidateId]
  );
  const adaptability = Math.min(parseFloat(expVariety?.variety || 0) / 3, 1);

  const raw = learningActivity * 0.40 + adaptability * 0.30 + 0.6 * 0.30;
  return Math.round(raw * MAX_PTS.values);
}

// ── PILLAR E: IDENTITY INTEGRITY (10%) ───────────────────────────────
async function calcIdentity(candidateId) {
  const candidate = await queryOne(
    'SELECT digilocker_linked, aadhaar_hash FROM candidates WHERE id = ?',
    [candidateId]
  );

  const aadhaarVerified = candidate?.aadhaar_hash ? 1 : 0;
  const digilockerLinked = candidate?.digilocker_linked ? 1 : 0;

  // Check for documents
  const docs = await queryOne(
    'SELECT COUNT(*) as count FROM digilocker_documents WHERE candidate_id = ? AND is_verified = 1',
    [candidateId]
  );
  const docsScore = Math.min(parseFloat(docs?.count || 0) / 3, 1);

  const raw = aadhaarVerified * 0.40 + digilockerLinked * 0.35 + docsScore * 0.25;
  return Math.round(raw * MAX_PTS.identity);
}

// ── MAIN CALCULATION ─────────────────────────────────────────────────
async function calculateAndSave(candidateId) {
  const [skillPts, credPts, engPts, valPts, idPts] = await Promise.all([
    calcSkillImpact(candidateId),
    calcCredibility(candidateId),
    calcEngagement(candidateId),
    calcValues(candidateId),
    calcIdentity(candidateId),
  ]);

  const candidate = await queryOne('SELECT aadhaar_hash FROM candidates WHERE id = ?', [candidateId]);
  const identityCapActive = !candidate?.aadhaar_hash;

  let total = BASE_SCORE + skillPts + credPts + engPts + valPts + idPts;

  // Cap at 500 if identity not verified
  if (identityCapActive) total = Math.min(total, 500);
  total = Math.max(BASE_SCORE, Math.min(900, total));

  const band = getBand(total);

  // Get previous score for event logging
  const prev = await queryOne('SELECT total_score FROM career_scores WHERE candidate_id = ?', [candidateId]);
  const prevScore = prev?.total_score || BASE_SCORE;

  await query(
    `INSERT INTO career_scores
      (candidate_id, total_score, skill_impact_pts, credibility_pts, engagement_pts, values_pts,
       identity_pts, band, identity_verified, identity_cap_active, last_calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       total_score=VALUES(total_score), skill_impact_pts=VALUES(skill_impact_pts),
       credibility_pts=VALUES(credibility_pts), engagement_pts=VALUES(engagement_pts),
       values_pts=VALUES(values_pts), identity_pts=VALUES(identity_pts),
       band=VALUES(band), identity_verified=VALUES(identity_verified),
       identity_cap_active=VALUES(identity_cap_active), last_calculated_at=NOW()`,
    [candidateId, total, skillPts, credPts, engPts, valPts, idPts, band,
     !identityCapActive, identityCapActive]
  );

  // Log score event if changed
  if (prevScore !== total) {
    await query(
      `INSERT INTO score_events (candidate_id, event_type, pillar, delta, score_before, score_after, note)
       VALUES (?, 'recalculation', 'all', ?, ?, ?, 'Periodic recalculation')`,
      [candidateId, total - prevScore, prevScore, total]
    );
  }

  return { total, band, skillPts, credPts, engPts, valPts, idPts, identityCapActive };
}

// Add a score event for a specific action
async function addScoreEvent(candidateId, eventType, pillar, delta, referenceId = null, note = null) {
  const current = await queryOne('SELECT total_score FROM career_scores WHERE candidate_id = ?', [candidateId]);
  const before = current?.total_score || BASE_SCORE;
  await query(
    `INSERT INTO score_events (candidate_id, event_type, pillar, delta, score_before, score_after, reference_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [candidateId, eventType, pillar, delta, before, before + delta, referenceId, note]
  );
  return calculateAndSave(candidateId);
}

module.exports = { calculateAndSave, addScoreEvent, getBand };
