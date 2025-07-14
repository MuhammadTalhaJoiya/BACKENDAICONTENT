const { promisePool } = require('../config/database');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function seedDatabase() {
  try {
    console.log('🌱 Starting database seeding...');

    // Check if data already exists
    const [existingUsers] = await promisePool.execute('SELECT COUNT(*) as count FROM users');
    if (existingUsers[0].count > 0) {
      console.log('📊 Database already contains data. Skipping seed.');
      return;
    }

    // Create demo user
    const hashedPassword = await bcrypt.hash('demo123456', 12);
    const [userResult] = await promisePool.execute(`
      INSERT INTO users (first_name, last_name, email, password, bio, company, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', NOW())
    `, [
      'Demo',
      'User',
      'demo@example.com',
      hashedPassword,
      'This is a demo user account for testing the AI Content Agent Manager.',
      'Demo Company Inc.'
    ]);

    const userId = userResult.insertId;
    console.log('👤 Demo user created (email: demo@example.com, password: demo123456)');

    // Create user preferences
    await promisePool.execute(`
      INSERT INTO user_preferences (user_id, email_notifications, dashboard_layout, default_settings, theme)
      VALUES (?, ?, ?, ?, ?)
    `, [
      userId,
      JSON.stringify({
        content_generated: true,
        team_invitations: true,
        project_updates: true,
        weekly_summary: true
      }),
      JSON.stringify({ layout: 'default' }),
      JSON.stringify({
        default_tone: 'professional',
        default_word_count: 500,
        auto_save: true
      }),
      'system'
    ]);

    // Create brand styles
    const brandStyles = [
      {
        name: 'Professional Corporate',
        description: 'Formal, authoritative business communication style',
        voice_type: 'professional',
        personality: 'Our brand speaks with authority and expertise, maintaining a professional tone that builds trust and credibility.',
        key_messages: ['Innovation', 'Quality', 'Reliability', 'Excellence'],
        color_palette: {
          primary: '#1e3a8a',
          secondary: '#3b82f6',
          accent: '#f59e0b',
          neutral: '#6b7280'
        },
        typography: {
          primary_font: 'Inter',
          secondary_font: 'Roboto',
          heading_style: 'Bold and clean'
        },
        is_default: true
      },
      {
        name: 'Friendly Startup',
        description: 'Casual, approachable, and energetic communication',
        voice_type: 'friendly',
        personality: 'We are approachable, enthusiastic, and always ready to help. Our communication is warm and personal.',
        key_messages: ['Innovation', 'Community', 'Growth', 'Accessibility'],
        color_palette: {
          primary: '#10b981',
          secondary: '#34d399',
          accent: '#f472b6',
          neutral: '#6b7280'
        },
        typography: {
          primary_font: 'Poppins',
          secondary_font: 'Open Sans',
          heading_style: 'Playful and modern'
        },
        is_default: false
      }
    ];

    for (const brand of brandStyles) {
      await promisePool.execute(`
        INSERT INTO brand_styles (
          user_id, name, description, voice_type, personality,
          key_messages, color_palette, typography, is_default, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        userId,
        brand.name,
        brand.description,
        brand.voice_type,
        brand.personality,
        JSON.stringify(brand.key_messages),
        JSON.stringify(brand.color_palette),
        JSON.stringify(brand.typography),
        brand.is_default
      ]);
    }
    console.log('🎨 Brand styles created');

    // Create prompt templates
    const promptTemplates = [
      {
        name: 'Blog Post Introduction',
        description: 'Template for creating engaging blog post introductions',
        category: 'Content',
        content_type: 'blog_post',
        tone: 'professional',
        prompt_text: 'Write an engaging introduction for a blog post about {{topic}}. The target audience is {{audience}}. The tone should be {{tone}} and include a hook that makes readers want to continue reading.',
        variables: ['{{topic}}', '{{audience}}', '{{tone}}'],
        is_public: true
      },
      {
        name: 'Product Description',
        description: 'Template for creating compelling product descriptions',
        category: 'E-commerce',
        content_type: 'product_description',
        tone: 'persuasive',
        prompt_text: 'Write a compelling product description for {{product_name}}. Highlight the key features: {{features}}. The target audience is {{audience}}. Focus on benefits and use persuasive language to encourage purchases.',
        variables: ['{{product_name}}', '{{features}}', '{{audience}}'],
        is_public: true
      },
      {
        name: 'Social Media Post',
        description: 'Template for creating engaging social media content',
        category: 'Marketing',
        content_type: 'social_media',
        tone: 'casual',
        prompt_text: 'Create an engaging social media post about {{topic}} for {{platform}}. Include relevant hashtags and a call-to-action. The tone should be {{tone}} and appeal to {{audience}}.',
        variables: ['{{topic}}', '{{platform}}', '{{tone}}', '{{audience}}'],
        is_public: true
      },
      {
        name: 'Email Subject Line',
        description: 'Template for creating compelling email subject lines',
        category: 'Email',
        content_type: 'email',
        tone: 'professional',
        prompt_text: 'Generate 5 compelling email subject lines for an email about {{topic}}. The audience is {{audience}} and the goal is {{goal}}. Make them attention-grabbing but not spammy.',
        variables: ['{{topic}}', '{{audience}}', '{{goal}}'],
        is_public: true
      }
    ];

    for (const template of promptTemplates) {
      await promisePool.execute(`
        INSERT INTO prompt_templates (
          user_id, name, description, category, content_type, tone,
          prompt_text, variables, is_public, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        userId,
        template.name,
        template.description,
        template.category,
        template.content_type,
        template.tone,
        template.prompt_text,
        JSON.stringify(template.variables),
        template.is_public
      ]);
    }
    console.log('📝 Prompt templates created');

    // Create sample projects
    const [projectResult1] = await promisePool.execute(`
      INSERT INTO projects (user_id, name, description, type, status, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `, [
      userId,
      'Company Blog Content',
      'Creating engaging blog posts for our company website',
      'Content Marketing',
      'in_progress'
    ]);

    const [projectResult2] = await promisePool.execute(`
      INSERT INTO projects (user_id, name, description, type, status, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `, [
      userId,
      'Product Launch Campaign',
      'Content for upcoming product launch including social media and email',
      'Marketing Campaign',
      'draft'
    ]);

    console.log('📁 Sample projects created');

    // Create sample content
    const sampleContent = [
      {
        title: '10 Tips for Remote Work Productivity',
        content_type: 'blog_post',
        category: 'Business',
        content: 'Remote work has become the new normal for many professionals. In this article, we explore proven strategies to maintain and boost productivity while working from home...',
        word_count: 1250,
        status: 'published',
        project_id: projectResult1.insertId,
        keywords: ['remote work', 'productivity', 'work from home', 'tips']
      },
      {
        title: 'The Future of AI in Content Creation',
        content_type: 'article',
        category: 'Technology',
        content: 'Artificial Intelligence is revolutionizing how we create content. From automated writing to intelligent editing suggestions...',
        word_count: 890,
        status: 'draft',
        project_id: projectResult1.insertId,
        keywords: ['AI', 'content creation', 'artificial intelligence', 'technology']
      },
      {
        title: 'Exciting Product Launch Announcement',
        content_type: 'social_media',
        category: 'Marketing',
        content: '🚀 We\'re thrilled to announce our latest innovation! Get ready for something amazing. Stay tuned for more details. #Innovation #ProductLaunch #Excited',
        word_count: 25,
        status: 'completed',
        project_id: projectResult2.insertId,
        keywords: ['product launch', 'announcement', 'innovation']
      },
      {
        title: 'Welcome to Our Newsletter',
        content_type: 'email',
        category: 'Email Marketing',
        content: 'Thank you for subscribing to our newsletter! We\'re excited to share valuable insights, tips, and updates with you...',
        word_count: 156,
        status: 'completed',
        project_id: projectResult2.insertId,
        keywords: ['newsletter', 'welcome', 'subscription']
      }
    ];

    for (const content of sampleContent) {
      await promisePool.execute(`
        INSERT INTO content_items (
          user_id, project_id, title, content_type, category, content,
          word_count, status, keywords, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        userId,
        content.project_id,
        content.title,
        content.content_type,
        content.category,
        content.content,
        content.word_count,
        content.status,
        JSON.stringify(content.keywords)
      ]);
    }
    console.log('📄 Sample content created');

    // Create some usage statistics
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      
      await promisePool.execute(`
        INSERT INTO usage_statistics (user_id, date, content_generated, tokens_used, api_calls)
        VALUES (?, ?, ?, ?, ?)
      `, [
        userId,
        date.toISOString().split('T')[0],
        Math.floor(Math.random() * 5) + 1,
        Math.floor(Math.random() * 1000) + 100,
        Math.floor(Math.random() * 10) + 1
      ]);
    }
    console.log('📊 Usage statistics created');

    console.log('✅ Database seeding completed successfully!');
    console.log('');
    console.log('🎉 You can now login with:');
    console.log('   Email: demo@example.com');
    console.log('   Password: demo123456');
    console.log('');

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run seeding if called directly
if (require.main === module) {
  seedDatabase().then(() => {
    console.log('🌱 Seeding process completed');
    process.exit(0);
  }).catch((error) => {
    console.error('💥 Seeding process failed:', error);
    process.exit(1);
  });
}

module.exports = { seedDatabase };