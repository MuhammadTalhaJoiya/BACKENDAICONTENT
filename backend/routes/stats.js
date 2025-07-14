const express = require('express');
const { promisePool } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get user statistics
router.get('/user', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = 'month' } = req.query;

    let dateFilter;
    switch (period) {
      case 'week':
        dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 1 WEEK)';
        break;
      case 'month':
        dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 1 MONTH)';
        break;
      case 'quarter':
        dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 3 MONTH)';
        break;
      case 'year':
        dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 1 YEAR)';
        break;
      default:
        dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 1 MONTH)';
    }

    // Content statistics
    const [contentStats] = await promisePool.execute(`
      SELECT 
        COUNT(*) as total_content,
        COUNT(CASE WHEN created_at >= ${dateFilter} THEN 1 END) as content_this_period,
        COUNT(CASE WHEN status = 'published' THEN 1 END) as published_content,
        COUNT(CASE WHEN is_favorite = 1 THEN 1 END) as favorite_content,
        SUM(CASE WHEN word_count IS NOT NULL THEN word_count ELSE 0 END) as total_words,
        AVG(CASE WHEN word_count > 0 THEN word_count END) as avg_word_count,
        AVG(CASE WHEN seo_score > 0 THEN seo_score END) as avg_seo_score
      FROM content_items 
      WHERE user_id = ? AND status != 'archived'
    `, [userId]);

    // Project statistics
    const [projectStats] = await promisePool.execute(`
      SELECT 
        COUNT(*) as total_projects,
        COUNT(CASE WHEN created_at >= ${dateFilter} THEN 1 END) as projects_this_period,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_projects,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as active_projects
      FROM projects 
      WHERE user_id = ? AND status != 'archived'
    `, [userId]);

    // Content type distribution
    const [contentTypeStats] = await promisePool.execute(`
      SELECT 
        content_type,
        COUNT(*) as count,
        ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM content_items WHERE user_id = ? AND status != 'archived')), 2) as percentage
      FROM content_items
      WHERE user_id = ? AND status != 'archived'
      GROUP BY content_type
      ORDER BY count DESC
    `, [userId, userId]);

    // Activity trends (last 30 days)
    const [activityTrends] = await promisePool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as activity_count
      FROM activity_logs
      WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [userId]);

    // Content creation trends
    const [contentTrends] = await promisePool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as content_count,
        SUM(word_count) as words_created
      FROM content_items
      WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND status != 'archived'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [userId]);

    // Usage statistics
    const [usageStats] = await promisePool.execute(`
      SELECT 
        SUM(content_generated) as total_content_generated,
        SUM(tokens_used) as total_tokens_used,
        SUM(api_calls) as total_api_calls,
        AVG(content_generated) as avg_daily_content
      FROM usage_statistics
      WHERE user_id = ? AND date >= ${dateFilter}
    `, [userId]);

    res.json({
      success: true,
      data: {
        content: contentStats[0],
        projects: projectStats[0],
        content_types: contentTypeStats,
        activity_trends: activityTrends,
        content_trends: contentTrends,
        usage: usageStats[0] || {
          total_content_generated: 0,
          total_tokens_used: 0,
          total_api_calls: 0,
          avg_daily_content: 0
        },
        period
      }
    });

  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user statistics'
    });
  }
});

// Get team statistics (for team owners/admins)
router.get('/team/:teamId', authenticateToken, async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const userId = req.user.id;

    // Check if user has access to team stats
    const [access] = await promisePool.execute(`
      SELECT t.name
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = ?
      WHERE t.id = ? AND (t.owner_id = ? OR (tm.role IN ('admin') AND tm.status = 'active'))
    `, [userId, teamId, userId]);

    if (access.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found or insufficient permissions'
      });
    }

    // Team member statistics
    const [memberStats] = await promisePool.execute(`
      SELECT 
        COUNT(*) as total_members,
        COUNT(CASE WHEN tm.status = 'active' THEN 1 END) as active_members,
        COUNT(CASE WHEN tm.status = 'pending' THEN 1 END) as pending_members
      FROM team_members tm
      WHERE tm.team_id = ?
    `, [teamId]);

    // Team content statistics
    const [contentStats] = await promisePool.execute(`
      SELECT 
        COUNT(*) as total_content,
        COUNT(CASE WHEN ci.status = 'published' THEN 1 END) as published_content,
        SUM(CASE WHEN ci.word_count IS NOT NULL THEN ci.word_count ELSE 0 END) as total_words,
        COUNT(DISTINCT ci.user_id) as contributing_members
      FROM content_items ci
      WHERE ci.team_id = ? AND ci.status != 'archived'
    `, [teamId]);

    // Team project statistics
    const [projectStats] = await promisePool.execute(`
      SELECT 
        COUNT(*) as total_projects,
        COUNT(CASE WHEN p.status = 'completed' THEN 1 END) as completed_projects,
        COUNT(CASE WHEN p.status = 'in_progress' THEN 1 END) as active_projects
      FROM projects p
      WHERE p.team_id = ? AND p.status != 'archived'
    `, [teamId]);

    // Member activity
    const [memberActivity] = await promisePool.execute(`
      SELECT 
        u.first_name,
        u.last_name,
        u.id as user_id,
        COUNT(ci.id) as content_count,
        SUM(CASE WHEN ci.word_count IS NOT NULL THEN ci.word_count ELSE 0 END) as words_created,
        MAX(ci.created_at) as last_content_created
      FROM team_members tm
      LEFT JOIN users u ON tm.user_id = u.id
      LEFT JOIN content_items ci ON u.id = ci.user_id AND ci.team_id = ? AND ci.status != 'archived'
      WHERE tm.team_id = ? AND tm.status = 'active'
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY content_count DESC
    `, [teamId, teamId]);

    // Team content creation trends (last 30 days)
    const [teamTrends] = await promisePool.execute(`
      SELECT 
        DATE(ci.created_at) as date,
        COUNT(*) as content_count,
        COUNT(DISTINCT ci.user_id) as active_members
      FROM content_items ci
      WHERE ci.team_id = ? AND ci.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND ci.status != 'archived'
      GROUP BY DATE(ci.created_at)
      ORDER BY date ASC
    `, [teamId]);

    res.json({
      success: true,
      data: {
        team_name: access[0].name,
        members: memberStats[0],
        content: contentStats[0],
        projects: projectStats[0],
        member_activity: memberActivity.map(m => ({
          ...m,
          name: `${m.first_name} ${m.last_name}`
        })),
        trends: teamTrends
      }
    });

  } catch (error) {
    console.error('Get team stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get team statistics'
    });
  }
});

