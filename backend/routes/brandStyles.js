const express = require('express');
const { promisePool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { validate, brandStyleSchemas } = require('../middleware/validation');
const { logActivity } = require('../middleware/logger');

const router = express.Router();

// Get all brand styles for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [brandStyles] = await promisePool.execute(`
      SELECT 
        bs.*,
        u.first_name,
        u.last_name,
        COUNT(p.id) as projects_count,
        COUNT(ci.id) as content_count
      FROM brand_styles bs
      LEFT JOIN users u ON bs.user_id = u.id
      LEFT JOIN projects p ON bs.id = p.brand_style_id
      LEFT JOIN content_items ci ON bs.id = ci.brand_style_id
      WHERE bs.user_id = ?
      GROUP BY bs.id
      ORDER BY bs.is_default DESC, bs.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      data: {
        brand_styles: brandStyles.map(bs => ({
          ...bs,
          key_messages: bs.key_messages ? JSON.parse(bs.key_messages) : [],
          color_palette: bs.color_palette ? JSON.parse(bs.color_palette) : {},
          typography: bs.typography ? JSON.parse(bs.typography) : {},
          author: `${bs.first_name} ${bs.last_name}`
        }))
      }
    });

  } catch (error) {
    console.error('Get brand styles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get brand styles'
    });
  }
});

// Get single brand style
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const brandStyleId = req.params.id;
    const userId = req.user.id;

    const [brandStyles] = await promisePool.execute(`
      SELECT 
        bs.*,
        u.first_name,
        u.last_name
      FROM brand_styles bs
      LEFT JOIN users u ON bs.user_id = u.id
      WHERE bs.id = ? AND bs.user_id = ?
    `, [brandStyleId, userId]);

    if (brandStyles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Brand style not found'
      });
    }

    const brandStyle = brandStyles[0];

    // Get usage statistics
    const [usage] = await promisePool.execute(`
      SELECT 
        COUNT(DISTINCT p.id) as projects_using,
        COUNT(DISTINCT ci.id) as content_using
      FROM brand_styles bs
      LEFT JOIN projects p ON bs.id = p.brand_style_id
      LEFT JOIN content_items ci ON bs.id = ci.brand_style_id
      WHERE bs.id = ?
    `, [brandStyleId]);

    res.json({
      success: true,
      data: {
        brand_style: {
          ...brandStyle,
          key_messages: brandStyle.key_messages ? JSON.parse(brandStyle.key_messages) : [],
          color_palette: brandStyle.color_palette ? JSON.parse(brandStyle.color_palette) : {},
          typography: brandStyle.typography ? JSON.parse(brandStyle.typography) : {},
          author: `${brandStyle.first_name} ${brandStyle.last_name}`,
          usage: usage[0]
        }
      }
    });

  } catch (error) {
    console.error('Get brand style error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get brand style'
    });
  }
});

