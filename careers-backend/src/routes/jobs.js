const express = require('express');
const { body, query: qv, validationResult } = require('express-validator');
const { query, queryOne, transaction } = require('../../config/database');
const { auth, requireCandidate, requireEmployer } = require('../middleware/auth');
const { v4: uuid } = require('uuid');
const router = express.Router();

// ══════════════════════════════════════════════════════════════════
//  EMPLOYER: POST A JOB (progressive dropdowns supported by data)
// ══════════════════════════════════════════════════════════════════

// GET /api/jobs/form-meta?department=Sales
// Returns contextual dropdown options based on prior selections
router.get('/form-meta', auth, requireEmployer, async (req, res) => {
  const { department } = req.query;

  // Predefined domain → function → level maps
  const domainMap = {
    'Sales & GTM':    { functions: ['Inside Sales','Enterprise Sales','Channel Sales','Pre-Sales','Sales Ops','Customer Success','BD'],
                        levels:    ['Sales Trainee','BDE','Sr BDE','Team Lead','Manager','Sr Manager','AVP','VP','CRO'] },
    'Technology':     { functions: ['Frontend','Backend','Full-Stack','DevOps','Data Engineering','ML/AI','QA','Product Engineering','Security'],
                        levels:    ['Trainee','Analyst L1','Analyst L2','SDE I','SDE II','SDE III','Staff Eng','Principal','Architect','VP Eng','CTO'] },
    'Product':        { functions: ['Product Management','Product Design','UX Research','Product Analytics','Product Ops'],
                        levels:    ['APM','PM','Sr PM','Group PM','Director PM','VP Product','CPO'] },
    'Marketing':      { functions: ['Performance Marketing','Brand','Content','SEO/SEM','Social Media','Events','Growth','PR'],
                        levels:    ['Intern','Analyst','Sr Analyst','Manager','Sr Manager','Head','Director','VP','CMO'] },
    'Human Resources':{ functions: ['Talent Acquisition','HRBP','L&D','Compensation & Benefits','HR Ops','Culture'],
                        levels:    ['HR Associate','HR Executive','Sr HR Executive','Manager','Sr Manager','HRBP Lead','Head HR','CHRO'] },
    'Finance':        { functions: ['FP&A','Accounting','Tax','Audit','Treasury','Investor Relations'],
                        levels:    ['Analyst','Sr Analyst','Associate','Manager','Sr Manager','Controller','Director','VP Finance','CFO'] },
    'Operations':     { functions: ['Process Ops','Quality','Logistics','Supply Chain','Customer Ops','Workforce Mgmt'],
                        levels:    ['Executive','Sr Executive','Team Lead','Asst Manager','Manager','Sr Manager','AVP','VP Ops','COO'] },
    'Customer Success':{ functions: ['Onboarding','Renewals','Implementation','Support','CS Ops'],
                         levels:   ['Associate','Executive','Sr Executive','Manager','Sr Manager','Director CS','VP CS'] },
    'Legal & Compliance':{ functions:['Legal','Compliance','Risk','IP','Contracts'],
                           levels:  ['Analyst','Sr Analyst','Associate','Manager','Sr Counsel','Head Legal','CLO'] },
    'BPO/Contact Centre':{ functions:['Inbound','Outbound','Blended','Chat Support','Email Support','Quality Analyst','Training'],
                           levels:  ['Agent','Sr Agent','Team Lead','Asst Manager','Manager','Sr Manager','AVP','VP Ops'] },
  };

  if (department && domainMap[department]) {
    return res.json({ success: true, data: domainMap[department] });
  }
  res.json({ success: true, data: { departments: Object.keys(domainMap) } });
});

