-- Create database if not exists
CREATE DATABASE IF NOT EXISTS ai_content_agent;
USE ai_content_agent;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    avatar VARCHAR(500),
    bio TEXT,
    company VARCHAR(255),
    website VARCHAR(255),
    phone VARCHAR(20),
    timezone VARCHAR(50) DEFAULT 'UTC',
    language VARCHAR(10) DEFAULT 'en',
    role ENUM('admin', 'editor', 'writer', 'viewer') DEFAULT 'writer',
    status ENUM('active', 'inactive', 'pending') DEFAULT 'pending',
    email_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMP NULL,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id INT NOT NULL,
    settings JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Team members table
CREATE TABLE IF NOT EXISTS team_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    team_id INT NOT NULL,
    user_id INT NOT NULL,
    role ENUM('admin', 'editor', 'writer', 'viewer') DEFAULT 'writer',
    status ENUM('active', 'pending', 'inactive') DEFAULT 'pending',
    invited_by INT,
    joined_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_team_user (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Brand styles table
CREATE TABLE IF NOT EXISTS brand_styles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    team_id INT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    voice_type ENUM('professional', 'friendly', 'playful', 'minimalist') DEFAULT 'professional',
    personality TEXT,
    key_messages JSON,
    color_palette JSON,
    typography JSON,
    logo_url VARCHAR(500),
    guidelines TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

-- Prompt templates table
CREATE TABLE IF NOT EXISTS prompt_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    team_id INT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    content_type VARCHAR(100),
    tone VARCHAR(100),
    prompt_text TEXT NOT NULL,
    variables JSON,
    is_public BOOLEAN DEFAULT FALSE,
    usage_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    team_id INT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(100),
    status ENUM('draft', 'in_progress', 'in_review', 'completed', 'archived') DEFAULT 'draft',
    brand_style_id INT,
    settings JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (brand_style_id) REFERENCES brand_styles(id) ON DELETE SET NULL
);

-- Content items table
CREATE TABLE IF NOT EXISTS content_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    project_id INT,
    team_id INT,
    title VARCHAR(500) NOT NULL,
    content_type ENUM('blog_post', 'article', 'social_media', 'email', 'product_description', 'press_release', 'landing_page', 'ad_copy', 'image', 'video', 'audio') NOT NULL,
    category VARCHAR(100),
    content TEXT,
    metadata JSON,
    word_count INT,
    tone VARCHAR(100),
    target_audience VARCHAR(255),
    keywords JSON,
    status ENUM('draft', 'in_progress', 'in_review', 'completed', 'published', 'archived') DEFAULT 'draft',
    is_favorite BOOLEAN DEFAULT FALSE,
    seo_score INT,
    readability_score INT,
    prompt_template_id INT,
    brand_style_id INT,
    file_url VARCHAR(500),
    file_type VARCHAR(100),
    file_size INT,
    generated_at TIMESTAMP NULL,
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
    FOREIGN KEY (prompt_template_id) REFERENCES prompt_templates(id) ON DELETE SET NULL,
    FOREIGN KEY (brand_style_id) REFERENCES brand_styles(id) ON DELETE SET NULL
);

-- Content generations table (for tracking AI generation requests)
CREATE TABLE IF NOT EXISTS content_generations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    content_item_id INT,
    prompt_text TEXT NOT NULL,
    input_parameters JSON,
    ai_model VARCHAR(100),
    tokens_used INT,
    generation_time_ms INT,
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);

-- SEO optimizations table
CREATE TABLE IF NOT EXISTS seo_optimizations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content_item_id INT NOT NULL,
    focus_keyword VARCHAR(255),
    meta_title VARCHAR(255),
    meta_description TEXT,
    slug VARCHAR(255),
    keywords JSON,
    optimization_suggestions JSON,
    score INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);

-- Content versions table (for version control)
CREATE TABLE IF NOT EXISTS content_versions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content_item_id INT NOT NULL,
    version_number INT NOT NULL,
    title VARCHAR(500),
    content TEXT,
    changes_summary TEXT,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content_item_id INT NOT NULL,
    user_id INT NOT NULL,
    parent_id INT,
    comment_text TEXT NOT NULL,
    status ENUM('active', 'resolved', 'deleted') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

-- User preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    email_notifications JSON,
    dashboard_layout JSON,
    default_settings JSON,
    theme ENUM('light', 'dark', 'system') DEFAULT 'system',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    action VARCHAR(255) NOT NULL,
    resource_type VARCHAR(100),
    resource_id INT,
    details JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- API keys table (for external integrations)
CREATE TABLE IF NOT EXISTS api_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    permissions JSON,
    last_used_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Usage statistics table
CREATE TABLE IF NOT EXISTS usage_statistics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    date DATE NOT NULL,
    content_generated INT DEFAULT 0,
    tokens_used INT DEFAULT 0,
    api_calls INT DEFAULT 0,
    storage_used_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_date (user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_content_items_user_id ON content_items(user_id);
CREATE INDEX idx_content_items_type ON content_items(content_type);
CREATE INDEX idx_content_items_status ON content_items(status);
CREATE INDEX idx_content_items_created_at ON content_items(created_at);
CREATE INDEX idx_prompt_templates_user_id ON prompt_templates(user_id);
CREATE INDEX idx_prompt_templates_category ON prompt_templates(category);
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX idx_usage_statistics_user_date ON usage_statistics(user_id, date);