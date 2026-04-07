/**
 * CAREERS BY ONEQIK — Full Database Schema
 * Run: node scripts/migrate.js
 *
 * Tables:
 *   Core:        users, candidates, employers, companies
 *   Jobs:        job_postings, job_applications, prescreening_questions, prescreening_answers
 *   Score:       career_scores, score_events, company_scores, company_score_events
 *   Identity:    digilocker_documents, verifications
 *   Work:        work_experiences, achievements, certifications
 *   Skills:      skill_assessments, courses, course_enrollments, course_modules, module_completions
 *   Community:   posts, post_votes, comments, polls, poll_votes
 *   HRM:         hrm_connections, employee_records, performance_records, leave_records
 *   Company:     company_intel, career_ladders, appraisal_data, company_history
 *   Messaging:   conversations, messages
 *   Notifications: notifications
 */

require('dotenv').config({ path: '../.env' });
const { pool } = require('../config/database');

const migrations = [

  // ── USERS (base auth for both roles) ────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    email         VARCHAR(255) UNIQUE NOT NULL,
    phone         VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('candidate','employer','admin') NOT NULL,
    is_verified   BOOLEAN DEFAULT FALSE,
    is_active     BOOLEAN DEFAULT TRUE,
    last_login    TIMESTAMP NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role (role)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── CANDIDATES ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS candidates (
    id                 VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id            VARCHAR(36) NOT NULL UNIQUE,
    full_name          VARCHAR(255) NOT NULL,
    headline           VARCHAR(500),
    summary            TEXT,
    location           VARCHAR(255),
    city               VARCHAR(100),
    state              VARCHAR(100),
    date_of_birth      DATE,
    gender             ENUM('male','female','non_binary','prefer_not_to_say'),
    aadhaar_hash       VARCHAR(64) UNIQUE,  -- SHA-256 of Aadhaar, never raw
    digilocker_linked  BOOLEAN DEFAULT FALSE,
    profile_photo_url  VARCHAR(500),
    current_role       VARCHAR(255),
    current_company    VARCHAR(255),
    total_experience_months INT DEFAULT 0,
    domains            JSON,               -- ['Sales','Tech','Marketing']
    preferred_locations JSON,
    expected_salary_min INT,
    expected_salary_max INT,
    notice_period_days INT DEFAULT 0,
    open_to_work       BOOLEAN DEFAULT TRUE,
    career_stage       ENUM('entry','mid','senior','lead','executive') DEFAULT 'entry',
    generation         ENUM('gen_z','millennial','gen_x','boomer'),
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_location (city, state),
    INDEX idx_open_to_work (open_to_work),
    INDEX idx_domains ((CAST(domains AS CHAR(1000))))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── COMPANIES ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS companies (
    id                 VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name               VARCHAR(255) NOT NULL,
    slug               VARCHAR(255) UNIQUE NOT NULL,
    industry           VARCHAR(100),
    sub_industry       VARCHAR(100),
    description        TEXT,
    logo_url           VARCHAR(500),
    website_url        VARCHAR(500),
    linkedin_url       VARCHAR(500),
    founded_year       INT,
    employee_count_min INT,
    employee_count_max INT,
    funding_stage      ENUM('bootstrapped','pre_seed','seed','series_a','series_b','series_c','series_d_plus','ipo','profitable','na'),
    funding_amount_usd BIGINT,
    is_profitable      BOOLEAN,
    headquarters       VARCHAR(255),
    global_offices     JSON,              -- ['IN','US','SG']
    ceo_name           VARCHAR(255),
    gstin              VARCHAR(20),
    cin                VARCHAR(25),
    verified_company   BOOLEAN DEFAULT FALSE,
    data_source        ENUM('self_reported','auto_scraped','verified') DEFAULT 'self_reported',
    last_auto_update   TIMESTAMP NULL,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_slug (slug),
    INDEX idx_industry (industry),
    FULLTEXT idx_search (name, industry, description)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── COMPANY INTEL HISTORY (audit log of all changes) ─────────────
  `CREATE TABLE IF NOT EXISTS company_intel_history (
    id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    company_id   VARCHAR(36) NOT NULL,
    field_name   VARCHAR(100) NOT NULL,
    old_value    TEXT,
    new_value    TEXT,
    change_type  ENUM('auto_derived','company_updated','admin_corrected'),
    changed_by   VARCHAR(36),            -- user_id or NULL for auto
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    INDEX idx_company (company_id),
    INDEX idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── EMPLOYERS ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS employers (
    id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id      VARCHAR(36) NOT NULL UNIQUE,
    company_id   VARCHAR(36) NOT NULL,
    full_name    VARCHAR(255) NOT NULL,
    designation  VARCHAR(255),
    department   VARCHAR(100),
    is_admin     BOOLEAN DEFAULT FALSE,  -- company admin vs. recruiter
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    INDEX idx_company (company_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── JOB POSTINGS ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS job_postings (
    id                    VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    company_id            VARCHAR(36) NOT NULL,
    employer_id           VARCHAR(36) NOT NULL,
    title                 VARCHAR(255) NOT NULL,
    department            VARCHAR(100) NOT NULL,
    sub_department        VARCHAR(100),
    job_function          VARCHAR(100),       -- role category (Sales, Engineering...)
    level                 ENUM('entry','junior','mid','senior','lead','manager','director','vp','c_suite'),
    seniority_label       VARCHAR(100),        -- 'Associate', 'L4', 'SSE'...
    employment_type       ENUM('full_time','part_time','contract','internship','freelance'),
    work_mode             ENUM('on_site','hybrid','remote','flexible'),
    location              VARCHAR(255),
    salary_min            INT,
    salary_max            INT,
    salary_currency       VARCHAR(10) DEFAULT 'INR',
    salary_period         ENUM('monthly','yearly') DEFAULT 'yearly',
    salary_disclosed      BOOLEAN DEFAULT TRUE,
    experience_min_years  DECIMAL(4,1) DEFAULT 0,
    experience_max_years  DECIMAL(4,1),
    min_career_score      INT DEFAULT 0,      -- career score gate
    required_skills       JSON,               -- ['Python','SQL']
    preferred_skills      JSON,
    education_requirement ENUM('any','10th','12th','diploma','ug','pg','phd') DEFAULT 'any',
    description           TEXT NOT NULL,
    responsibilities      TEXT,
    benefits              TEXT,
    openings              INT DEFAULT 1,
    applications_count    INT DEFAULT 0,
    shortlisted_count     INT DEFAULT 0,
    hired_count           INT DEFAULT 0,
    status                ENUM('draft','active','paused','closed','expired') DEFAULT 'active',
    closed_reason         VARCHAR(255),
    closed_at             TIMESTAMP NULL,
    expires_at            TIMESTAMP NULL,
    is_featured           BOOLEAN DEFAULT FALSE,
    tat_hours             INT DEFAULT 48,     -- response TAT in hours
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (employer_id) REFERENCES employers(id),
    INDEX idx_company (company_id),
    INDEX idx_status (status),
    INDEX idx_function (job_function),
    INDEX idx_level (level),
    FULLTEXT idx_search (title, description, responsibilities)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── PRE-SCREEN QUESTIONS ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS prescreening_questions (
    id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    job_id         VARCHAR(36) NOT NULL,
    question_text  TEXT NOT NULL,
    question_type  ENUM('video','text','mcq') DEFAULT 'video',
    is_required    BOOLEAN DEFAULT TRUE,
    max_duration_s INT DEFAULT 90,           -- for video answers
    ideal_answer   TEXT,                     -- employer hint for AI scoring
    display_order  INT DEFAULT 1,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES job_postings(id) ON DELETE CASCADE,
    INDEX idx_job (job_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── JOB APPLICATIONS ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS job_applications (
    id                  VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    job_id              VARCHAR(36) NOT NULL,
    candidate_id        VARCHAR(36) NOT NULL,
    company_id          VARCHAR(36) NOT NULL,
    application_number  INT AUTO_INCREMENT,           -- sequential per company
    status              ENUM(
      'submitted',         -- candidate submitted
      'under_review',      -- employer opened
      'shortlisted',       -- employer shortlisted
      'relevancy_test',    -- test requested
      'test_submitted',    -- candidate submitted test
      'interview_scheduled',
      'interview_done',
      'on_hold',
      'offer_sent',
      'offer_accepted',
      'offer_declined',
      'joined',
      'rejected',
      'withdrawn'
    ) DEFAULT 'submitted',
    rejection_reason     TEXT,
    hold_until           TIMESTAMP NULL,
    cover_note           TEXT,
    career_score_at_apply INT,              -- snapshot of score when applied
    ai_match_score       DECIMAL(5,2),      -- 0-100 match %
    ai_summary           TEXT,             -- AI summary of pre-screen
    employer_notes       TEXT,             -- internal recruiter notes
    applied_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at          TIMESTAMP NULL,
    status_updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    tat_breach           BOOLEAN DEFAULT FALSE, -- flagged if >48h without action
    UNIQUE KEY uniq_application (job_id, candidate_id),
    FOREIGN KEY (job_id) REFERENCES job_postings(id),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    INDEX idx_job (job_id),
    INDEX idx_candidate (candidate_id),
    INDEX idx_status (status),
    INDEX idx_company (company_id),
    INDEX app_number (application_number)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── PRE-SCREEN ANSWERS ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS prescreening_answers (
    id              VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    application_id  VARCHAR(36) NOT NULL,
    question_id     VARCHAR(36) NOT NULL,
    answer_type     ENUM('video','text') NOT NULL,
    answer_text     TEXT,
    video_url       VARCHAR(500),
    ai_score        DECIMAL(5,2),         -- AI-scored 0-100
    ai_feedback     TEXT,                 -- AI notes on answer quality
    employer_viewed BOOLEAN DEFAULT FALSE,
    submitted_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES job_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES prescreening_questions(id),
    INDEX idx_application (application_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── APPLICATION STATUS HISTORY ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS application_status_history (
    id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    application_id VARCHAR(36) NOT NULL,
    from_status    VARCHAR(50),
    to_status      VARCHAR(50) NOT NULL,
    note           TEXT,
    changed_by     VARCHAR(36),          -- user_id
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES job_applications(id) ON DELETE CASCADE,
    INDEX idx_application (application_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── CAREER SCORES ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS career_scores (
    id                      VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    candidate_id            VARCHAR(36) NOT NULL UNIQUE,
    total_score             INT DEFAULT 300,
    skill_impact_pts        INT DEFAULT 0,
    credibility_pts         INT DEFAULT 0,
    engagement_pts          INT DEFAULT 0,
    values_pts              INT DEFAULT 0,
    identity_pts            INT DEFAULT 0,
    phase                   ENUM('phase_0_verified','phase_1_active') DEFAULT 'phase_0_verified',
    band                    ENUM('needs_work','fair','good','very_good','excellent') DEFAULT 'fair',
    offer_reliability_pct   DECIMAL(5,2) DEFAULT 100,
    no_show_count           INT DEFAULT 0,
    ghosting_count          INT DEFAULT 0,
    avg_employer_rating     DECIMAL(3,2) DEFAULT 0,
    identity_verified       BOOLEAN DEFAULT FALSE,
    identity_cap_active     BOOLEAN DEFAULT FALSE,  -- capped at 500 if not verified
    last_calculated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── SCORE EVENTS (audit trail for every score change) ─────────────
  `CREATE TABLE IF NOT EXISTS score_events (
    id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    candidate_id   VARCHAR(36) NOT NULL,
    event_type     VARCHAR(100) NOT NULL,  -- 'offer_accepted','course_completed'...
    pillar         VARCHAR(50),            -- which pillar this affects
    delta          INT NOT NULL,           -- +/- points
    score_before   INT,
    score_after    INT,
    reference_id   VARCHAR(36),            -- job_id, course_id etc.
    note           TEXT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    INDEX idx_candidate (candidate_id),
    INDEX idx_event_type (event_type),
    INDEX idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── COMPANY SCORES ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS company_scores (
    id                        VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    company_id                VARCHAR(36) NOT NULL UNIQUE,
    total_score               DECIMAL(3,2) DEFAULT 0,   -- 0-5 scale
    process_fairness          DECIMAL(3,2) DEFAULT 0,
    employee_experience       DECIMAL(3,2) DEFAULT 0,
    contractual_integrity     DECIMAL(3,2) DEFAULT 0,
    ethics_conduct            DECIMAL(3,2) DEFAULT 0,
    review_count              INT DEFAULT 0,
    verified_review_count     INT DEFAULT 0,
    feedback_rate_pct         DECIMAL(5,2) DEFAULT 100,
    response_rate_pct         DECIMAL(5,2) DEFAULT 100,
    offer_integrity_score     DECIMAL(3,2) DEFAULT 5,
    ff_settlement_score       DECIMAL(3,2) DEFAULT 5,
    red_flag_count            INT DEFAULT 0,
    active_flags              JSON,   -- ['conduct_alert','settlement_risk']
    last_calculated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── COMPANY REVIEWS (from candidates — anonymous) ──────────────────
  `CREATE TABLE IF NOT EXISTS company_reviews (
    id                    VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    company_id            VARCHAR(36) NOT NULL,
    candidate_id          VARCHAR(36) NOT NULL,
    employment_verified   BOOLEAN DEFAULT FALSE,  -- was this person actually employed?
    manager_behaviour     TINYINT CHECK (manager_behaviour BETWEEN 1 AND 5),
    work_life_respect     TINYINT CHECK (work_life_respect BETWEEN 1 AND 5),
    growth_investment     TINYINT CHECK (growth_investment BETWEEN 1 AND 5),
    psych_safety          TINYINT CHECK (psych_safety BETWEEN 1 AND 5),
    process_fairness      TINYINT CHECK (process_fairness BETWEEN 1 AND 5),
    overall_rating        TINYINT CHECK (overall_rating BETWEEN 1 AND 5),
    review_text           TEXT,
    pros                  TEXT,
    cons                  TEXT,
    would_recommend       BOOLEAN,
    is_anonymous          BOOLEAN DEFAULT TRUE,
    status                ENUM('pending_moderation','approved','rejected') DEFAULT 'pending_moderation',
    moderation_note       TEXT,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY one_review_per_company (company_id, candidate_id),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id),
    INDEX idx_company (company_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── DIGILOCKER DOCUMENTS ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS digilocker_documents (
    id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    candidate_id   VARCHAR(36) NOT NULL,
    doc_type       ENUM('aadhaar','pan','degree','diploma','certificate','marksheet','offer_letter','relieving_letter','other') NOT NULL,
    doc_name       VARCHAR(255) NOT NULL,
    issuer         VARCHAR(255),
    issue_year     INT,
    digilocker_uri VARCHAR(500),     -- DigiLocker issued URI
    is_verified    BOOLEAN DEFAULT FALSE,
    is_editable    BOOLEAN DEFAULT FALSE,  -- always false for DigiLocker docs
    file_url       VARCHAR(500),     -- internal storage (encrypted)
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    INDEX idx_candidate (candidate_id),
    INDEX idx_doc_type (doc_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── WORK EXPERIENCES ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS work_experiences (
    id                 VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    candidate_id       VARCHAR(36) NOT NULL,
    company_id         VARCHAR(36),           -- linked if on Careers
    company_name       VARCHAR(255) NOT NULL,  -- fallback if not on Careers
    job_title          VARCHAR(255) NOT NULL,
    department         VARCHAR(100),
    start_date         DATE NOT NULL,
    end_date           DATE,
    is_current         BOOLEAN DEFAULT FALSE,
    description        TEXT,
    is_employer_verified BOOLEAN DEFAULT FALSE,
    verified_by        VARCHAR(36),            -- employer user_id
    verified_at        TIMESTAMP NULL,
    hrm_linked         BOOLEAN DEFAULT FALSE,  -- auto-pulled from HRM
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    INDEX idx_candidate (candidate_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── ACHIEVEMENTS ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS achievements (
    id                  VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    experience_id       VARCHAR(36) NOT NULL,
    candidate_id        VARCHAR(36) NOT NULL,
    title               VARCHAR(255) NOT NULL,
    description         TEXT,
    is_employer_verified BOOLEAN DEFAULT FALSE,
    verified_by         VARCHAR(36),
    verified_at         TIMESTAMP NULL,
    is_editable         BOOLEAN DEFAULT TRUE,  -- locked once verified
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (experience_id) REFERENCES work_experiences(id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    INDEX idx_candidate (candidate_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── HRM PERFORMANCE RECORDS (employer-entered, non-editable by candidate) ─
  `CREATE TABLE IF NOT EXISTS performance_records (
    id               VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    experience_id    VARCHAR(36) NOT NULL,
    candidate_id     VARCHAR(36) NOT NULL,
    employer_id      VARCHAR(36) NOT NULL,
    period_start     DATE,
    period_end       DATE,
    target_pct       DECIMAL(6,2),       -- 112% = 112.00
    attendance_pct   DECIMAL(5,2),
    employer_rating  DECIMAL(3,2),
    notes            TEXT,
    is_verified      BOOLEAN DEFAULT TRUE,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (experience_id) REFERENCES work_experiences(id),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id),
    FOREIGN KEY (employer_id) REFERENCES employers(id),
    INDEX idx_candidate (candidate_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── COURSES ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS courses (
    id              VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    title           VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) UNIQUE NOT NULL,
    domain          VARCHAR(100) NOT NULL,       -- 'Sales','Tech','HR'...
    sub_domain      VARCHAR(100),
    level           ENUM('entry','mid','senior','lead','executive') NOT NULL,
    career_target   VARCHAR(255),                -- 'VP of Sales'
    description     TEXT,
    thumbnail_url   VARCHAR(500),
    duration_mins   INT,
    module_count    INT DEFAULT 0,
    price_inr       INT DEFAULT 0,               -- 0 = free
    is_certified    BOOLEAN DEFAULT TRUE,
    score_pts_reward INT DEFAULT 0,              -- career score points on completion
    xp_reward       INT DEFAULT 0,              -- XP points
    is_govt_scheme  BOOLEAN DEFAULT FALSE,
    provider        VARCHAR(255) DEFAULT 'Careers by OneQik',
    status          ENUM('draft','published','archived') DEFAULT 'published',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_domain (domain),
    INDEX idx_level (level),
    FULLTEXT idx_search (title, description)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── COURSE MODULES ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS course_modules (
    id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    course_id      VARCHAR(36) NOT NULL,
    title          VARCHAR(255) NOT NULL,
    description    TEXT,
    content_type   ENUM('video','reading','quiz','assignment'),
    content_url    VARCHAR(500),
    duration_mins  INT,
    display_order  INT NOT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    INDEX idx_course (course_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── COURSE ENROLLMENTS ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS course_enrollments (
    id              VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    course_id       VARCHAR(36) NOT NULL,
    candidate_id    VARCHAR(36) NOT NULL,
    status          ENUM('enrolled','in_progress','completed','dropped') DEFAULT 'enrolled',
    progress_pct    DECIMAL(5,2) DEFAULT 0,
    current_module  INT DEFAULT 1,
    score_pts_earned INT DEFAULT 0,
    xp_earned       INT DEFAULT 0,
    enrolled_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at    TIMESTAMP NULL,
    UNIQUE KEY uniq_enrollment (course_id, candidate_id),
    FOREIGN KEY (course_id) REFERENCES courses(id),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id),
    INDEX idx_candidate (candidate_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── CAREER LADDERS (per company + domain) ─────────────────────
  `CREATE TABLE IF NOT EXISTS career_ladders (
    id            VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    company_id    VARCHAR(36) NOT NULL,
    domain        VARCHAR(100) NOT NULL,
    steps         JSON NOT NULL,
    /*
      steps format:
      [
        { "level": 1, "title": "Sales Trainee", "salary_min": 250000, "salary_max": 400000,
          "exp_min_yrs": 0, "exp_max_yrs": 1, "team_size": null },
        { "level": 2, "title": "BDE", ... },
        ...
      ]
    */
    source        ENUM('company_reported','candidate_inferred','ai_generated') DEFAULT 'ai_generated',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_company_domain (company_id, domain),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── APPRAISAL DATA (company-level) ────────────────────────────
  `CREATE TABLE IF NOT EXISTS appraisal_data (
    id                  VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    company_id          VARCHAR(36) NOT NULL,
    department          VARCHAR(100),
    cycle_frequency     ENUM('monthly','quarterly','bi_annual','annual') DEFAULT 'annual',
    avg_increment_pct   DECIMAL(5,2),
    avg_rating          DECIMAL(3,2),
    source              ENUM('company_reported','candidate_reviews') DEFAULT 'candidate_reviews',
    period_year         INT,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    INDEX idx_company (company_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── COMMUNITY POSTS ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS community_posts (
    id            VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    author_id     VARCHAR(36) NOT NULL,    -- user_id
    author_role   ENUM('candidate','employer'),
    post_type     ENUM('question','poll','blog','story','tip'),
    title         VARCHAR(500),            -- for blog/question
    content       LONGTEXT NOT NULL,
    domain_tags   JSON,                    -- ['Sales','Tech']
    is_anonymous  BOOLEAN DEFAULT TRUE,
    alias         VARCHAR(50),             -- e.g. "Sales professional · 3 yrs"
    upvote_count  INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    view_count    INT DEFAULT 0,
    status        ENUM('pending','approved','rejected','flagged') DEFAULT 'pending',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id),
    INDEX idx_post_type (post_type),
    INDEX idx_status (status),
    FULLTEXT idx_search (title, content)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── NOTIFICATIONS ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS notifications (
    id           VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id      VARCHAR(36) NOT NULL,
    type         VARCHAR(100) NOT NULL,   -- 'application_update','score_change'...
    title        VARCHAR(255) NOT NULL,
    body         TEXT,
    reference_id VARCHAR(36),             -- application_id, job_id...
    reference_type VARCHAR(50),
    is_read      BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_read (is_read),
    INDEX idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ── HRM INTEGRATION CONNECTIONS ─────────────────────────────
  `CREATE TABLE IF NOT EXISTS hrm_connections (
    id             VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    company_id     VARCHAR(36) NOT NULL,
    hrm_type       ENUM('careers_native','darwinbox','greythr','keka','zoho_people','bamboohr','sap','custom_api'),
    api_endpoint   VARCHAR(500),
    api_key_hash   VARCHAR(255),          -- never store raw
    sync_status    ENUM('active','paused','error') DEFAULT 'active',
    last_sync_at   TIMESTAMP NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    INDEX idx_company (company_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

];

async function runMigrations() {
  console.log('🚀 Running migrations...\n');
  for (let i = 0; i < migrations.length; i++) {
    const sql = migrations[i];
    const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] || `migration_${i}`;
    try {
      await pool.execute(sql);
      console.log(`  ✅ ${tableName}`);
    } catch (err) {
      console.error(`  ❌ ${tableName}: ${err.message}`);
      throw err;
    }
  }
  console.log('\n✅ All migrations complete.');
  await pool.end();
}

runMigrations().catch(console.error);