// Create new brand style
router.post('/', authenticateToken, validate(brandStyleSchemas.createBrandStyle), async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      name,
      description,
      voice_type,
      personality,
      key_messages,
      color_palette,
      typography,
      guidelines,
      is_default
    } = req.body;

    // If this is set as default, unset other defaults
    if (is_default) {
      await promisePool.execute(
        'UPDATE brand_styles SET is_default = FALSE WHERE user_id = ?',
        [userId]
      );
    }

    const [result] = await promisePool.execute(`
      INSERT INTO brand_styles (
        user_id, name, description, voice_type, personality, 
        key_messages, color_palette, typography, guidelines, is_default, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      userId, name, description, voice_type, personality,
      JSON.stringify(key_messages || []),
      JSON.stringify(color_palette || {}),
      JSON.stringify(typography || {}),
      guidelines,
      is_default || false
    ]);

    const brandStyleId = result.insertId;

    // Log activity
    await logActivity(userId, 'brand_style_created', 'brand_style', brandStyleId, { name, voice_type }, req);

    res.status(201).json({
      success: true,
      message: 'Brand style created successfully',
      data: { id: brandStyleId }
    });

  } catch (error) {
    console.error('Create brand style error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create brand style'
    });
  }
});

// Update brand style
router.put('/:id', authenticateToken, validate(brandStyleSchemas.updateBrandStyle), async (req, res) => {
  try {
    const brandStyleId = req.params.id;
    const userId = req.user.id;
    const updates = req.body;

    // Check if brand style exists and belongs to user
    const [existing] = await promisePool.execute(
      'SELECT name FROM brand_styles WHERE id = ? AND user_id = ?',
      [brandStyleId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Brand style not found'
      });
    }

    // If this is set as default, unset other defaults
    if (updates.is_default === true) {
      await promisePool.execute(
        'UPDATE brand_styles SET is_default = FALSE WHERE user_id = ? AND id != ?',
        [userId, brandStyleId]
      );
    }

    // Build update query
    const updateFields = [];
    const params = [];

    Object.keys(updates).forEach(key => {
      if (['name', 'description', 'voice_type', 'personality', 'guidelines', 'is_default'].includes(key)) {
        updateFields.push(`${key} = ?`);
        params.push(updates[key]);
      } else if (['key_messages', 'color_palette', 'typography'].includes(key)) {
        updateFields.push(`${key} = ?`);
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
    params.push(brandStyleId, userId);

    await promisePool.execute(`
      UPDATE brand_styles 
      SET ${updateFields.join(', ')} 
      WHERE id = ? AND user_id = ?
    `, params);

    // Log activity
    await logActivity(userId, 'brand_style_updated', 'brand_style', brandStyleId, { fields: Object.keys(updates) }, req);

    res.json({
      success: true,
      message: 'Brand style updated successfully'
    });

  } catch (error) {
    console.error('Update brand style error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update brand style'
    });
  }
});

// Delete brand style
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const brandStyleId = req.params.id;
    const userId = req.user.id;

    // Check if brand style exists and belongs to user
    const [existing] = await promisePool.execute(
      'SELECT name, is_default FROM brand_styles WHERE id = ? AND user_id = ?',
      [brandStyleId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Brand style not found'
      });
    }

    // Check if brand style is being used
    const [usage] = await promisePool.execute(`
      SELECT 
        COUNT(DISTINCT p.id) as projects_using,
        COUNT(DISTINCT ci.id) as content_using
      FROM brand_styles bs
      LEFT JOIN projects p ON bs.id = p.brand_style_id
      LEFT JOIN content_items ci ON bs.id = ci.brand_style_id
      WHERE bs.id = ?
    `, [brandStyleId]);

    if (usage[0].projects_using > 0 || usage[0].content_using > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete brand style that is being used by projects or content'
      });
    }

    // Delete brand style
    await promisePool.execute(
      'DELETE FROM brand_styles WHERE id = ? AND user_id = ?',
      [brandStyleId, userId]
    );

    // Log activity
    await logActivity(userId, 'brand_style_deleted', 'brand_style', brandStyleId, { name: existing[0].name }, req);

    res.json({
      success: true,
      message: 'Brand style deleted successfully'
    });

  } catch (error) {
    console.error('Delete brand style error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete brand style'
    });
  }
});

// Set as default brand style
router.patch('/:id/set-default', authenticateToken, async (req, res) => {
  try {
    const brandStyleId = req.params.id;
    const userId = req.user.id;

    // Check if brand style exists and belongs to user
    const [existing] = await promisePool.execute(
      'SELECT name FROM brand_styles WHERE id = ? AND user_id = ?',
      [brandStyleId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Brand style not found'
      });
    }

    // Unset all other defaults
    await promisePool.execute(
      'UPDATE brand_styles SET is_default = FALSE WHERE user_id = ?',
      [userId]
    );

    // Set this one as default
    await promisePool.execute(
      'UPDATE brand_styles SET is_default = TRUE, updated_at = NOW() WHERE id = ? AND user_id = ?',
      [brandStyleId, userId]
    );

    // Log activity
    await logActivity(userId, 'brand_style_set_default', 'brand_style', brandStyleId, { name: existing[0].name }, req);

    res.json({
      success: true,
      message: 'Brand style set as default successfully'
    });

  } catch (error) {
    console.error('Set default brand style error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set default brand style'
    });
  }
});

module.exports = router;