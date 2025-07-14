const express = require('express');
const { promisePool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { upload, processImage } = require('../middleware/upload');
const { logActivity } = require('../middleware/logger');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Upload media file
router.post('/upload', authenticateToken, upload.single('file'), processImage, async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { category = 'general', alt_text } = req.body;
    const fileUrl = `/uploads/content/${req.file.filename}`;

    // Save file info to database (optional - for media management)
    const [result] = await promisePool.execute(`
      INSERT INTO content_items (
        user_id, title, content_type, category, file_url, file_type, 
        file_size, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', NOW())
    `, [
      userId,
      req.file.originalname,
      req.file.mimetype.startsWith('image/') ? 'image' : 
      req.file.mimetype.startsWith('video/') ? 'video' : 
      req.file.mimetype.startsWith('audio/') ? 'audio' : 'file',
      category,
      fileUrl,
      req.file.mimetype,
      req.file.size
    ]);

    // Log activity
    await logActivity(userId, 'media_uploaded', 'content', result.insertId, {
      filename: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size
    }, req);

    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        id: result.insertId,
        url: fileUrl,
        filename: req.file.filename,
        original_name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size
      }
    });

  } catch (error) {
    console.error('Upload media error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file'
    });
  }
});

// Get media files
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      page = 1, 
      limit = 20, 
      type, 
      category,
      search 
    } = req.query;

    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE ci.user_id = ? AND ci.file_url IS NOT NULL AND ci.status != "archived"';
    let params = [userId];

    if (type) {
      whereClause += ' AND ci.content_type = ?';
      params.push(type);
    }

    if (category) {
      whereClause += ' AND ci.category = ?';
      params.push(category);
    }

    if (search) {
      whereClause += ' AND ci.title LIKE ?';
      params.push(`%${search}%`);
    }

    const [media] = await promisePool.execute(`
      SELECT 
        ci.id,
        ci.title,
        ci.content_type,
        ci.category,
        ci.file_url,
        ci.file_type,
        ci.file_size,
        ci.created_at,
        ci.updated_at,
        u.first_name,
        u.last_name
      FROM content_items ci
      LEFT JOIN users u ON ci.user_id = u.id
      ${whereClause}
      ORDER BY ci.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), parseInt(offset)]);

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
        media: media.map(item => ({
          ...item,
          author: `${item.first_name} ${item.last_name}`,
          size_formatted: formatFileSize(item.file_size)
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
    console.error('Get media error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get media files'
    });
  }
});

// Get single media file
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const mediaId = req.params.id;
    const userId = req.user.id;

    const [media] = await promisePool.execute(`
      SELECT 
        ci.*,
        u.first_name,
        u.last_name
      FROM content_items ci
      LEFT JOIN users u ON ci.user_id = u.id
      WHERE ci.id = ? AND ci.user_id = ? AND ci.file_url IS NOT NULL
    `, [mediaId, userId]);

    if (media.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Media file not found'
      });
    }

    const mediaItem = media[0];

    res.json({
      success: true,
      data: {
        media: {
          ...mediaItem,
          author: `${mediaItem.first_name} ${mediaItem.last_name}`,
          size_formatted: formatFileSize(mediaItem.file_size),
          metadata: mediaItem.metadata ? JSON.parse(mediaItem.metadata) : {}
        }
      }
    });

  } catch (error) {
    console.error('Get media item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get media file'
    });
  }
});

// Update media metadata
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const mediaId = req.params.id;
    const userId = req.user.id;
    const { title, category, alt_text, description } = req.body;

    // Check if media exists and belongs to user
    const [existing] = await promisePool.execute(
      'SELECT title FROM content_items WHERE id = ? AND user_id = ? AND file_url IS NOT NULL',
      [mediaId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Media file not found'
      });
    }

    // Update metadata
    const metadata = {};
    if (alt_text) metadata.alt_text = alt_text;
    if (description) metadata.description = description;

    await promisePool.execute(`
      UPDATE content_items 
      SET title = ?, category = ?, metadata = ?, updated_at = NOW()
      WHERE id = ? AND user_id = ?
    `, [title, category, JSON.stringify(metadata), mediaId, userId]);

    // Log activity
    await logActivity(userId, 'media_updated', 'content', mediaId, { title }, req);

    res.json({
      success: true,
      message: 'Media metadata updated successfully'
    });

  } catch (error) {
    console.error('Update media error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update media metadata'
    });
  }
});

// Delete media file
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const mediaId = req.params.id;
    const userId = req.user.id;

    // Get media file info
    const [media] = await promisePool.execute(
      'SELECT title, file_url FROM content_items WHERE id = ? AND user_id = ? AND file_url IS NOT NULL',
      [mediaId, userId]
    );

    if (media.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Media file not found'
      });
    }

    const mediaItem = media[0];

    // Delete physical file
    if (mediaItem.file_url) {
      const filePath = path.join(__dirname, '..', mediaItem.file_url);
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        // Ignore error if file doesn't exist
        console.warn('Could not delete file:', filePath);
      }
    }

    // Soft delete by setting status to archived
    await promisePool.execute(
      'UPDATE content_items SET status = "archived", updated_at = NOW() WHERE id = ? AND user_id = ?',
      [mediaId, userId]
    );

    // Log activity
    await logActivity(userId, 'media_deleted', 'content', mediaId, { title: mediaItem.title }, req);

    res.json({
      success: true,
      message: 'Media file deleted successfully'
    });

  } catch (error) {
    console.error('Delete media error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete media file'
    });
  }
});

// Get media usage statistics
router.get('/stats/usage', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [stats] = await promisePool.execute(`
      SELECT 
        content_type,
        COUNT(*) as file_count,
        SUM(file_size) as total_size,
        AVG(file_size) as avg_size
      FROM content_items
      WHERE user_id = ? AND file_url IS NOT NULL AND status != 'archived'
      GROUP BY content_type
      ORDER BY file_count DESC
    `, [userId]);

    // Get total statistics
    const [totals] = await promisePool.execute(`
      SELECT 
        COUNT(*) as total_files,
        SUM(file_size) as total_storage,
        MAX(file_size) as largest_file
      FROM content_items
      WHERE user_id = ? AND file_url IS NOT NULL AND status != 'archived'
    `, [userId]);

    res.json({
      success: true,
      data: {
        by_type: stats.map(stat => ({
          ...stat,
          total_size_formatted: formatFileSize(stat.total_size),
          avg_size_formatted: formatFileSize(stat.avg_size)
        })),
        totals: {
          ...totals[0],
          total_storage_formatted: formatFileSize(totals[0].total_storage),
          largest_file_formatted: formatFileSize(totals[0].largest_file)
        }
      }
    });

  } catch (error) {
    console.error('Get media stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get media statistics'
    });
  }
});

// Upload brand asset
router.post('/brand-asset', authenticateToken, upload.single('asset'), processImage, async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const assetUrl = `/uploads/brand-assets/${req.file.filename}`;

    // Log activity
    await logActivity(userId, 'brand_asset_uploaded', 'user', userId, {
      filename: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size
    }, req);

    res.json({
      success: true,
      message: 'Brand asset uploaded successfully',
      data: {
        url: assetUrl,
        filename: req.file.filename,
        original_name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size
      }
    });

  } catch (error) {
    console.error('Upload brand asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload brand asset'
    });
  }
});

// Helper function to format file sizes
function formatFileSize(bytes) {
  if (!bytes) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = router;