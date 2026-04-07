const jwt = require('jsonwebtoken');
const { queryOne } = require('../config/database');

const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await queryOne(
      'SELECT id, email, role, is_active FROM users WHERE id = ?',
      [decoded.userId]
    );
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'Invalid or inactive account' });
    }
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden — insufficient role' });
  }
  next();
};

const requireCandidate = requireRole('candidate');
const requireEmployer = requireRole('employer', 'admin');
const requireAdmin = requireRole('admin');

module.exports = { auth, requireRole, requireCandidate, requireEmployer, requireAdmin };
