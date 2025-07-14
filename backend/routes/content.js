const express = require('express');
const { promisePool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { validate, contentSchemas } = require('../middleware/validation');
const { logActivity } = require('../middleware/logger');

const router = express.Router();

// Get all content for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      page = 1, 
      limit = 20, 
      type, 
      category, 
      status, 
      search,
      sort = 'created_at',
      order = 'desc',
      favorites_only 
    } = req.query;

    const offset = (page - 1) * limit;
    
    // Build WHERE clause
    let whereClause = 'WHERE ci.user_id = ? AND ci.status != "archived"';
    let params = [userId];

    if (type) {
      whereClause += ' AND ci.content_type = ?';
      params.push(type);
    }

    if (category) {
      whereClause += ' AND ci.category = ?';
      params.push(category);
    }

    if (status) {
      whereClause += ' AND ci.status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ' AND (ci.title LIKE ? OR ci.content LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (favorites_only === 'true') {
      whereClause += ' AND ci.is_favorite = 1';
    }

    // Validate sort column
    const allowedSortColumns = ['created_at', 'updated_at', 'title', 'word_count', 'status'];
    const sortColumn = allowedSortColumns.includes(sort) ? sort : 'created_at';
    const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Get content with pagination
    const [content] = await promisePool.execute(`
      SELECT 
        ci.id,
        ci.title,
        ci.content_type,
        ci.category,
        ci.status,
        ci.word_count,
        ci.is_favorite,
        ci.tone,
        ci.target_audience,
        ci.keywords,
        ci.seo_score,
        ci.readability_score,
        ci.created_at,
        ci.updated_at,
        ci.published_at,
        p.name as project_name,
        bs.name as brand_style_name,
        u.first_name,
        u.last_name
      FROM content_items ci
      LEFT JOIN projects p ON ci.project_id = p.id
      LEFT JOIN brand_styles bs ON ci.brand_style_id = bs.id
      LEFT JOIN users u ON ci.user_id = u.id
      ${whereClause}
      ORDER BY ci.${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), parseInt(offset)]);

    // Get total count
    const [countResult] = await promisePool.execute(`
      SELECT COUNT(*) as total
      FROM content_items ci
      ${whereClause}
    `, params);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        content: content.map(item => ({
          ...item,
          keywords: item.keywords ? JSON.parse(item.keywords) : [],
          author: `${item.first_name} ${item.last_name}`
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
    console.error('Get content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get content'
    });
  }
});

// Get single content item
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const contentId = req.params.id;
    const userId = req.user.id;

    const [content] = await promisePool.execute(`
      SELECT 
        ci.*,
        p.name as project_name,
        bs.name as brand_style_name,
        bs.voice_type,
        bs.personality,
        bs.key_messages,
        bs.color_palette,
        pt.name as prompt_template_name,
        u.first_name,
        u.last_name
      FROM content_items ci
      LEFT JOIN projects p ON ci.project_id = p.id
      LEFT JOIN brand_styles bs ON ci.brand_style_id = bs.id
      LEFT JOIN prompt_templates pt ON ci.prompt_template_id = pt.id
      LEFT JOIN users u ON ci.user_id = u.id
      WHERE ci.id = ? AND ci.user_id = ?
    `, [contentId, userId]);

    if (content.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    const item = content[0];

    // Parse JSON fields
    const parsedItem = {
      ...item,
      keywords: item.keywords ? JSON.parse(item.keywords) : [],
      metadata: item.metadata ? JSON.parse(item.metadata) : {},
      key_messages: item.key_messages ? JSON.parse(item.key_messages) : [],
      color_palette: item.color_palette ? JSON.parse(item.color_palette) : {},
      author: `${item.first_name} ${item.last_name}`
    };

    // Get content versions
    const [versions] = await promisePool.execute(`
      SELECT 
        cv.id,
        cv.version_number,
        cv.changes_summary,
        cv.created_at,
        u.first_name,
        u.last_name
      FROM content_versions cv
      LEFT JOIN users u ON cv.created_by = u.id
      WHERE cv.content_item_id = ?
      ORDER BY cv.version_number DESC
    `, [contentId]);

    parsedItem.versions = versions.map(v => ({
      ...v,
      created_by: `${v.first_name} ${v.last_name}`
    }));

    // Get comments
    const [comments] = await promisePool.execute(`
      SELECT 
        c.id,
        c.comment_text,
        c.status,
        c.created_at,
        u.first_name,
        u.last_name,
        u.avatar
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.content_item_id = ? AND c.status = 'active'
      ORDER BY c.created_at ASC
    `, [contentId]);

    parsedItem.comments = comments.map(c => ({
      ...c,
      author: `${c.first_name} ${c.last_name}`
    }));

    res.json({
      success: true,
      data: { content: parsedItem }
    });

  } catch (error) {
    console.error('Get content item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get content item'
    });
  }
});

// Create new content
router.post('/', authenticateToken, validate(contentSchemas.createContent), async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      title,
      content_type,
      category,
      content,
      tone,
      target_audience,
      keywords,
      project_id,
      brand_style_id,
      prompt_template_id
    } = req.body;

    // Calculate word count if content is provided
    const wordCount = content ? content.split(/\s+/).filter(word => word.length > 0).length : 0;

    // Insert content
    const [result] = await promisePool.execute(`
      INSERT INTO content_items (
        user_id, title, content_type, category, content, word_count,
        tone, target_audience, keywords, project_id, brand_style_id, 
        prompt_template_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NOW())
    `, [
      userId, title, content_type, category, content, wordCount,
      tone, target_audience, JSON.stringify(keywords || []),
      project_id, brand_style_id, prompt_template_id
    ]);

    const contentId = result.insertId;

    // Create initial version
    await promisePool.execute(`
      INSERT INTO content_versions (content_item_id, version_number, title, content, changes_summary, created_by)
      VALUES (?, 1, ?, ?, 'Initial version', ?)
    `, [contentId, title, content, userId]);

    // Update usage statistics
    await promisePool.execute(`
      INSERT INTO usage_statistics (user_id, date, content_generated)
      VALUES (?, CURDATE(), 1)
      ON DUPLICATE KEY UPDATE content_generated = content_generated + 1
    `, [userId]);

    // Log activity
    await logActivity(userId, 'content_created', 'content', contentId, { title, content_type }, req);

    res.status(201).json({
      success: true,
      message: 'Content created successfully',
      data: { id: contentId }
    });

  } catch (error) {
    console.error('Create content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create content'
    });
  }
});

// Update content
router.put('/:id', authenticateToken, validate(contentSchemas.updateContent), async (req, res) => {
  try {
    const contentId = req.params.id;
    const userId = req.user.id;
    const updates = req.body;

    // Check if content exists and belongs to user
    const [existing] = await promisePool.execute(
      'SELECT title, content FROM content_items WHERE id = ? AND user_id = ?',
      [contentId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Build update query
    const updateFields = [];
    const params = [];

    Object.keys(updates).forEach(key => {
      if (['title', 'content', 'status', 'is_favorite', 'category', 'tone', 'target_audience'].includes(key)) {
        updateFields.push(`${key} = ?`);
        params.push(updates[key]);
      } else if (key === 'keywords') {
        updateFields.push('keywords = ?');
        params.push(JSON.stringify(updates[key]));
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    // Update word count if content is being updated
    if (updates.content) {
      const wordCount = updates.content.split(/\s+/).filter(word => word.length > 0).length;
      updateFields.push('word_count = ?');
      params.push(wordCount);
    }

    updateFields.push('updated_at = NOW()');
    params.push(contentId, userId);

    await promisePool.execute(`
      UPDATE content_items 
      SET ${updateFields.join(', ')} 
      WHERE id = ? AND user_id = ?
    `, params);

    // Create new version if content or title changed
    if (updates.content || updates.title) {
      // Get current version number
      const [versions] = await promisePool.execute(
        'SELECT MAX(version_number) as max_version FROM content_versions WHERE content_item_id = ?',
        [contentId]
      );

      const newVersionNumber = (versions[0].max_version || 0) + 1;
      const changesSummary = [];
      
      if (updates.title && updates.title !== existing[0].title) {
        changesSummary.push('Title updated');
      }
      if (updates.content && updates.content !== existing[0].content) {
        changesSummary.push('Content updated');
      }

      await promisePool.execute(`
        INSERT INTO content_versions (content_item_id, version_number, title, content, changes_summary, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        contentId, 
        newVersionNumber, 
        updates.title || existing[0].title,
        updates.content || existing[0].content,
        changesSummary.join(', '),
        userId
      ]);
    }

    // Log activity
    await logActivity(userId, 'content_updated', 'content', contentId, { fields: Object.keys(updates) }, req);

    res.json({
      success: true,
      message: 'Content updated successfully'
    });

  } catch (error) {
    console.error('Update content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update content'
    });
  }
});

