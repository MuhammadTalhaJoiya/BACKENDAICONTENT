const express = require('express');
const { promisePool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { logActivity } = require('../middleware/logger');

const router = express.Router();

// Get SEO optimization for content
router.get('/content/:id', authenticateToken, async (req, res) => {
  try {
    const contentId = req.params.id;
    const userId = req.user.id;

    // Check if content exists and belongs to user
    const [content] = await promisePool.execute(`
      SELECT title, content, keywords FROM content_items
      WHERE id = ? AND user_id = ?
    `, [contentId, userId]);

    if (content.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Get existing SEO optimization
    const [seoData] = await promisePool.execute(`
      SELECT * FROM seo_optimizations WHERE content_item_id = ?
    `, [contentId]);

    res.json({
      success: true,
      data: {
        content: content[0],
        seo: seoData.length > 0 ? {
          ...seoData[0],
          keywords: seoData[0].keywords ? JSON.parse(seoData[0].keywords) : [],
          optimization_suggestions: seoData[0].optimization_suggestions ? JSON.parse(seoData[0].optimization_suggestions) : []
        } : null
      }
    });

  } catch (error) {
    console.error('Get SEO data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get SEO data'
    });
  }
});

// Analyze content for SEO
router.post('/analyze/:id', authenticateToken, async (req, res) => {
  try {
    const contentId = req.params.id;
    const userId = req.user.id;
    const { focus_keyword } = req.body;

    // Check if content exists and belongs to user
    const [content] = await promisePool.execute(`
      SELECT title, content, keywords FROM content_items
      WHERE id = ? AND user_id = ?
    `, [contentId, userId]);

    if (content.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    const contentItem = content[0];
    const contentText = contentItem.content || '';
    const title = contentItem.title || '';
    const keywords = contentItem.keywords ? JSON.parse(contentItem.keywords) : [];

    // Simple SEO analysis
    const seoAnalysis = {
      focus_keyword: focus_keyword,
      score: 0,
      suggestions: []
    };

    // Check title length
    if (title.length < 30) {
      seoAnalysis.suggestions.push({
        type: 'title',
        issue: 'Title too short',
        suggestion: 'Consider making your title at least 30 characters long'
      });
    } else if (title.length > 60) {
      seoAnalysis.suggestions.push({
        type: 'title',
        issue: 'Title too long',
        suggestion: 'Consider shortening your title to under 60 characters'
      });
    } else {
      seoAnalysis.score += 20;
    }

    // Check focus keyword in title
    if (focus_keyword && title.toLowerCase().includes(focus_keyword.toLowerCase())) {
      seoAnalysis.score += 25;
    } else if (focus_keyword) {
      seoAnalysis.suggestions.push({
        type: 'title',
        issue: 'Focus keyword not in title',
        suggestion: `Consider including your focus keyword "${focus_keyword}" in the title`
      });
    }

    // Check content length
    const wordCount = contentText.split(/\s+/).filter(word => word.length > 0).length;
    if (wordCount < 300) {
      seoAnalysis.suggestions.push({
        type: 'content',
        issue: 'Content too short',
        suggestion: 'Consider writing at least 300 words for better SEO'
      });
    } else {
      seoAnalysis.score += 25;
    }

    // Check focus keyword density in content
    if (focus_keyword && contentText) {
      const keywordMatches = (contentText.toLowerCase().match(new RegExp(focus_keyword.toLowerCase(), 'g')) || []).length;
      const density = (keywordMatches / wordCount) * 100;
      
      if (density < 0.5) {
        seoAnalysis.suggestions.push({
          type: 'keyword',
          issue: 'Low keyword density',
          suggestion: `Consider using your focus keyword "${focus_keyword}" more frequently (current: ${density.toFixed(2)}%)`
        });
      } else if (density > 3) {
        seoAnalysis.suggestions.push({
          type: 'keyword',
          issue: 'High keyword density',
          suggestion: `Reduce the use of "${focus_keyword}" to avoid keyword stuffing (current: ${density.toFixed(2)}%)`
        });
      } else {
        seoAnalysis.score += 25;
      }
    }

    // Check for keywords
    if (keywords.length === 0) {
      seoAnalysis.suggestions.push({
        type: 'keywords',
        issue: 'No keywords defined',
        suggestion: 'Add relevant keywords to improve content discoverability'
      });
    } else {
      seoAnalysis.score += 5;
    }

    // Generate meta description suggestion
    const metaDescription = contentText.substring(0, 155).trim() + (contentText.length > 155 ? '...' : '');
    
    // Generate URL slug suggestion
    const slug = title.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();

    // Save or update SEO optimization
    await promisePool.execute(`
      INSERT INTO seo_optimizations (
        content_item_id, focus_keyword, meta_title, meta_description, 
        slug, keywords, optimization_suggestions, score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
      focus_keyword = VALUES(focus_keyword),
      meta_title = VALUES(meta_title),
      meta_description = VALUES(meta_description),
      slug = VALUES(slug),
      keywords = VALUES(keywords),
      optimization_suggestions = VALUES(optimization_suggestions),
      score = VALUES(score),
      updated_at = NOW()
    `, [
      contentId,
      focus_keyword,
      title,
      metaDescription,
      slug,
      JSON.stringify(keywords),
      JSON.stringify(seoAnalysis.suggestions),
      seoAnalysis.score
    ]);

    // Update content item with SEO score
    await promisePool.execute(
      'UPDATE content_items SET seo_score = ? WHERE id = ?',
      [seoAnalysis.score, contentId]
    );

    // Log activity
    await logActivity(userId, 'seo_analyzed', 'content', contentId, { focus_keyword, score: seoAnalysis.score }, req);

    res.json({
      success: true,
      data: {
        analysis: seoAnalysis,
        meta_description: metaDescription,
        suggested_slug: slug,
        score: seoAnalysis.score
      }
    });

  } catch (error) {
    console.error('SEO analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze content for SEO'
    });
  }
});

// Update SEO optimization
router.put('/content/:id', authenticateToken, async (req, res) => {
  try {
    const contentId = req.params.id;
    const userId = req.user.id;
    const {
      focus_keyword,
      meta_title,
      meta_description,
      slug,
      keywords
    } = req.body;

    // Check if content exists and belongs to user
    const [content] = await promisePool.execute(`
      SELECT id FROM content_items WHERE id = ? AND user_id = ?
    `, [contentId, userId]);

    if (content.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Update SEO optimization
    await promisePool.execute(`
      INSERT INTO seo_optimizations (
        content_item_id, focus_keyword, meta_title, meta_description, 
        slug, keywords, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
      focus_keyword = VALUES(focus_keyword),
      meta_title = VALUES(meta_title),
      meta_description = VALUES(meta_description),
      slug = VALUES(slug),
      keywords = VALUES(keywords),
      updated_at = NOW()
    `, [
      contentId,
      focus_keyword,
      meta_title,
      meta_description,
      slug,
      JSON.stringify(keywords || [])
    ]);

    // Log activity
    await logActivity(userId, 'seo_updated', 'content', contentId, { focus_keyword }, req);

    res.json({
      success: true,
      message: 'SEO optimization updated successfully'
    });

  } catch (error) {
    console.error('Update SEO error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update SEO optimization'
    });
  }
});

// Get keyword suggestions
router.post('/keywords/suggest', authenticateToken, async (req, res) => {
  try {
    const { topic, content } = req.body;

    if (!topic && !content) {
      return res.status(400).json({
        success: false,
        message: 'Topic or content is required'
      });
    }

    // Simple keyword extraction (in real app, you'd use a proper NLP service)
    const text = (topic + ' ' + (content || '')).toLowerCase();
    const words = text.match(/\b\w{4,}\b/g) || [];
    
    // Count word frequency
    const wordCount = {};
    words.forEach(word => {
      if (!['with', 'that', 'this', 'from', 'they', 'have', 'will', 'been', 'were', 'said', 'each', 'which', 'their', 'time', 'would', 'could', 'should'].includes(word)) {
        wordCount[word] = (wordCount[word] || 0) + 1;
      }
    });

    // Get top keywords
    const suggestions = Object.entries(wordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 15)
      .map(([word, count]) => ({
        keyword: word,
        frequency: count,
        relevance: Math.min(count * 10, 100) // Simple relevance score
      }));

    res.json({
      success: true,
      data: { suggestions }
    });

  } catch (error) {
    console.error('Keyword suggestions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate keyword suggestions'
    });
  }
});