// POST /api/jobs — create a new job posting
router.post('/', auth, requireEmployer, [
  body('title').isLength({ min: 3 }),
  body('department').notEmpty(),
  body('description').isLength({ min: 50 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const employer = await queryOne('SELECT id, company_id FROM employers WHERE user_id = ?', [req.user.id]);
  if (!employer) return res.status(403).json({ success: false, message: 'Employer profile not found' });

  const {
    title, department, sub_department, job_function, level, seniority_label,
    employment_type, work_mode, location, salary_min, salary_max,
    salary_disclosed, experience_min_years, experience_max_years,
    min_career_score, required_skills, preferred_skills, education_requirement,
    description, responsibilities, benefits, openings, tat_hours,
    prescreening_questions = []
  } = req.body;

  try {
    const jobId = uuid();
    await transaction(async (conn) => {
      await conn.execute(
        `INSERT INTO job_postings
          (id, company_id, employer_id, title, department, sub_department, job_function, level,
           seniority_label, employment_type, work_mode, location, salary_min, salary_max,
           salary_disclosed, experience_min_years, experience_max_years, min_career_score,
           required_skills, preferred_skills, education_requirement, description,
           responsibilities, benefits, openings, tat_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [jobId, employer.company_id, employer.id, title, department, sub_department || null,
         job_function || null, level || null, seniority_label || null,
         employment_type || 'full_time', work_mode || 'on_site', location || null,
         salary_min || null, salary_max || null, salary_disclosed !== false,
         experience_min_years || 0, experience_max_years || null,
         min_career_score || 0,
         JSON.stringify(required_skills || []), JSON.stringify(preferred_skills || []),
         education_requirement || 'any', description,
         responsibilities || null, benefits || null, openings || 1, tat_hours || 48]
      );

      // Insert pre-screening questions
      for (let i = 0; i < prescreening_questions.length; i++) {
        const q = prescreening_questions[i];
        await conn.execute(
          `INSERT INTO prescreening_questions
            (id, job_id, question_text, question_type, is_required, max_duration_s, ideal_answer, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuid(), jobId, q.question_text, q.question_type || 'video',
           q.is_required !== false, q.max_duration_s || 90,
           q.ideal_answer || null, i + 1]
        );
      }
    });

    res.status(201).json({ success: true, job_id: jobId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create job posting' });
  }
});

// GET /api/jobs/employer — all jobs posted by this employer (no time limit, all statuses)
router.get('/employer', auth, requireEmployer, async (req, res) => {
  const employer = await queryOne('SELECT id, company_id FROM employers WHERE user_id = ?', [req.user.id]);
  const { status, department, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let sql = `SELECT jp.*, 
    (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = jp.id) as total_applications,
    (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = jp.id AND ja.status = 'shortlisted') as shortlisted,
    (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = jp.id AND ja.status = 'joined') as hired
    FROM job_postings jp WHERE jp.company_id = ?`;
  const params = [employer.company_id];

  if (status) { sql += ' AND jp.status = ?'; params.push(status); }
  if (department) { sql += ' AND jp.department = ?'; params.push(department); }
  sql += ' ORDER BY jp.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const jobs = await query(sql, params);
  res.json({ success: true, data: jobs });
});

// GET /api/jobs/:id — single job with questions
router.get('/:id', auth, async (req, res) => {
  const job = await queryOne(
    `SELECT jp.*, c.name as company_name, c.logo_url, c.industry,
     cs.total_score as company_score, cs.process_fairness, cs.employee_experience
     FROM job_postings jp
     JOIN companies c ON jp.company_id = c.id
     LEFT JOIN company_scores cs ON c.id = cs.company_id
     WHERE jp.id = ?`,
    [req.params.id]
  );
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

  const questions = await query(
    'SELECT id, question_text, question_type, is_required, max_duration_s, display_order FROM prescreening_questions WHERE job_id = ? ORDER BY display_order',
    [req.params.id]
  );

  // If employer, also include ideal_answer for their own jobs
  if (req.user.role === 'employer') {
    const employer = await queryOne('SELECT company_id FROM employers WHERE user_id = ?', [req.user.id]);
    if (employer?.company_id === job.company_id) {
      const fullQuestions = await query(
        'SELECT * FROM prescreening_questions WHERE job_id = ? ORDER BY display_order',
        [req.params.id]
      );
      return res.json({ success: true, data: { ...job, questions: fullQuestions } });
    }
  }

  res.json({ success: true, data: { ...job, questions } });
});

// PATCH /api/jobs/:id — update job (status, close, etc.)
router.patch('/:id', auth, requireEmployer, async (req, res) => {
  const employer = await queryOne('SELECT company_id FROM employers WHERE user_id = ?', [req.user.id]);
  const job = await queryOne('SELECT id, company_id FROM job_postings WHERE id = ?', [req.params.id]);
  if (!job || job.company_id !== employer.company_id) {
    return res.status(403).json({ success: false, message: 'Not your job posting' });
  }

  const allowed = ['title','status','closed_reason','openings','salary_min','salary_max',
                   'work_mode','location','description','is_featured'];
  const updates = [];
  const params = [];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(req.body[key]);
      if (key === 'status' && req.body[key] === 'closed') {
        updates.push('closed_at = NOW()');
      }
    }
  }

  if (!updates.length) return res.status(400).json({ success: false, message: 'No valid fields to update' });
  params.push(req.params.id);
  await query(`UPDATE job_postings SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
//  CANDIDATE: BROWSE & SEARCH JOBS
// ══════════════════════════════════════════════════════════════════

// GET /api/jobs — search jobs for candidate
router.get('/', auth, async (req, res) => {
  const {
    q, domain, level, work_mode, salary_min, salary_max,
    experience_max, location, page = 1, limit = 20, sort = 'match'
  } = req.query;
  const offset = (page - 1) * limit;

  // Get candidate's career score for match calculation
  let candidateId = null;
  let careerScore = 0;
  if (req.user.role === 'candidate') {
    const cand = await queryOne('SELECT id FROM candidates WHERE user_id = ?', [req.user.id]);
    if (cand) {
      candidateId = cand.id;
      const sc = await queryOne('SELECT total_score FROM career_scores WHERE candidate_id = ?', [cand.id]);
      careerScore = sc?.total_score || 300;
    }
  }

  let sql = `SELECT jp.id, jp.title, jp.department, jp.job_function, jp.level,
    jp.work_mode, jp.location, jp.salary_min, jp.salary_max, jp.salary_disclosed,
    jp.experience_min_years, jp.experience_max_years, jp.openings, jp.applications_count,
    jp.created_at, jp.tat_hours,
    c.name as company_name, c.logo_url, c.industry, c.employee_count_min, c.employee_count_max,
    cs.total_score as company_score,
    ? as candidate_career_score
    FROM job_postings jp
    JOIN companies c ON jp.company_id = c.id
    LEFT JOIN company_scores cs ON c.id = cs.company_id
    WHERE jp.status = 'active'
    AND (? = 0 OR jp.min_career_score <= ?)`;

  const params = [careerScore, careerScore, careerScore];

  if (q) {
    sql += ' AND (MATCH(jp.title, jp.description, jp.responsibilities) AGAINST(? IN BOOLEAN MODE) OR jp.title LIKE ?)';
    params.push(q + '*', `%${q}%`);
  }
  if (domain) { sql += ' AND jp.department = ?'; params.push(domain); }
  if (level) { sql += ' AND jp.level = ?'; params.push(level); }
  if (work_mode) { sql += ' AND jp.work_mode = ?'; params.push(work_mode); }
  if (salary_min) { sql += ' AND (jp.salary_max >= ? OR jp.salary_disclosed = 0)'; params.push(salary_min); }
  if (salary_max) { sql += ' AND (jp.salary_min <= ? OR jp.salary_disclosed = 0)'; params.push(salary_max); }
  if (experience_max) { sql += ' AND jp.experience_min_years <= ?'; params.push(experience_max); }
  if (location) { sql += ' AND jp.location LIKE ?'; params.push(`%${location}%`); }

  sql += sort === 'date'
    ? ' ORDER BY jp.created_at DESC'
    : ' ORDER BY cs.total_score DESC, jp.created_at DESC';

  sql += ' LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const jobs = await query(sql, params);

  // If candidate, flag which jobs they already applied for
  if (candidateId && jobs.length) {
    const jobIds = jobs.map(j => j.id);
    const applied = await query(
      `SELECT job_id, status FROM job_applications WHERE candidate_id = ? AND job_id IN (${jobIds.map(() => '?').join(',')})`,
      [candidateId, ...jobIds]
    );
    const appliedMap = Object.fromEntries(applied.map(a => [a.job_id, a.status]));
    jobs.forEach(j => { j.applied_status = appliedMap[j.id] || null; });
  }

  res.json({ success: true, data: jobs, page: parseInt(page), limit: parseInt(limit) });
});

// ══════════════════════════════════════════════════════════════════
//  CANDIDATE: APPLICATIONS
// ══════════════════════════════════════════════════════════════════

// POST /api/jobs/:id/apply — submit application
router.post('/:id/apply', auth, requireCandidate, async (req, res) => {
  const candidate = await queryOne('SELECT id FROM candidates WHERE user_id = ?', [req.user.id]);
  if (!candidate) return res.status(404).json({ success: false, message: 'Candidate profile not found' });

  const job = await queryOne('SELECT id, company_id, status, min_career_score FROM job_postings WHERE id = ?', [req.params.id]);
  if (!job || job.status !== 'active') {
    return res.status(400).json({ success: false, message: 'Job is not active' });
  }

  // Check career score gate
  const scoreRow = await queryOne('SELECT total_score FROM career_scores WHERE candidate_id = ?', [candidate.id]);
  if (scoreRow && scoreRow.total_score < job.min_career_score) {
    return res.status(400).json({
      success: false,
      message: `This role requires a Career Score of ${job.min_career_score}. Your score is ${scoreRow.total_score}.`,
      code: 'SCORE_GATE'
    });
  }

  const existing = await queryOne(
    'SELECT id FROM job_applications WHERE job_id = ? AND candidate_id = ?',
    [job.id, candidate.id]
  );
  if (existing) return res.status(409).json({ success: false, message: 'Already applied' });

  const { cover_note, answers = [] } = req.body;

  try {
    const appId = uuid();
    await transaction(async (conn) => {
      await conn.execute(
        `INSERT INTO job_applications
          (id, job_id, candidate_id, company_id, cover_note, career_score_at_apply, status)
         VALUES (?, ?, ?, ?, ?, ?, 'submitted')`,
        [appId, job.id, candidate.id, job.company_id, cover_note || null, scoreRow?.total_score || 300]
      );

      // Insert pre-screen answers
      for (const ans of answers) {
        await conn.execute(
          `INSERT INTO prescreening_answers (id, application_id, question_id, answer_type, answer_text, video_url)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [uuid(), appId, ans.question_id, ans.answer_type || 'text',
           ans.answer_text || null, ans.video_url || null]
        );
      }

      // Update application count on job
      await conn.execute(
        'UPDATE job_postings SET applications_count = applications_count + 1 WHERE id = ?',
        [job.id]
      );

      // Log status history
      await conn.execute(
        `INSERT INTO application_status_history (id, application_id, from_status, to_status, note, changed_by)
         VALUES (?, ?, NULL, 'submitted', 'Application submitted', ?)`,
        [uuid(), appId, req.user.id]
      );
    });

    // Create notification for employer
    const emp = await queryOne('SELECT user_id FROM employers WHERE company_id = ? AND is_admin = 1', [job.company_id]);
    if (emp) {
      const jobTitle = (await queryOne('SELECT title FROM job_postings WHERE id = ?', [job.id]))?.title;
      await query(
        `INSERT INTO notifications (id, user_id, type, title, body, reference_id, reference_type)
         VALUES (?, ?, 'new_application', ?, ?, ?, 'job_application')`,
        [uuid(), emp.user_id, 'New application received', `New application for ${jobTitle}`, appId]
      );
    }

    res.status(201).json({ success: true, application_id: appId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Application failed' });
  }
});

