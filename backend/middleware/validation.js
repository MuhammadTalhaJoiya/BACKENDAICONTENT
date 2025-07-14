const Joi = require('joi');

const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }))
      });
    }
    next();
  };
};

// User validation schemas
const userSchemas = {
  register: Joi.object({
    first_name: Joi.string().min(2).max(100).required(),
    last_name: Joi.string().min(2).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    company: Joi.string().max(255).optional(),
    website: Joi.string().uri().optional()
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  updateProfile: Joi.object({
    first_name: Joi.string().min(2).max(100).optional(),
    last_name: Joi.string().min(2).max(100).optional(),
    bio: Joi.string().max(1000).optional(),
    company: Joi.string().max(255).optional(),
    website: Joi.string().uri().optional(),
    phone: Joi.string().max(20).optional(),
    timezone: Joi.string().max(50).optional(),
    language: Joi.string().max(10).optional()
  })
};

// Content validation schemas
const contentSchemas = {
  createContent: Joi.object({
    title: Joi.string().min(1).max(500).required(),
    content_type: Joi.string().valid(
      'blog_post', 'article', 'social_media', 'email', 
      'product_description', 'press_release', 'landing_page', 
      'ad_copy', 'image', 'video', 'audio'
    ).required(),
    category: Joi.string().max(100).optional(),
    content: Joi.string().optional(),
    tone: Joi.string().max(100).optional(),
    target_audience: Joi.string().max(255).optional(),
    keywords: Joi.array().items(Joi.string()).optional(),
    project_id: Joi.number().integer().optional(),
    brand_style_id: Joi.number().integer().optional()
  }),

  updateContent: Joi.object({
    title: Joi.string().min(1).max(500).optional(),
    content: Joi.string().optional(),
    status: Joi.string().valid('draft', 'in_progress', 'in_review', 'completed', 'published', 'archived').optional(),
    is_favorite: Joi.boolean().optional(),
    category: Joi.string().max(100).optional(),
    tone: Joi.string().max(100).optional(),
    target_audience: Joi.string().max(255).optional(),
    keywords: Joi.array().items(Joi.string()).optional()
  })
};

// Project validation schemas
const projectSchemas = {
  createProject: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    description: Joi.string().optional(),
    type: Joi.string().max(100).optional(),
    brand_style_id: Joi.number().integer().optional(),
    settings: Joi.object().optional()
  }),

  updateProject: Joi.object({
    name: Joi.string().min(1).max(255).optional(),
    description: Joi.string().optional(),
    type: Joi.string().max(100).optional(),
    status: Joi.string().valid('draft', 'in_progress', 'in_review', 'completed', 'archived').optional(),
    brand_style_id: Joi.number().integer().optional(),
    settings: Joi.object().optional()
  })
};

// Brand style validation schemas
const brandStyleSchemas = {
  createBrandStyle: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    description: Joi.string().optional(),
    voice_type: Joi.string().valid('professional', 'friendly', 'playful', 'minimalist').required(),
    personality: Joi.string().optional(),
    key_messages: Joi.array().items(Joi.string()).optional(),
    color_palette: Joi.object().optional(),
    typography: Joi.object().optional(),
    guidelines: Joi.string().optional(),
    is_default: Joi.boolean().optional()
  }),

  updateBrandStyle: Joi.object({
    name: Joi.string().min(1).max(255).optional(),
    description: Joi.string().optional(),
    voice_type: Joi.string().valid('professional', 'friendly', 'playful', 'minimalist').optional(),
    personality: Joi.string().optional(),
    key_messages: Joi.array().items(Joi.string()).optional(),
    color_palette: Joi.object().optional(),
    typography: Joi.object().optional(),
    guidelines: Joi.string().optional(),
    is_default: Joi.boolean().optional()
  })
};

// Prompt template validation schemas
const promptTemplateSchemas = {
  createPromptTemplate: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    description: Joi.string().optional(),
    category: Joi.string().max(100).optional(),
    content_type: Joi.string().max(100).optional(),
    tone: Joi.string().max(100).optional(),
    prompt_text: Joi.string().required(),
    variables: Joi.array().items(Joi.string()).optional(),
    is_public: Joi.boolean().optional()
  }),

  updatePromptTemplate: Joi.object({
    name: Joi.string().min(1).max(255).optional(),
    description: Joi.string().optional(),
    category: Joi.string().max(100).optional(),
    content_type: Joi.string().max(100).optional(),
    tone: Joi.string().max(100).optional(),
    prompt_text: Joi.string().optional(),
    variables: Joi.array().items(Joi.string()).optional(),
    is_public: Joi.boolean().optional()
  })
};

// Team validation schemas
const teamSchemas = {
  createTeam: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    description: Joi.string().optional(),
    settings: Joi.object().optional()
  }),

  updateTeam: Joi.object({
    name: Joi.string().min(1).max(255).optional(),
    description: Joi.string().optional(),
    settings: Joi.object().optional()
  }),

  inviteMember: Joi.object({
    email: Joi.string().email().required(),
    role: Joi.string().valid('admin', 'editor', 'writer', 'viewer').required()
  })
};

module.exports = {
  validate,
  userSchemas,
  contentSchemas,
  projectSchemas,
  brandStyleSchemas,
  promptTemplateSchemas,
  teamSchemas
};