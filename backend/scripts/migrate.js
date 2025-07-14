const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
  // Create connection without database selection first
  const connection = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });

  try {
    console.log('🔄 Starting database migration...');

    // Read the SQL file
    const sqlPath = path.join(__dirname, 'createDatabase.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Execute the SQL
    await new Promise((resolve, reject) => {
      connection.query(sqlContent, (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      });
    });

    console.log('✅ Database migration completed successfully!');
    console.log('📊 Database schema created with all tables and indexes');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    connection.end();
  }
}

// Run migration if called directly
if (require.main === module) {
  runMigration().then(() => {
    console.log('🎉 Migration process completed');
    process.exit(0);
  }).catch((error) => {
    console.error('💥 Migration process failed:', error);
    process.exit(1);
  });
}

module.exports = { runMigration };