// Delete content
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const contentId = req.params.id;
    const userId = req.user.id;

    // Check if content exists and belongs to user
    const [existing] = await promisePool.execute(
      'SELECT title FROM content_items WHERE id = ? AND user_id = ?',
      [contentId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Soft delete by setting status to archived
    await promisePool.execute(
      'UPDATE content_items SET status = "archived", updated_at = NOW() WHERE id = ? AND user_id = ?',
      [contentId, userId]
    );

    // Log activity
    await logActivity(userId, 'content_deleted', 'content', contentId, { title: existing[0].title }, req);

    res.json({
      success: true,
      message: 'Content deleted successfully'
    });

  } catch (error) {
    console.error('Delete content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete content'
    });
  }
});

// Toggle favorite status
router.patch('/:id/favorite', authenticateToken, async (req, res) => {
  try {
    const contentId = req.params.id;
    const userId = req.user.id;

    // Check if content exists and belongs to user
    const [existing] = await promisePool.execute(
      'SELECT is_favorite FROM content_items WHERE id = ? AND user_id = ?',
      [contentId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    const newFavoriteStatus = !existing[0].is_favorite;

    await promisePool.execute(
      'UPDATE content_items SET is_favorite = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
      [newFavoriteStatus, contentId, userId]
    );

    // Log activity
    await logActivity(
      userId, 
      newFavoriteStatus ? 'content_favorited' : 'content_unfavorited', 
      'content', 
      contentId, 
      null, 
      req
    );

    res.json({
      success: true,
      message: `Content ${newFavoriteStatus ? 'added to' : 'removed from'} favorites`,
      data: { is_favorite: newFavoriteStatus }
    });

  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle favorite status'
    });
  }
});

