# AI Content Agent Manager - Backend

A comprehensive Node.js backend for the AI Content Agent Manager application, providing robust APIs for content generation, team collaboration, brand management, and analytics.

## 🚀 Features

- **Authentication & Authorization** - JWT-based auth with role-based access control
- **Content Management** - Full CRUD operations for AI-generated content
- **Project Organization** - Organize content into projects with team collaboration
- **Brand Style Management** - Define and maintain consistent brand voice and visuals
- **Prompt Templates** - Create and share reusable AI prompts
- **Team Collaboration** - Multi-user teams with role-based permissions
- **SEO Optimization** - Built-in SEO analysis and suggestions
- **Media Management** - File uploads with image processing
- **Analytics & Statistics** - Comprehensive usage and performance analytics
- **Activity Logging** - Full audit trail of user actions

## 🛠️ Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MySQL 8.0+
- **Authentication**: JWT (JSON Web Tokens)
- **Password Hashing**: bcryptjs
- **File Uploads**: Multer with Sharp for image processing
- **Validation**: Joi
- **Logging**: Winston
- **Security**: Helmet, CORS, Rate Limiting

## 📋 Prerequisites

- Node.js 16.x or higher
- MySQL 8.0 or higher
- npm or yarn package manager

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   ```

4. **Configure environment variables**
   Edit `.env` file with your settings:
   ```env
   # Server Configuration
   PORT=3000
   NODE_ENV=development

   # Database Configuration
   DB_HOST=localhost
   DB_PORT=3306
   DB_NAME=ai_content_agent
   DB_USER=root
   DB_PASSWORD=your_password

   # JWT Configuration
   JWT_SECRET=your_super_secret_jwt_key_here
   JWT_EXPIRE=7d

   # CORS Configuration
   FRONTEND_URL=http://localhost:5173
   ```

5. **Database Setup**
   ```bash
   # Create database and tables
   npm run migrate

   # Seed with sample data (optional)
   npm run seed
   ```

6. **Start the server**
   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm start
   ```

## 📊 Database Schema

The backend uses a comprehensive MySQL schema with the following main entities:

- **Users** - User accounts and profiles
- **Teams** - Team collaboration and management
- **Projects** - Content organization and project management
- **Content Items** - Generated content with metadata
- **Brand Styles** - Brand voice and visual identity
- **Prompt Templates** - Reusable AI prompts
- **SEO Optimizations** - SEO analysis and metadata
- **Activity Logs** - User action tracking
- **Usage Statistics** - Analytics and reporting data

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - User logout
- `POST /api/auth/change-password` - Change password

### Content Management
- `GET /api/content` - Get user content (with filtering/pagination)
- `GET /api/content/:id` - Get single content item
- `POST /api/content` - Create new content
- `PUT /api/content/:id` - Update content
- `DELETE /api/content/:id` - Delete content
- `PATCH /api/content/:id/favorite` - Toggle favorite status
- `POST /api/content/:id/duplicate` - Duplicate content
- `POST /api/content/:id/comments` - Add comment

### Projects
- `GET /api/projects` - Get user projects
- `GET /api/projects/:id` - Get single project
- `POST /api/projects` - Create project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Brand Styles
- `GET /api/brand-styles` - Get brand styles
- `GET /api/brand-styles/:id` - Get single brand style
- `POST /api/brand-styles` - Create brand style
- `PUT /api/brand-styles/:id` - Update brand style
- `DELETE /api/brand-styles/:id` - Delete brand style
- `PATCH /api/brand-styles/:id/set-default` - Set as default

### Prompt Templates
- `GET /api/prompt-templates` - Get prompt templates
- `GET /api/prompt-templates/:id` - Get single template
- `POST /api/prompt-templates` - Create template
- `PUT /api/prompt-templates/:id` - Update template
- `DELETE /api/prompt-templates/:id` - Delete template
- `POST /api/prompt-templates/:id/test` - Test template

### Teams
- `GET /api/teams` - Get user teams
- `GET /api/teams/:id` - Get single team
- `POST /api/teams` - Create team
- `PUT /api/teams/:id` - Update team
- `POST /api/teams/:id/invite` - Invite member
- `POST /api/teams/:id/accept-invitation` - Accept invitation
- `DELETE /api/teams/:id/members/:memberId` - Remove member

