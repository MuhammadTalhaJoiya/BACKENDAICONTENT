const express = require('express');
const { promisePool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { validate, projectSchemas } = require('../middleware/validation');
const { logActivity } = require('../middleware/logger');

const router = express.Router();

// Get all projects for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, status, search } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE p.user_id = ? AND p.status != "archived"';
    let params = [userId];

    if (status) {
      whereClause += ' AND p.status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ' AND (p.name LIKE ? OR p.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [projects] = await promisePool.execute(`
      SELECT 
        p.*,
        COUNT(ci.id) as content_count,
        bs.name as brand_style_name,
        u.first_name,
        u.last_name
      FROM projects p
      LEFT JOIN content_items ci ON p.id = ci.project_id AND ci.status != 'archived'
      LEFT JOIN brand_styles bs ON p.brand_style_id = bs.id
      LEFT JOIN users u ON p.user_id = u.id
      ${whereClause}
      GROUP BY p.id
      ORDER BY p.updated_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), parseInt(offset)]);

    const [countResult] = await promisePool.execute(`
      SELECT COUNT(*) as total
      FROM projects p
      ${whereClause}
    `, params);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        projects: projects.map(p => ({
          ...p,
          settings: p.settings ? JSON.parse(p.settings) : {},
          author: `${p.first_name} ${p.last_name}`
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
    console.error('Get projects error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get projects'
    });
  }
});

// Get single project
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user.id;

    const [projects] = await promisePool.execute(`
      SELECT 
        p.*,
        bs.name as brand_style_name,
        bs.voice_type,
        bs.personality,
        u.first_name,
        u.last_name
      FROM projects p
      LEFT JOIN brand_styles bs ON p.brand_style_id = bs.id
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ? AND p.user_id = ?
    `, [projectId, userId]);

    if (projects.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const project = projects[0];

    // Get project content
    const [content] = await promisePool.execute(`
      SELECT 
        id, title, content_type, category, status, word_count, 
        is_favorite, created_at, updated_at
      FROM content_items
      WHERE project_id = ? AND user_id = ? AND status != 'archived'
      ORDER BY updated_at DESC
    `, [projectId, userId]);

    // Get project statistics
    const [stats] = await promisePool.execute(`
      SELECT 
        COUNT(*) as total_content,
        COUNT(CASE WHEN status = 'published' THEN 1 END) as published_count,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_count,
        SUM(CASE WHEN word_count IS NOT NULL THEN word_count ELSE 0 END) as total_words
      FROM content_items
      WHERE project_id = ? AND user_id = ? AND status != 'archived'
    `, [projectId, userId]);

    res.json({
      success: true,
      data: {
        project: {
          ...project,
          settings: project.settings ? JSON.parse(project.settings) : {},
          author: `${project.first_name} ${project.last_name}`,
          content,
          statistics: stats[0]
        }
      }
    });

  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get project'
    });
  }
});

// Create new project
router.post('/', authenticateToken, validate(projectSchemas.createProject), async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, description, type, brand_style_id, settings } = req.body;

    const [result] = await promisePool.execute(`
      INSERT INTO projects (user_id, name, description, type, brand_style_id, settings, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [userId, name, description, type, brand_style_id, JSON.stringify(settings || {})]);

    const projectId = result.insertId;

    // Log activity
    await logActivity(userId, 'project_created', 'project', projectId, { name, type }, req);

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      data: { id: projectId }
    });

  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create project'
    });
  }
});

// Update project
router.put('/:id', authenticateToken, validate(projectSchemas.updateProject), async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user.id;
    const updates = req.body;

    // Check if project exists and belongs to user
    const [existing] = await promisePool.execute(
      'SELECT name FROM projects WHERE id = ? AND user_id = ?',
      [projectId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Build update query
    const updateFields = [];
    const params = [];

    Object.keys(updates).forEach(key => {
      if (['name', 'description', 'type', 'status', 'brand_style_id'].includes(key)) {
        updateFields.push(`${key} = ?`);
        params.push(updates[key]);
      } else if (key === 'settings') {
        updateFields.push('settings = ?');
        params.push(JSON.stringify(updates[key]));
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    updateFields.push('updated_at = NOW()');
    params.push(projectId, userId);

    await promisePool.execute(`
      UPDATE projects 
      SET ${updateFields.join(', ')} 
      WHERE id = ? AND user_id = ?
    `, params);

    // Log activity
    await logActivity(userId, 'project_updated', 'project', projectId, { fields: Object.keys(updates) }, req);

    res.json({
      success: true,
      message: 'Project updated successfully'
    });

  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update project'
    });
  }
});

// Delete project
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user.id;

    // Check if project exists and belongs to user
    const [existing] = await promisePool.execute(
      'SELECT name FROM projects WHERE id = ? AND user_id = ?',
      [projectId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Soft delete by setting status to archived
    await promisePool.execute(
      'UPDATE projects SET status = "archived", updated_at = NOW() WHERE id = ? AND user_id = ?',
      [projectId, userId]
    );

    // Also archive all content in this project
    await promisePool.execute(
      'UPDATE content_items SET status = "archived", updated_at = NOW() WHERE project_id = ? AND user_id = ?',
      [projectId, userId]
    );

    // Log activity
    await logActivity(userId, 'project_deleted', 'project', projectId, { name: existing[0].name }, req);

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });

  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete project'
    });
  }
});

module.exports = router;