// Get content performance analytics
router.get('/content/performance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = 'month', content_type } = req.query;

    let dateFilter;
    switch (period) {
      case 'week':
        dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 1 WEEK)';
        break;
      case 'month':
        dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 1 MONTH)';
        break;
      case 'quarter':
        dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 3 MONTH)';
        break;
      default:
        dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 1 MONTH)';
    }

    let whereClause = `WHERE ci.user_id = ? AND ci.created_at >= ${dateFilter} AND ci.status != 'archived'`;
    let params = [userId];

    if (content_type) {
      whereClause += ' AND ci.content_type = ?';
      params.push(content_type);
    }

    // Top performing content by SEO score
    const [topContent] = await promisePool.execute(`
      SELECT 
        ci.id,
        ci.title,
        ci.content_type,
        ci.seo_score,
        ci.word_count,
        ci.is_favorite,
        ci.created_at
      FROM content_items ci
      ${whereClause} AND ci.seo_score > 0
      ORDER BY ci.seo_score DESC
      LIMIT 10
    `, params);

    // Average scores by content type
    const [typePerformance] = await promisePool.execute(`
      SELECT 
        ci.content_type,
        COUNT(*) as content_count,
        AVG(ci.seo_score) as avg_seo_score,
        AVG(ci.word_count) as avg_word_count,
        COUNT(CASE WHEN ci.is_favorite = 1 THEN 1 END) as favorite_count
      FROM content_items ci
      ${whereClause}
      GROUP BY ci.content_type
      ORDER BY avg_seo_score DESC
    `, params);

    // Performance trends over time
    const [performanceTrends] = await promisePool.execute(`
      SELECT 
        DATE(ci.created_at) as date,
        COUNT(*) as content_count,
        AVG(ci.seo_score) as avg_seo_score,
        AVG(ci.word_count) as avg_word_count
      FROM content_items ci
      ${whereClause}
      GROUP BY DATE(ci.created_at)
      ORDER BY date ASC
    `, params);

    res.json({
      success: true,
      data: {
        top_content: topContent,
        type_performance: typePerformance.map(t => ({
          ...t,
          avg_seo_score: Math.round(t.avg_seo_score * 10) / 10,
          avg_word_count: Math.round(t.avg_word_count)
        })),
        trends: performanceTrends.map(t => ({
          ...t,
          avg_seo_score: Math.round(t.avg_seo_score * 10) / 10,
          avg_word_count: Math.round(t.avg_word_count)
        })),
        period
      }
    });

  } catch (error) {
    console.error('Get content performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get content performance analytics'
    });
  }
});

// Get productivity statistics
router.get('/productivity', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Daily productivity (last 30 days)
    const [dailyStats] = await promisePool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as content_created,
        SUM(word_count) as words_written,
        COUNT(DISTINCT content_type) as content_types_used
      FROM content_items
      WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND status != 'archived'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [userId]);

    // Hourly productivity patterns
    const [hourlyStats] = await promisePool.execute(`
      SELECT 
        HOUR(created_at) as hour,
        COUNT(*) as content_count,
        AVG(word_count) as avg_words
      FROM content_items
      WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND status != 'archived'
      GROUP BY HOUR(created_at)
      ORDER BY hour ASC
    `, [userId]);

    // Most productive days of week
    const [weeklyStats] = await promisePool.execute(`
      SELECT 
        DAYNAME(created_at) as day_name,
        DAYOFWEEK(created_at) as day_number,
        COUNT(*) as content_count,
        AVG(word_count) as avg_words
      FROM content_items
      WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND status != 'archived'
      GROUP BY DAYOFWEEK(created_at), DAYNAME(created_at)
      ORDER BY day_number ASC
    `, [userId]);

    // Content completion rates
    const [completionStats] = await promisePool.execute(`
      SELECT 
        status,
        COUNT(*) as count,
        ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM content_items WHERE user_id = ? AND status != 'archived')), 2) as percentage
      FROM content_items
      WHERE user_id = ? AND status != 'archived'
      GROUP BY status
      ORDER BY count DESC
    `, [userId, userId]);

    res.json({
      success: true,
      data: {
        daily_productivity: dailyStats,
        hourly_patterns: hourlyStats.map(h => ({
          ...h,
          avg_words: Math.round(h.avg_words || 0)
        })),
        weekly_patterns: weeklyStats.map(w => ({
          ...w,
          avg_words: Math.round(w.avg_words || 0)
        })),
        completion_rates: completionStats
      }
    });

  } catch (error) {
    console.error('Get productivity stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get productivity statistics'
    });
  }
});

module.exports = router;