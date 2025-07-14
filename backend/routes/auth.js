const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { promisePool } = require('../config/database');
const { validate, userSchemas } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');
const { logActivity } = require('../middleware/logger');

const router = express.Router();

// Register new user
router.post('/register', validate(userSchemas.register), async (req, res) => {
  try {
    const { first_name, last_name, email, password, company, website } = req.body;

    // Check if user already exists
    const [existingUsers] = await promisePool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const [result] = await promisePool.execute(
      'INSERT INTO users (first_name, last_name, email, password, company, website, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [first_name, last_name, email, hashedPassword, company, website, 'active']
    );

    const userId = result.insertId;

    // Create default user preferences
    await promisePool.execute(
      'INSERT INTO user_preferences (user_id, email_notifications, dashboard_layout, default_settings, theme) VALUES (?, ?, ?, ?, ?)',
      [
        userId,
        JSON.stringify({
          content_generated: true,
          team_invitations: true,
          project_updates: true,
          weekly_summary: true
        }),
        JSON.stringify({ layout: 'default' }),
        JSON.stringify({
          default_tone: 'professional',
          default_word_count: 500,
          auto_save: true
        }),
        'system'
      ]
    );

    // Log activity
    await logActivity(userId, 'user_registered', 'user', userId, { email }, req);

    // Generate JWT token
    const token = jwt.sign(
      { userId, email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: userId,
          first_name,
          last_name,
          email,
          company,
          website,
          role: 'writer',
          status: 'active',
          avatar: null
        },
        token
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register user'
    });
  }
});

// Login user
router.post('/login', validate(userSchemas.login), async (req, res) => {
  try {
    const { email, password } = req.body;

    // Get user from database
    const [users] = await promisePool.execute(
      'SELECT id, first_name, last_name, email, password, role, status, avatar, company, website FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = users[0];

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Account is not active. Please contact support.'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last login
    await promisePool.execute(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    // Log activity
    await logActivity(user.id, 'user_login', 'user', user.id, { email }, req);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    // Remove password from response
    delete user.password;

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to login'
    });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [users] = await promisePool.execute(
      'SELECT id, first_name, last_name, email, role, status, avatar, bio, company, website, phone, timezone, language, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user preferences
    const [preferences] = await promisePool.execute(
      'SELECT email_notifications, dashboard_layout, default_settings, theme FROM user_preferences WHERE user_id = ?',
      [req.user.id]
    );

    const user = users[0];
    user.preferences = preferences[0] || null;

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user information'
    });
  }
});

// Refresh token
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    // Generate new token
    const token = jwt.sign(
      { userId: req.user.id, email: req.user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: { token }
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
});

// Logout (mainly for activity logging)
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Log activity
    await logActivity(req.user.id, 'user_logout', 'user', req.user.id, null, req);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to logout'
    });
  }
});

// Change password
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long'
      });
    }

    // Get current password
    const [users] = await promisePool.execute(
      'SELECT password FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(current_password, users[0].password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(new_password, saltRounds);

    // Update password
    await promisePool.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedNewPassword, req.user.id]
    );

    // Log activity
    await logActivity(req.user.id, 'password_changed', 'user', req.user.id, null, req);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
});

module.exports = router;