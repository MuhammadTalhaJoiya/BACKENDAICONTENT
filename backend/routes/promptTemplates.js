const express = require('express');
const { promisePool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { validate, promptTemplateSchemas } = require('../middleware/validation');
const { logActivity } = require('../middleware/logger');

const router = express.Router();

// Get all prompt templates for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { category, content_type, is_public } = req.query;

    let whereClause = 'WHERE (pt.user_id = ? OR pt.is_public = TRUE)';
    let params = [userId];

    if (category) {
      whereClause += ' AND pt.category = ?';
      params.push(category);
    }

    if (content_type) {
      whereClause += ' AND pt.content_type = ?';
      params.push(content_type);
    }

    if (is_public !== undefined) {
      whereClause += ' AND pt.is_public = ?';
      params.push(is_public === 'true');
    }

    const [templates] = await promisePool.execute(`
      SELECT 
        pt.*,
        u.first_name,
        u.last_name,
        COUNT(ci.id) as usage_count
      FROM prompt_templates pt
      LEFT JOIN users u ON pt.user_id = u.id
      LEFT JOIN content_items ci ON pt.id = ci.prompt_template_id
      ${whereClause}
      GROUP BY pt.id
      ORDER BY pt.usage_count DESC, pt.created_at DESC
    `, params);

    res.json({
      success: true,
      data: {
        templates: templates.map(t => ({
          ...t,
          variables: t.variables ? JSON.parse(t.variables) : [],
          author: `${t.first_name} ${t.last_name}`,
          is_owner: t.user_id === userId
        }))
      }
    });

  } catch (error) {
    console.error('Get prompt templates error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get prompt templates'
    });
  }
});

// Get single prompt template
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const templateId = req.params.id;
    const userId = req.user.id;

    const [templates] = await promisePool.execute(`
      SELECT 
        pt.*,
        u.first_name,
        u.last_name
      FROM prompt_templates pt
      LEFT JOIN users u ON pt.user_id = u.id
      WHERE pt.id = ? AND (pt.user_id = ? OR pt.is_public = TRUE)
    `, [templateId, userId]);

    if (templates.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Prompt template not found'
      });
    }

    const template = templates[0];

    // Get usage statistics
    const [usage] = await promisePool.execute(`
      SELECT COUNT(*) as total_usage
      FROM content_items
      WHERE prompt_template_id = ?
    `, [templateId]);

    res.json({
      success: true,
      data: {
        template: {
          ...template,
          variables: template.variables ? JSON.parse(template.variables) : [],
          author: `${template.first_name} ${template.last_name}`,
          is_owner: template.user_id === userId,
          total_usage: usage[0].total_usage
        }
      }
    });

  } catch (error) {
    console.error('Get prompt template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get prompt template'
    });
  }
});

