const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query, queryOne, transaction } = require('../../config/database');
const { v4: uuid } = require('uuid');
const router = express.Router();

function generateTokens(userId, role) {
  const access = jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
  const refresh = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN });
  return { access, refresh };
}

// ── POST /api/auth/register/candidate ─────────────────────────────
router.post('/register/candidate', [
  body('email').isEmail().normalizeEmail(),
  body('phone').isMobilePhone('en-IN'),
  body('password').isLength({ min: 8 }),
  body('full_name').isLength({ min: 2 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { email, phone, password, full_name } = req.body;
  try {
    const existing = await queryOne('SELECT id FROM users WHERE email = ? OR phone = ?', [email, phone]);
    if (existing) return res.status(409).json({ success: false, message: 'Email or phone already registered' });

    await transaction(async (conn) => {
      const userId = uuid();
      const candidateId = uuid();
      const hash = await bcrypt.hash(password, 12);

      await conn.execute(
        'INSERT INTO users (id, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        [userId, email, phone, hash, 'candidate']
      );
      await conn.execute(
        'INSERT INTO candidates (id, user_id, full_name) VALUES (?, ?, ?)',
        [candidateId, userId, full_name]
      );
      // Init empty score row
      await conn.execute(
        'INSERT INTO career_scores (candidate_id, total_score) VALUES (?, 300)',
        [candidateId]
      );
    });

    const user = await queryOne('SELECT id, role FROM users WHERE email = ?', [email]);
    const { access, refresh } = generateTokens(user.id, 'candidate');
    res.status(201).json({ success: true, tokens: { access, refresh } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// ── POST /api/auth/register/employer ──────────────────────────────
router.post('/register/employer', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('full_name').isLength({ min: 2 }),
  body('company_name').isLength({ min: 2 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { email, phone, password, full_name, company_name, designation } = req.body;
  try {
    await transaction(async (conn) => {
      const userId = uuid();
      const employerId = uuid();
      const companyId = uuid();
      const hash = await bcrypt.hash(password, 12);
      const slug = company_name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();

      await conn.execute(
        'INSERT INTO users (id, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        [userId, email, phone || null, hash, 'employer']
      );
      await conn.execute(
        'INSERT INTO companies (id, name, slug) VALUES (?, ?, ?)',
        [companyId, company_name, slug]
      );
      await conn.execute(
        'INSERT INTO company_scores (company_id) VALUES (?)',
        [companyId]
      );
      await conn.execute(
        'INSERT INTO employers (id, user_id, company_id, full_name, designation, is_admin) VALUES (?, ?, ?, ?, ?, 1)',
        [employerId, userId, companyId, full_name, designation || null]
      );
    });

    const user = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
    const { access, refresh } = generateTokens(user.id, 'employer');
    res.status(201).json({ success: true, tokens: { access, refresh } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { email, password } = req.body;
  try {
    const user = await queryOne('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    await query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    const { access, refresh } = generateTokens(user.id, user.role);
    res.json({ success: true, role: user.role, tokens: { access, refresh } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(401).json({ success: false, message: 'No refresh token' });
  try {
    const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    const user = await queryOne('SELECT id, role, is_active FROM users WHERE id = ?', [decoded.userId]);
    if (!user || !user.is_active) return res.status(401).json({ success: false, message: 'Invalid user' });
    const { access, refresh } = generateTokens(user.id, user.role);
    res.json({ success: true, tokens: { access, refresh } });
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
});

// ── GET /api/auth/digilocker/initiate ─────────────────────────────
// Redirects to DigiLocker OAuth
router.get('/digilocker/initiate', async (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.DIGILOCKER_CLIENT_ID,
    redirect_uri: process.env.DIGILOCKER_REDIRECT_URI,
    scope: 'openid aadhaar_number DOB FULLNAME',
    state: req.query.candidateId || '',
  });
  res.redirect(`https://api.digitallocker.gov.in/public/oauth2/1/authorize?${params}`);
});

// ── GET /api/auth/digilocker/callback ────────────────────────────
router.get('/digilocker/callback', async (req, res) => {
  const { code, state: candidateId } = req.query;
  if (!code) return res.status(400).json({ success: false, message: 'DigiLocker auth failed' });

  try {
    // Exchange code for token
    const axios = require('axios');
    const tokenRes = await axios.post('https://api.digitallocker.gov.in/public/oauth2/1/token', {
      code,
      grant_type: 'authorization_code',
      client_id: process.env.DIGILOCKER_CLIENT_ID,
      client_secret: process.env.DIGILOCKER_CLIENT_SECRET,
      redirect_uri: process.env.DIGILOCKER_REDIRECT_URI,
    });

    const { access_token } = tokenRes.data;

    // Fetch Aadhaar details
    const userRes = await axios.get('https://api.digitallocker.gov.in/public/oauth2/1/user', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const crypto = require('crypto');
    const aadhaarHash = crypto.createHash('sha256').update(userRes.data.masked_aadhaar || '').digest('hex');

    // Check for duplicate profile
    const duplicate = await queryOne(
      'SELECT id FROM candidates WHERE aadhaar_hash = ? AND id != ?',
      [aadhaarHash, candidateId]
    );
    if (duplicate) {
      return res.status(409).json({ success: false, message: 'A profile with this Aadhaar already exists', code: 'DUPLICATE_PROFILE' });
    }

    await query(
      'UPDATE candidates SET aadhaar_hash = ?, digilocker_linked = 1 WHERE id = ?',
      [aadhaarHash, candidateId]
    );

    // Trigger score recalculation
    const { calculateAndSave } = require('../services/careerScore');
    await calculateAndSave(candidateId);

    res.json({ success: true, message: 'DigiLocker linked successfully' });
  } catch (err) {
    console.error('DigiLocker error:', err.message);
    res.status(500).json({ success: false, message: 'DigiLocker linking failed' });
  }
});

module.exports = router;
