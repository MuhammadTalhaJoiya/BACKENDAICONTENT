const winston = require('winston');
const morgan = require('morgan');
const { promisePool } = require('../config/database');

// Winston logger configuration
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ai-content-agent' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Activity logging function
const logActivity = async (userId, action, resourceType = null, resourceId = null, details = null, req = null) => {
  try {
    const ipAddress = req ? (req.ip || req.connection.remoteAddress) : null;
    const userAgent = req ? req.get('User-Agent') : null;

    await promisePool.execute(
      'INSERT INTO activity_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, action, resourceType, resourceId, JSON.stringify(details), ipAddress, userAgent]
    );

    logger.info('Activity logged', {
      userId,
      action,
      resourceType,
      resourceId,
      ipAddress
    });
  } catch (error) {
    logger.error('Failed to log activity', { error: error.message, userId, action });
  }
};

// Morgan middleware for HTTP request logging
const httpLogger = morgan('combined', {
  stream: {
    write: function(message) {
      logger.info(message.trim());
    }
  }
});

// Error logging middleware
const errorLogger = (err, req, res, next) => {
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user ? req.user.id : null
  });
  next(err);
};

module.exports = {
  logger,
  logActivity,
  httpLogger,
  errorLogger
};