// Create new prompt template
router.post('/', authenticateToken, validate(promptTemplateSchemas.createPromptTemplate), async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      name,
      description,
      category,
      content_type,
      tone,
      prompt_text,
      variables,
      is_public
    } = req.body;

    const [result] = await promisePool.execute(`
      INSERT INTO prompt_templates (
        user_id, name, description, category, content_type, tone,
        prompt_text, variables, is_public, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      userId, name, description, category, content_type, tone,
      prompt_text, JSON.stringify(variables || []), is_public || false
    ]);

    const templateId = result.insertId;

    // Log activity
    await logActivity(userId, 'prompt_template_created', 'prompt_template', templateId, { name, category }, req);

    res.status(201).json({
      success: true,
      message: 'Prompt template created successfully',
      data: { id: templateId }
    });

  } catch (error) {
    console.error('Create prompt template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create prompt template'
    });
  }
});

// Update prompt template
router.put('/:id', authenticateToken, validate(promptTemplateSchemas.updatePromptTemplate), async (req, res) => {
  try {
    const templateId = req.params.id;
    const userId = req.user.id;
    const updates = req.body;

    // Check if template exists and belongs to user
    const [existing] = await promisePool.execute(
      'SELECT name FROM prompt_templates WHERE id = ? AND user_id = ?',
      [templateId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Prompt template not found or access denied'
      });
    }

    // Build update query
    const updateFields = [];
    const params = [];

    Object.keys(updates).forEach(key => {
      if (['name', 'description', 'category', 'content_type', 'tone', 'prompt_text', 'is_public'].includes(key)) {
        updateFields.push(`${key} = ?`);
        params.push(updates[key]);
      } else if (key === 'variables') {
        updateFields.push('variables = ?');
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
    params.push(templateId, userId);

    await promisePool.execute(`
      UPDATE prompt_templates 
      SET ${updateFields.join(', ')} 
      WHERE id = ? AND user_id = ?
    `, params);

    // Log activity
    await logActivity(userId, 'prompt_template_updated', 'prompt_template', templateId, { fields: Object.keys(updates) }, req);

    res.json({
      success: true,
      message: 'Prompt template updated successfully'
    });

  } catch (error) {
    console.error('Update prompt template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update prompt template'
    });
  }
});

// Delete prompt template
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const templateId = req.params.id;
    const userId = req.user.id;

    // Check if template exists and belongs to user
    const [existing] = await promisePool.execute(
      'SELECT name FROM prompt_templates WHERE id = ? AND user_id = ?',
      [templateId, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Prompt template not found or access denied'
      });
    }

    // Check if template is being used
    const [usage] = await promisePool.execute(
      'SELECT COUNT(*) as usage_count FROM content_items WHERE prompt_template_id = ?',
      [templateId]
    );

    if (usage[0].usage_count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete prompt template that is being used by content items'
      });
    }

    // Delete template
    await promisePool.execute(
      'DELETE FROM prompt_templates WHERE id = ? AND user_id = ?',
      [templateId, userId]
    );

    // Log activity
    await logActivity(userId, 'prompt_template_deleted', 'prompt_template', templateId, { name: existing[0].name }, req);

    res.json({
      success: true,
      message: 'Prompt template deleted successfully'
    });

  } catch (error) {
    console.error('Delete prompt template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete prompt template'
    });
  }
});

// Duplicate prompt template
router.post('/:id/duplicate', authenticateToken, async (req, res) => {
  try {
    const templateId = req.params.id;
    const userId = req.user.id;
    const { name_suffix = ' (Copy)' } = req.body;

    // Get original template
    const [original] = await promisePool.execute(`
      SELECT name, description, category, content_type, tone, prompt_text, variables
      FROM prompt_templates 
      WHERE id = ? AND (user_id = ? OR is_public = TRUE)
    `, [templateId, userId]);

    if (original.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Prompt template not found'
      });
    }

    const orig = original[0];
    const newName = orig.name + name_suffix;

    // Create duplicate
    const [result] = await promisePool.execute(`
      INSERT INTO prompt_templates (
        user_id, name, description, category, content_type, tone,
        prompt_text, variables, is_public, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE, NOW())
    `, [
      userId, newName, orig.description, orig.category, orig.content_type,
      orig.tone, orig.prompt_text, orig.variables
    ]);

    const newTemplateId = result.insertId;

    // Log activity
    await logActivity(userId, 'prompt_template_duplicated', 'prompt_template', newTemplateId, {
      original_id: templateId,
      original_name: orig.name
    }, req);

    res.status(201).json({
      success: true,
      message: 'Prompt template duplicated successfully',
      data: { id: newTemplateId, name: newName }
    });

  } catch (error) {
    console.error('Duplicate prompt template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to duplicate prompt template'
    });
  }
});

// Test prompt template
router.post('/:id/test', authenticateToken, async (req, res) => {
  try {
    const templateId = req.params.id;
    const userId = req.user.id;
    const { variables: testVariables } = req.body;

    // Get template
    const [templates] = await promisePool.execute(`
      SELECT prompt_text, variables
      FROM prompt_templates 
      WHERE id = ? AND (user_id = ? OR is_public = TRUE)
    `, [templateId, userId]);

    if (templates.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Prompt template not found'
      });
    }

    const template = templates[0];
    let processedPrompt = template.prompt_text;
    const templateVariables = template.variables ? JSON.parse(template.variables) : [];

    // Replace variables in prompt
    if (testVariables && typeof testVariables === 'object') {
      templateVariables.forEach(variable => {
        const variableName = variable.replace(/[{}]/g, '');
        if (testVariables[variableName]) {
          const regex = new RegExp(variable.replace(/[{}]/g, '\\{\\}'), 'g');
          processedPrompt = processedPrompt.replace(regex, testVariables[variableName]);
        }
      });
    }

    // Log activity
    await logActivity(userId, 'prompt_template_tested', 'prompt_template', templateId, null, req);

    res.json({
      success: true,
      data: {
        processed_prompt: processedPrompt,
        variables_used: templateVariables,
        test_variables: testVariables
      }
    });

  } catch (error) {
    console.error('Test prompt template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test prompt template'
    });
  }
});

// Get template categories
router.get('/meta/categories', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [categories] = await promisePool.execute(`
      SELECT DISTINCT category, COUNT(*) as count
      FROM prompt_templates
      WHERE (user_id = ? OR is_public = TRUE) AND category IS NOT NULL
      GROUP BY category
      ORDER BY count DESC, category ASC
    `, [userId]);

    res.json({
      success: true,
      data: { categories }
    });

  } catch (error) {
    console.error('Get template categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get template categories'
    });
  }
});

module.exports = router;