### SEO
- `GET /api/seo/content/:id` - Get SEO data for content
- `POST /api/seo/analyze/:id` - Analyze content for SEO
- `PUT /api/seo/content/:id` - Update SEO optimization
- `POST /api/seo/keywords/suggest` - Get keyword suggestions
- `POST /api/seo/readability` - Analyze readability

### Media
- `POST /api/media/upload` - Upload media file
- `GET /api/media` - Get media files
- `GET /api/media/:id` - Get single media file
- `PUT /api/media/:id` - Update media metadata
- `DELETE /api/media/:id` - Delete media file

### Analytics
- `GET /api/dashboard/stats` - Dashboard statistics
- `GET /api/dashboard/recent-projects` - Recent projects
- `GET /api/dashboard/recent-content` - Recent content
- `GET /api/stats/user` - User statistics
- `GET /api/stats/productivity` - Productivity analytics

### User Management
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update profile
- `POST /api/users/avatar` - Upload avatar
- `DELETE /api/users/avatar` - Delete avatar
- `PUT /api/users/preferences` - Update preferences

## 🔒 Security Features

- **JWT Authentication** - Secure token-based authentication
- **Password Hashing** - bcryptjs with salt rounds
- **Rate Limiting** - Prevent API abuse
- **CORS Protection** - Configurable cross-origin requests
- **Request Validation** - Joi schema validation
- **SQL Injection Prevention** - Parameterized queries
- **File Upload Security** - Type validation and size limits

## 📁 Project Structure

```
backend/
├── config/
│   └── database.js          # Database configuration
├── middleware/
│   ├── auth.js              # Authentication middleware
│   ├── validation.js        # Request validation
│   ├── logger.js            # Logging middleware
│   └── upload.js            # File upload handling
├── routes/
│   ├── auth.js              # Authentication routes
│   ├── content.js           # Content management
│   ├── projects.js          # Project management
│   ├── brandStyles.js       # Brand style management
│   ├── promptTemplates.js   # Prompt templates
│   ├── teams.js             # Team collaboration
│   ├── seo.js               # SEO optimization
│   ├── media.js             # Media management
│   ├── dashboard.js         # Dashboard data
│   ├── users.js             # User management
│   └── stats.js             # Analytics
├── scripts/
│   ├── createDatabase.sql   # Database schema
│   ├── migrate.js           # Migration script
│   └── seed.js              # Seed data script
├── uploads/                 # File uploads directory
├── logs/                    # Application logs
├── .env.example             # Environment template
├── package.json             # Dependencies
└── server.js                # Main server file
```

## 🚦 Running Scripts

```bash
# Start development server
npm run dev

# Start production server
npm start

# Run database migration
npm run migrate

# Seed database with sample data
npm run seed
```

## 🧪 Demo Account

After running the seed script, you can login with:

- **Email**: demo@example.com
- **Password**: demo123456

This account includes sample projects, content, and configurations.

## 📝 API Response Format

All API responses follow a consistent format:

```json
{
  "success": true|false,
  "message": "Response message",
  "data": {
    // Response data
  },
  "errors": [
    // Validation errors (if any)
  ]
}
```

## 🔍 Monitoring & Logging

The application includes comprehensive logging:

- **HTTP Requests** - Morgan middleware for request logging
- **Application Logs** - Winston for structured logging
- **Activity Tracking** - Database logging of user actions
- **Error Handling** - Centralized error logging and reporting

## 🚀 Deployment

### Environment Variables for Production

```env
NODE_ENV=production
PORT=3000
DB_HOST=your_production_db_host
DB_PASSWORD=your_secure_password
JWT_SECRET=your_production_jwt_secret
```

### Docker Deployment (Optional)

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For support and questions:

1. Check the documentation
2. Review existing issues
3. Create a new issue with detailed information

## 🔧 Development Tips

- Use `npm run dev` for hot reloading during development
- Check logs in the `logs/` directory for debugging
- Use the `/health` endpoint to verify server status
- API responses include detailed error messages in development mode

---

Built with ❤️ for efficient AI content management.