// Duplicate content
router.post('/:id/duplicate', authenticateToken, async (req, res) => {
  try {
    const contentId = req.params.id;
    const userId = req.user.id;
    const { title_suffix = ' (Copy)' } = req.body;

    // Get original content
    const [original] = await promisePool.execute(`
      SELECT title, content_type, category, content, tone, target_audience, 
             keywords, project_id, brand_style_id, prompt_template_id, word_count
      FROM content_items 
      WHERE id = ? AND user_id = ?
    `, [contentId, userId]);

    if (original.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    const orig = original[0];
    const newTitle = orig.title + title_suffix;

    // Create duplicate
    const [result] = await promisePool.execute(`
      INSERT INTO content_items (
        user_id, title, content_type, category, content, word_count,
        tone, target_audience, keywords, project_id, brand_style_id, 
        prompt_template_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NOW())
    `, [
      userId, newTitle, orig.content_type, orig.category, orig.content, orig.word_count,
      orig.tone, orig.target_audience, orig.keywords, orig.project_id, 
      orig.brand_style_id, orig.prompt_template_id
    ]);

    const newContentId = result.insertId;

    // Create initial version for duplicate
    await promisePool.execute(`
      INSERT INTO content_versions (content_item_id, version_number, title, content, changes_summary, created_by)
      VALUES (?, 1, ?, ?, 'Duplicated from original', ?)
    `, [newContentId, newTitle, orig.content, userId]);

    // Log activity
    await logActivity(userId, 'content_duplicated', 'content', newContentId, { 
      original_id: contentId, 
      original_title: orig.title 
    }, req);

    res.status(201).json({
      success: true,
      message: 'Content duplicated successfully',
      data: { id: newContentId, title: newTitle }
    });

  } catch (error) {
    console.error('Duplicate content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to duplicate content'
    });
  }
});

// Add comment to content
router.post('/:id/comments', authenticateToken, async (req, res) => {
  try {
    const contentId = req.params.id;
    const userId = req.user.id;
    const { comment_text } = req.body;

    if (!comment_text || comment_text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment text is required'
      });
    }

    // Check if content exists and user has access
    const [content] = await promisePool.execute(
      'SELECT id FROM content_items WHERE id = ? AND user_id = ?',
      [contentId, userId]
    );

    if (content.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Add comment
    const [result] = await promisePool.execute(`
      INSERT INTO comments (content_item_id, user_id, comment_text, created_at)
      VALUES (?, ?, ?, NOW())
    `, [contentId, userId, comment_text.trim()]);

    // Log activity
    await logActivity(userId, 'comment_added', 'content', contentId, { comment_id: result.insertId }, req);

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: { id: result.insertId }
    });

  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment'
    });
  }
});

module.exports = router;