// GET /api/jobs/my/applications — candidate's full application history with progress
router.get('/my/applications', auth, requireCandidate, async (req, res) => {
  const candidate = await queryOne('SELECT id FROM candidates WHERE user_id = ?', [req.user.id]);
  if (!candidate) return res.status(404).json({ success: false });

  const apps = await query(
    `SELECT ja.id, ja.status, ja.career_score_at_apply, ja.ai_match_score, ja.applied_at, ja.status_updated_at,
     ja.rejection_reason, ja.hold_until, ja.tat_breach,
     jp.id as job_id, jp.title, jp.department, jp.level, jp.work_mode, jp.salary_min, jp.salary_max,
     c.name as company_name, c.logo_url,
     -- How many times candidate applied to this company
     (SELECT COUNT(*) FROM job_applications ja2
      JOIN job_postings jp2 ON ja2.job_id = jp2.id
      WHERE ja2.candidate_id = ? AND jp2.company_id = jp.company_id) as total_apps_to_company
     FROM job_applications ja
     JOIN job_postings jp ON ja.job_id = jp.id
     JOIN companies c ON jp.company_id = c.id
     WHERE ja.candidate_id = ?
     ORDER BY ja.applied_at DESC`,
    [candidate.id, candidate.id]
  );

  res.json({ success: true, data: apps });
});

