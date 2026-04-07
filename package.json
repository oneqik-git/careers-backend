const express = require('express');
const { query, queryOne } = require('../../config/database');
const { auth, requireEmployer } = require('../middleware/auth');
const { v4: uuid } = require('uuid');
const router = express.Router();

// GET /api/companies/:slug — public company intel page
router.get('/:slug', auth, async (req, res) => {
  const company = await queryOne('SELECT * FROM companies WHERE slug = ?', [req.params.slug]);
  if (!company) return res.status(404).json({ success: false, message: 'Company not found' });

  const [score, intel_history, career_ladders, appraisal, team_data, attrition] = await Promise.all([
    queryOne('SELECT * FROM company_scores WHERE company_id = ?', [company.id]),
    query('SELECT * FROM company_intel_history WHERE company_id = ? ORDER BY created_at DESC', [company.id]),
    query('SELECT * FROM career_ladders WHERE company_id = ?', [company.id]),
    query('SELECT * FROM appraisal_data WHERE company_id = ? ORDER BY period_year DESC', [company.id]),

    // Team size (from HRM employee_records if available, otherwise from company.employee_count_*)
    queryOne(`SELECT 
      COUNT(*) as total_employees,
      SUM(CASE WHEN department = 'Sales & GTM' THEN 1 ELSE 0 END) as sales,
      SUM(CASE WHEN department = 'Technology' THEN 1 ELSE 0 END) as tech,
      SUM(CASE WHEN department = 'Product' THEN 1 ELSE 0 END) as product,
      SUM(CASE WHEN department = 'Operations' THEN 1 ELSE 0 END) as ops,
      SUM(CASE WHEN department = 'Human Resources' THEN 1 ELSE 0 END) as hr,
      SUM(CASE WHEN department = 'Finance' THEN 1 ELSE 0 END) as finance
      FROM work_experiences WHERE company_id = ? AND is_current = 1`,
      [company.id]),

    // Attrition from exit data
    queryOne(`SELECT COUNT(*) as exits FROM work_experiences WHERE company_id = ? AND is_current = 0 AND YEAR(end_date) = YEAR(NOW())`, [company.id]),
  ]);

  // Employee-only sections (check if requester is current employee)
  let employeeOnly = null;
  if (req.user.role === 'candidate') {
    const isEmployee = await queryOne(
      'SELECT id FROM work_experiences WHERE candidate_id = (SELECT id FROM candidates WHERE user_id = ?) AND company_id = ? AND is_current = 1',
      [req.user.id, company.id]
    );
    if (isEmployee) {
      // Fetch leave policy, reimbursements, travel policy
      const empData = await queryOne('SELECT * FROM companies WHERE id = ?', [company.id]);
      // In production these would be separate tables; using company JSON fields for now
      employeeOnly = {
        leave_policy: empData.leave_policy || null,
        reimbursements: empData.reimbursements || null,
        travel_policy: empData.travel_policy || null,
      };
    }
  }

  // Anonymous reviews for everyone
  const reviews = await query(
    `SELECT cr.overall_rating, cr.manager_behaviour, cr.work_life_respect,
     cr.growth_investment, cr.psych_safety, cr.process_fairness,
     cr.review_text, cr.pros, cr.cons, cr.would_recommend, cr.created_at
     FROM company_reviews cr
     WHERE cr.company_id = ? AND cr.status = 'approved'
     ORDER BY cr.created_at DESC LIMIT 20`,
    [company.id]
  );

  res.json({
    success: true,
    data: {
      ...company,
      score,
      intel_history,
      career_ladders,
      appraisal,
      team_data,
      attrition,
      reviews,
      employee_only: employeeOnly,
    }
  });
});

