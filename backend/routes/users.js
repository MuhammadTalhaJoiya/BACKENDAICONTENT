const express = require('express');
const { promisePool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { validate, userSchemas } = require('../middleware/validation');
const { upload, processImage } = require('../middleware/upload');
const { logActivity } = require('../middleware/logger');
const path = require('path');

const router = express.Router();

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [users] = await promisePool.execute(`
      SELECT 
        u.id, u.first_name, u.last_name, u.email, u.avatar, u.bio,
        u.company, u.website, u.phone, u.timezone, u.language, 
        u.role, u.status, u.created_at, u.last_login,
        up.email_notifications, up.dashboard_layout, up.default_settings, up.theme
      FROM users u
      LEFT JOIN user_preferences up ON u.id = up.user_id
      WHERE u.id = ?
    `, [userId]);

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    // Parse JSON fields
    user.email_notifications = user.email_notifications ? JSON.parse(user.email_notifications) : {};
    user.dashboard_layout = user.dashboard_layout ? JSON.parse(user.dashboard_layout) : {};
    user.default_settings = user.default_settings ? JSON.parse(user.default_settings) : {};

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile'
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, validate(userSchemas.updateProfile), async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // Build update query
    const updateFields = [];
    const params = [];

    Object.keys(updates).forEach(key => {
      if (['first_name', 'last_name', 'bio', 'company', 'website', 'phone', 'timezone', 'language'].includes(key)) {
        updateFields.push(`${key} = ?`);
        params.push(updates[key]);
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    updateFields.push('updated_at = NOW()');
    params.push(userId);

    await promisePool.execute(`
      UPDATE users 
      SET ${updateFields.join(', ')} 
      WHERE id = ?
    `, params);

    // Log activity
    await logActivity(userId, 'profile_updated', 'user', userId, { fields: Object.keys(updates) }, req);

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// Upload avatar
router.post('/avatar', authenticateToken, upload.single('avatar'), processImage, async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Get old avatar to delete later
    const [users] = await promisePool.execute(
      'SELECT avatar FROM users WHERE id = ?',
      [userId]
    );

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // Update user avatar
    await promisePool.execute(
      'UPDATE users SET avatar = ?, updated_at = NOW() WHERE id = ?',
      [avatarUrl, userId]
    );

    // Delete old avatar file if exists
    if (users[0] && users[0].avatar) {
      const oldAvatarPath = path.join(__dirname, '..', users[0].avatar);
      try {
        require('fs').unlinkSync(oldAvatarPath);
      } catch (error) {
        // Ignore error if file doesn't exist
      }
    }

    // Log activity
    await logActivity(userId, 'avatar_updated', 'user', userId, null, req);

    res.json({
      success: true,
      message: 'Avatar updated successfully',
      data: { avatar_url: avatarUrl }
    });

  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload avatar'
    });
  }
});

// Delete avatar
router.delete('/avatar', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get current avatar
    const [users] = await promisePool.execute(
      'SELECT avatar FROM users WHERE id = ?',
      [userId]
    );

    if (!users[0] || !users[0].avatar) {
      return res.status(404).json({
        success: false,
        message: 'No avatar to delete'
      });
    }

    // Delete avatar file
    const avatarPath = path.join(__dirname, '..', users[0].avatar);
    try {
      require('fs').unlinkSync(avatarPath);
    } catch (error) {
      // Ignore error if file doesn't exist
    }

    // Update user record
    await promisePool.execute(
      'UPDATE users SET avatar = NULL, updated_at = NOW() WHERE id = ?',
      [userId]
    );

    // Log activity
    await logActivity(userId, 'avatar_deleted', 'user', userId, null, req);

    res.json({
      success: true,
      message: 'Avatar deleted successfully'
    });

  } catch (error) {
    console.error('Delete avatar error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete avatar'
    });
  }
});