// GET /api/jobs/:id/applications — employer views applications for a job
router.get('/:id/applications', auth, requireEmployer, async (req, res) => {
  const employer = await queryOne('SELECT company_id FROM employers WHERE user_id = ?', [req.user.id]);
  const job = await queryOne('SELECT id, company_id FROM job_postings WHERE id = ?', [req.params.id]);
  if (!job || job.company_id !== employer.company_id) {
    return res.status(403).json({ success: false, message: 'Not your job' });
  }

  const { status, sort = 'score', page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  const params = [req.params.id];

  let sql = `SELECT ja.id, ja.status, ja.career_score_at_apply, ja.ai_match_score, ja.applied_at,
     ja.employer_notes, ja.tat_breach,
     c.id as candidate_id, c.full_name, c.headline, c.location, c.total_experience_months,
     cs.total_score as current_career_score, cs.offer_reliability_pct, cs.no_show_count,
     -- How many times this candidate applied to our company
     (SELECT COUNT(*) FROM job_applications ja2
      JOIN job_postings jp2 ON ja2.job_id = jp2.id
      WHERE ja2.candidate_id = c.id AND jp2.company_id = ?) as times_applied_to_us,
     -- What other roles they applied for
     (SELECT GROUP_CONCAT(jp2.title SEPARATOR ', ') FROM job_applications ja2
      JOIN job_postings jp2 ON ja2.job_id = jp2.id
      WHERE ja2.candidate_id = c.id AND jp2.company_id = ? AND ja2.id != ja.id LIMIT 3) as other_roles_applied
     FROM job_applications ja
     JOIN candidates c ON ja.candidate_id = c.id
     LEFT JOIN career_scores cs ON c.id = cs.candidate_id
     WHERE ja.job_id = ?`;

  params.unshift(employer.company_id, employer.company_id);
  if (status) { sql += ' AND ja.status = ?'; params.push(status); }
  sql += sort === 'date' ? ' ORDER BY ja.applied_at DESC' : ' ORDER BY cs.total_score DESC, ja.applied_at ASC';
  sql += ' LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const apps = await query(sql, params);
  res.json({ success: true, data: apps });
});

// PATCH /api/jobs/applications/:appId — employer updates application status (TAT tracked)
router.patch('/applications/:appId', auth, requireEmployer, async (req, res) => {
  const employer = await queryOne('SELECT company_id FROM employers WHERE user_id = ?', [req.user.id]);
  const app = await queryOne(
    `SELECT ja.*, jp.company_id FROM job_applications ja JOIN job_postings jp ON ja.job_id = jp.id WHERE ja.id = ?`,
    [req.params.appId]
  );
  if (!app || app.company_id !== employer.company_id) {
    return res.status(403).json({ success: false, message: 'Not your application' });
  }

  const { status, rejection_reason, employer_notes, hold_until } = req.body;
  const validStatuses = ['under_review','shortlisted','relevancy_test','interview_scheduled',
    'interview_done','on_hold','offer_sent','offer_accepted','offer_declined','joined','rejected','withdrawn'];

  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  const updates = [];
  const params = [];

  if (status) {
    updates.push('status = ?', 'status_updated_at = NOW()', 'reviewed_at = COALESCE(reviewed_at, NOW())');
    params.push(status);
  }
  if (rejection_reason) { updates.push('rejection_reason = ?'); params.push(rejection_reason); }
  if (employer_notes) { updates.push('employer_notes = ?'); params.push(employer_notes); }
  if (hold_until) { updates.push('hold_until = ?'); params.push(hold_until); }

  params.push(req.params.appId);
  await query(`UPDATE job_applications SET ${updates.join(', ')} WHERE id = ?`, params);

  // Log status history
  await query(
    `INSERT INTO application_status_history (id, application_id, from_status, to_status, note, changed_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), req.params.appId, app.status, status || app.status, rejection_reason || null, req.user.id]
  );

  // Notify candidate
  const statusMessages = {
    shortlisted: 'You\'ve been shortlisted!',
    rejected: 'Application update from employer',
    offer_sent: 'You have a job offer!',
    on_hold: 'Your application is on hold',
    interview_scheduled: 'Interview scheduled',
  };
  if (statusMessages[status]) {
    await query(
      `INSERT INTO notifications (id, user_id, type, title, body, reference_id, reference_type)
       VALUES (?, (SELECT user_id FROM candidates WHERE id = ?), 'application_update', ?, ?, ?, 'job_application')`,
      [uuid(), app.candidate_id, 'Application update', statusMessages[status], req.params.appId]
    );
  }

  // Score impact: update offer reliability / no-show tracking
  if (status === 'offer_declined' || status === 'withdrawn') {
    const { addScoreEvent } = require('../services/careerScore');
    await addScoreEvent(app.candidate_id, 'offer_declined', 'credibility', -5, req.params.appId, 'Offer declined or withdrawn');
  }
  if (status === 'joined') {
    const { addScoreEvent } = require('../services/careerScore');
    await addScoreEvent(app.candidate_id, 'offer_accepted_and_joined', 'credibility', +10, req.params.appId, 'Successfully joined');
  }

  res.json({ success: true });
});

// GET /api/jobs/applications/:appId/history — full status timeline
router.get('/applications/:appId/history', auth, async (req, res) => {
  const app = await queryOne('SELECT id, candidate_id, company_id FROM job_applications ja JOIN job_postings jp ON ja.job_id = jp.id WHERE ja.id = ?', [req.params.appId]);
  if (!app) return res.status(404).json({ success: false });

  // Verify access
  if (req.user.role === 'candidate') {
    const cand = await queryOne('SELECT id FROM candidates WHERE user_id = ?', [req.user.id]);
    if (cand?.id !== app.candidate_id) return res.status(403).json({ success: false });
  }

  const history = await query(
    'SELECT * FROM application_status_history WHERE application_id = ? ORDER BY created_at ASC',
    [req.params.appId]
  );
  res.json({ success: true, data: history });
});

// ── TAT BREACH CHECKER (run via cron every hour) ──────────────────
async function checkTATBreaches() {
  const breached = await query(
    `SELECT ja.id, ja.job_id, ja.company_id, jp.tat_hours
     FROM job_applications ja
     JOIN job_postings jp ON ja.job_id = jp.id
     WHERE ja.status = 'submitted'
     AND ja.tat_breach = 0
     AND TIMESTAMPDIFF(HOUR, ja.applied_at, NOW()) > jp.tat_hours`
  );

  for (const app of breached) {
    await query('UPDATE job_applications SET tat_breach = 1 WHERE id = ?', [app.id]);
    // This affects company's response_rate score
    await query(
      `UPDATE company_scores
       SET response_rate_pct = GREATEST(0, response_rate_pct - 1)
       WHERE company_id = ?`,
      [app.company_id]
    );
  }
  console.log(`TAT check: ${breached.length} breaches flagged`);
}

module.exports = { router, checkTATBreaches };
