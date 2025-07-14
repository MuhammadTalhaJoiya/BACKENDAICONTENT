const express = require('express');
const { promisePool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get dashboard statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get content statistics
    const [contentStats] = await promisePool.execute(`
      SELECT 
        COUNT(*) as total_content,
        COUNT(CASE WHEN status = 'published' THEN 1 END) as published_content,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_content,
        COUNT(CASE WHEN is_favorite = 1 THEN 1 END) as favorite_content,
        SUM(CASE WHEN word_count IS NOT NULL THEN word_count ELSE 0 END) as total_words
      FROM content_items 
      WHERE user_id = ? AND status != 'archived'
    `, [userId]);

    // Get project statistics
    const [projectStats] = await promisePool.execute(`
      SELECT 
        COUNT(*) as total_projects,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as active_projects,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_projects
      FROM projects 
      WHERE user_id = ? AND status != 'archived'
    `, [userId]);

    // Get team statistics
    const [teamStats] = await promisePool.execute(`
      SELECT 
        COUNT(DISTINCT t.id) as total_teams,
        COUNT(DISTINCT tm.user_id) as total_team_members
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      WHERE t.owner_id = ? OR tm.user_id = ?
    `, [userId, userId]);

    // Get usage statistics for current month
    const [usageStats] = await promisePool.execute(`
      SELECT 
        COALESCE(SUM(content_generated), 0) as content_generated_this_month,
        COALESCE(SUM(tokens_used), 0) as tokens_used_this_month,
        COALESCE(SUM(api_calls), 0) as api_calls_this_month
      FROM usage_statistics 
      WHERE user_id = ? AND YEAR(date) = YEAR(CURDATE()) AND MONTH(date) = MONTH(CURDATE())
    `, [userId]);

    // Calculate hours saved (rough estimate: 1 hour per 500 words)
    const hoursSaved = Math.round((contentStats[0].total_words || 0) / 500);

    const stats = {
      content_generated: contentStats[0].total_content || 0,
      active_projects: projectStats[0].active_projects || 0,
      team_members: teamStats[0].total_team_members || 0,
      hours_saved: hoursSaved,
      published_content: contentStats[0].published_content || 0,
      draft_content: contentStats[0].draft_content || 0,
      favorite_content: contentStats[0].favorite_content || 0,
      total_words: contentStats[0].total_words || 0,
      completed_projects: projectStats[0].completed_projects || 0,
      total_teams: teamStats[0].total_teams || 0,
      content_generated_this_month: usageStats[0].content_generated_this_month || 0,
      tokens_used_this_month: usageStats[0].tokens_used_this_month || 0,
      api_calls_this_month: usageStats[0].api_calls_this_month || 0
    };

    res.json({
      success: true,
      data: { stats }
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard statistics'
    });
  }
});

// Get recent projects
router.get('/recent-projects', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 5;

    const [projects] = await promisePool.execute(`
      SELECT 
        p.id,
        p.name,
        p.type,
        p.status,
        p.updated_at,
        COUNT(ci.id) as content_count,
        u.first_name,
        u.last_name
      FROM projects p
      LEFT JOIN content_items ci ON p.id = ci.project_id
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.user_id = ? AND p.status != 'archived'
      GROUP BY p.id, p.name, p.type, p.status, p.updated_at, u.first_name, u.last_name
      ORDER BY p.updated_at DESC
      LIMIT ?
    `, [userId, limit]);

    const recentProjects = projects.map(project => ({
      id: project.id,
      name: project.name,
      type: project.type || 'General',
      status: project.status,
      content_count: project.content_count,
      author: `${project.first_name} ${project.last_name}`,
      updated_at: project.updated_at
    }));

    res.json({
      success: true,
      data: { projects: recentProjects }
    });

  } catch (error) {
    console.error('Recent projects error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get recent projects'
    });
  }
});

// Get recent content
router.get('/recent-content', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;

    const [content] = await promisePool.execute(`
      SELECT 
        ci.id,
        ci.title,
        ci.content_type,
        ci.category,
        ci.status,
        ci.word_count,
        ci.is_favorite,
        ci.created_at,
        ci.updated_at,
        p.name as project_name,
        u.first_name,
        u.last_name
      FROM content_items ci
      LEFT JOIN projects p ON ci.project_id = p.id
      LEFT JOIN users u ON ci.user_id = u.id
      WHERE ci.user_id = ? AND ci.status != 'archived'
      ORDER BY ci.updated_at DESC
      LIMIT ?
    `, [userId, limit]);

    const recentContent = content.map(item => ({
      id: item.id,
      title: item.title,
      type: item.content_type,
      category: item.category || 'Uncategorized',
      status: item.status,
      word_count: item.word_count,
      is_favorite: item.is_favorite,
      project_name: item.project_name,
      author: `${item.first_name} ${item.last_name}`,
      created_at: item.created_at,
      updated_at: item.updated_at
    }));

    res.json({
      success: true,
      data: { content: recentContent }
    });

  } catch (error) {
    console.error('Recent content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get recent content'
    });
  }
});

// Get activity timeline
router.get('/activity', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20;

    const [activities] = await promisePool.execute(`
      SELECT 
        action,
        resource_type,
        resource_id,
        details,
        created_at
      FROM activity_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [userId, limit]);

    const timeline = activities.map(activity => ({
      action: activity.action,
      resource_type: activity.resource_type,
      resource_id: activity.resource_id,
      details: activity.details ? JSON.parse(activity.details) : null,
      timestamp: activity.created_at
    }));

    res.json({
      success: true,
      data: { timeline }
    });

  } catch (error) {
    console.error('Activity timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get activity timeline'
    });
  }
});

// Get content generation trends (last 30 days)
router.get('/trends', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [trends] = await promisePool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as content_count,
        SUM(CASE WHEN word_count IS NOT NULL THEN word_count ELSE 0 END) as total_words
      FROM content_items
      WHERE user_id = ? 
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND status != 'archived'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [userId]);

    res.json({
      success: true,
      data: { trends }
    });

  } catch (error) {
    console.error('Content trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get content trends'
    });
  }
});

// Get content type distribution
router.get('/content-distribution', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [distribution] = await promisePool.execute(`
      SELECT 
        content_type,
        COUNT(*) as count,
        ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM content_items WHERE user_id = ? AND status != 'archived')), 2) as percentage
      FROM content_items
      WHERE user_id = ? AND status != 'archived'
      GROUP BY content_type
      ORDER BY count DESC
    `, [userId, userId]);

    res.json({
      success: true,
      data: { distribution }
    });

  } catch (error) {
    console.error('Content distribution error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get content distribution'
    });
  }
});

module.exports = router;