// Update user preferences
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { email_notifications, dashboard_layout, default_settings, theme } = req.body;

    // Update or insert preferences
    await promisePool.execute(`
      INSERT INTO user_preferences (user_id, email_notifications, dashboard_layout, default_settings, theme, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
      email_notifications = VALUES(email_notifications),
      dashboard_layout = VALUES(dashboard_layout),
      default_settings = VALUES(default_settings),
      theme = VALUES(theme),
      updated_at = NOW()
    `, [
      userId,
      email_notifications ? JSON.stringify(email_notifications) : null,
      dashboard_layout ? JSON.stringify(dashboard_layout) : null,
      default_settings ? JSON.stringify(default_settings) : null,
      theme
    ]);

    // Log activity
    await logActivity(userId, 'preferences_updated', 'user', userId, null, req);

    res.json({
      success: true,
      message: 'Preferences updated successfully'
    });

  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update preferences'
    });
  }
});

// Get user activity log
router.get('/activity', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, action_type } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE user_id = ?';
    let params = [userId];

    if (action_type) {
      whereClause += ' AND action = ?';
      params.push(action_type);
    }

    const [activities] = await promisePool.execute(`
      SELECT 
        action, resource_type, resource_id, details, ip_address, created_at
      FROM activity_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), parseInt(offset)]);

    const [countResult] = await promisePool.execute(`
      SELECT COUNT(*) as total
      FROM activity_logs
      ${whereClause}
    `, params);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        activities: activities.map(activity => ({
          ...activity,
          details: activity.details ? JSON.parse(activity.details) : null
        })),
        pagination: {
          current_page: parseInt(page),
          total_pages: totalPages,
          total_items: total,
          items_per_page: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Get user activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user activity'
    });
  }
});

// Get user statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get content statistics
    const [contentStats] = await promisePool.execute(`
      SELECT 
        COUNT(*) as total_content,
        COUNT(CASE WHEN status = 'published' THEN 1 END) as published_content,
        COUNT(CASE WHEN is_favorite = 1 THEN 1 END) as favorite_content,
        SUM(CASE WHEN word_count IS NOT NULL THEN word_count ELSE 0 END) as total_words,
        AVG(CASE WHEN word_count IS NOT NULL THEN word_count ELSE 0 END) as avg_word_count
      FROM content_items 
      WHERE user_id = ? AND status != 'archived'
    `, [userId]);

    // Get project statistics
    const [projectStats] = await promisePool.execute(`
      SELECT 
        COUNT(*) as total_projects,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_projects
      FROM projects 
      WHERE user_id = ? AND status != 'archived'
    `, [userId]);

    // Get monthly usage
    const [monthlyUsage] = await promisePool.execute(`
      SELECT 
        COALESCE(SUM(content_generated), 0) as content_this_month,
        COALESCE(SUM(tokens_used), 0) as tokens_this_month,
        COALESCE(SUM(api_calls), 0) as api_calls_this_month
      FROM usage_statistics 
      WHERE user_id = ? AND YEAR(date) = YEAR(CURDATE()) AND MONTH(date) = MONTH(CURDATE())
    `, [userId]);

    // Get recent activity count
    const [recentActivity] = await promisePool.execute(`
      SELECT COUNT(*) as recent_actions
      FROM activity_logs
      WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `, [userId]);

    const stats = {
      content: contentStats[0],
      projects: projectStats[0],
      usage: monthlyUsage[0],
      recent_activity: recentActivity[0].recent_actions
    };

    res.json({
      success: true,
      data: { stats }
    });

  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user statistics'
    });
  }
});

// Deactivate account
router.post('/deactivate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { reason } = req.body;

    // Update user status
    await promisePool.execute(
      'UPDATE users SET status = "inactive", updated_at = NOW() WHERE id = ?',
      [userId]
    );

    // Log activity
    await logActivity(userId, 'account_deactivated', 'user', userId, { reason }, req);

    res.json({
      success: true,
      message: 'Account deactivated successfully'
    });

  } catch (error) {
    console.error('Deactivate account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate account'
    });
  }
});

module.exports = router;