// PATCH /api/companies/me — employer updates their company profile (with history logging)
router.patch('/me', auth, requireEmployer, async (req, res) => {
  const employer = await queryOne('SELECT company_id FROM employers WHERE user_id = ? AND is_admin = 1', [req.user.id]);
  if (!employer) return res.status(403).json({ success: false, message: 'Only company admins can edit the profile' });

  const allowed = ['name','description','website_url','linkedin_url','founded_year',
    'employee_count_min','employee_count_max','funding_stage','funding_amount_usd',
    'headquarters','global_offices','ceo_name','is_profitable'];

  const updates = [], params = [], historyEntries = [];

  // Fetch current values for history
  const current = await queryOne('SELECT * FROM companies WHERE id = ?', [employer.company_id]);

  for (const key of allowed) {
    if (req.body[key] !== undefined && req.body[key] !== current[key]) {
      updates.push(`${key} = ?`);
      params.push(Array.isArray(req.body[key]) ? JSON.stringify(req.body[key]) : req.body[key]);
      historyEntries.push({
        field: key,
        old: current[key],
        new: req.body[key],
      });
    }
  }

  if (!updates.length) return res.status(400).json({ success: false, message: 'No changes detected' });

  params.push(employer.company_id);
  await query(`UPDATE companies SET ${updates.join(', ')}, data_source = 'self_reported' WHERE id = ?`, params);

  // Log every field change
  for (const entry of historyEntries) {
    await query(
      `INSERT INTO company_intel_history (id, company_id, field_name, old_value, new_value, change_type, changed_by)
       VALUES (?, ?, ?, ?, ?, 'company_updated', ?)`,
      [uuid(), employer.company_id, entry.field,
       String(entry.old || ''), String(entry.new || ''), req.user.id]
    );
  }

  res.json({ success: true });
});

// POST /api/companies/me/career-ladder — employer adds career ladder for a domain
router.post('/me/career-ladder', auth, requireEmployer, async (req, res) => {
  const employer = await queryOne('SELECT company_id FROM employers WHERE user_id = ?', [req.user.id]);
  const { domain, steps } = req.body;
  if (!domain || !Array.isArray(steps)) return res.status(400).json({ success: false });

  await query(
    `INSERT INTO career_ladders (id, company_id, domain, steps, source)
     VALUES (?, ?, ?, ?, 'company_reported')
     ON DUPLICATE KEY UPDATE steps = VALUES(steps), source = 'company_reported', updated_at = NOW()`,
    [uuid(), employer.company_id, domain, JSON.stringify(steps)]
  );
  res.json({ success: true });
});

// POST /api/companies/me/appraisal — employer enters appraisal data
router.post('/me/appraisal', auth, requireEmployer, async (req, res) => {
  const employer = await queryOne('SELECT company_id FROM employers WHERE user_id = ?', [req.user.id]);
  const { department, cycle_frequency, avg_increment_pct, avg_rating, period_year } = req.body;

  await query(
    `INSERT INTO appraisal_data (id, company_id, department, cycle_frequency, avg_increment_pct, avg_rating, period_year, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'company_reported')`,
    [uuid(), employer.company_id, department || null, cycle_frequency, avg_increment_pct, avg_rating, period_year || new Date().getFullYear()]
  );
  res.json({ success: true });
});

// POST /api/companies/:companyId/review — candidate submits anonymous review
router.post('/:companyId/review', auth, async (req, res) => {
  if (req.user.role !== 'candidate') return res.status(403).json({ success: false });
  const candidate = await queryOne('SELECT id FROM candidates WHERE user_id = ?', [req.user.id]);

  // Verify they actually worked there
  const worked = await queryOne(
    'SELECT id FROM work_experiences WHERE candidate_id = ? AND company_id = ?',
    [candidate.id, req.params.companyId]
  );

  const { manager_behaviour, work_life_respect, growth_investment, psych_safety,
          process_fairness, overall_rating, review_text, pros, cons, would_recommend } = req.body;

  await query(
    `INSERT INTO company_reviews
      (id, company_id, candidate_id, employment_verified, manager_behaviour, work_life_respect,
       growth_investment, psych_safety, process_fairness, overall_rating, review_text, pros, cons, would_recommend)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       manager_behaviour=VALUES(manager_behaviour), work_life_respect=VALUES(work_life_respect),
       growth_investment=VALUES(growth_investment), psych_safety=VALUES(psych_safety),
       process_fairness=VALUES(process_fairness), overall_rating=VALUES(overall_rating),
       review_text=VALUES(review_text), pros=VALUES(pros), cons=VALUES(cons),
       would_recommend=VALUES(would_recommend), status='pending_moderation'`,
    [uuid(), req.params.companyId, candidate.id, !!worked,
     manager_behaviour, work_life_respect, growth_investment, psych_safety,
     process_fairness, overall_rating, review_text || null, pros || null, cons || null, would_recommend]
  );

  res.status(201).json({ success: true, message: 'Review submitted for moderation' });
});

module.exports = router;
