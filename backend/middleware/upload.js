const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Ensure upload directories exist
const createUploadDirs = () => {
  const dirs = ['./uploads', './uploads/avatars', './uploads/content', './uploads/brand-assets'];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

createUploadDirs();

// Storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let uploadPath = './uploads/';
    
    // Determine upload path based on file type or route
    if (req.route.path.includes('avatar')) {
      uploadPath += 'avatars/';
    } else if (req.route.path.includes('brand')) {
      uploadPath += 'brand-assets/';
    } else {
      uploadPath += 'content/';
    }
    
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  // Check file type based on route
  if (req.route.path.includes('avatar') || req.route.path.includes('brand')) {
    // Only allow images for avatars and brand assets
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for avatars and brand assets'), false);
    }
  } else {
    // Allow various file types for content
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/avi',
      'audio/mp3', 'audio/wav', 'audio/ogg',
      'application/pdf', 'text/plain',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  }
};

// Upload middleware
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB default
  }
});

// Image processing middleware
const processImage = async (req, res, next) => {
  if (!req.file || !req.file.mimetype.startsWith('image/')) {
    return next();
  }

  try {
    const { filename, path: filePath } = req.file;
    const processedPath = filePath.replace(filename, `processed-${filename}`);

    // Process image based on use case
    let sharpInstance = sharp(filePath);

    if (req.route.path.includes('avatar')) {
      // Avatar: resize to 200x200, optimize
      await sharpInstance
        .resize(200, 200, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 90 })
        .toFile(processedPath);
    } else {
      // General images: optimize while maintaining aspect ratio
      await sharpInstance
        .resize(1200, 1200, { 
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 85 })
        .toFile(processedPath);
    }

    // Replace original with processed image
    fs.unlinkSync(filePath);
    fs.renameSync(processedPath, filePath);

    next();
  } catch (error) {
    console.error('Image processing error:', error);
    next(); // Continue even if processing fails
  }
};

// Error handling middleware for uploads
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB.'
      });
    }
    return res.status(400).json({
      success: false,
      message: 'Upload error: ' + err.message
    });
  }
  
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  
  next();
};

module.exports = {
  upload,
  processImage,
  handleUploadError
};