// Get readability analysis
router.post('/readability', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required'
      });
    }

    // Simple readability analysis
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = content.split(/\s+/).filter(w => w.length > 0);
    const syllables = words.reduce((total, word) => {
      // Simple syllable counting
      return total + Math.max(1, word.toLowerCase().match(/[aeiouy]+/g)?.length || 1);
    }, 0);

    const avgWordsPerSentence = words.length / sentences.length;
    const avgSyllablesPerWord = syllables / words.length;

    // Simple Flesch Reading Ease approximation
    const fleschScore = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
    
    let readabilityLevel;
    if (fleschScore >= 90) readabilityLevel = 'Very Easy';
    else if (fleschScore >= 80) readabilityLevel = 'Easy';
    else if (fleschScore >= 70) readabilityLevel = 'Fairly Easy';
    else if (fleschScore >= 60) readabilityLevel = 'Standard';
    else if (fleschScore >= 50) readabilityLevel = 'Fairly Difficult';
    else if (fleschScore >= 30) readabilityLevel = 'Difficult';
    else readabilityLevel = 'Very Difficult';

    const analysis = {
      flesch_score: Math.round(fleschScore),
      readability_level: readabilityLevel,
      word_count: words.length,
      sentence_count: sentences.length,
      avg_words_per_sentence: Math.round(avgWordsPerSentence * 10) / 10,
      avg_syllables_per_word: Math.round(avgSyllablesPerWord * 10) / 10,
      suggestions: []
    };

    // Add suggestions
    if (avgWordsPerSentence > 20) {
      analysis.suggestions.push('Consider using shorter sentences (average: ' + Math.round(avgWordsPerSentence) + ' words)');
    }
    
    if (fleschScore < 60) {
      analysis.suggestions.push('Consider using simpler words and shorter sentences to improve readability');
    }

    res.json({
      success: true,
      data: { analysis }
    });

  } catch (error) {
    console.error('Readability analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze readability'
    });
  }
});

module.exports = router;