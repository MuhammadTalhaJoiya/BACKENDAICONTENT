const express = require('express');
const { promisePool } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate, teamSchemas } = require('../middleware/validation');
const { logActivity } = require('../middleware/logger');

const router = express.Router();

// Get all teams for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [teams] = await promisePool.execute(`
      SELECT 
        t.*,
        u.first_name as owner_first_name,
        u.last_name as owner_last_name,
        tm.role as user_role,
        COUNT(DISTINCT tm2.user_id) as member_count,
        COUNT(DISTINCT p.id) as project_count,
        COUNT(DISTINCT ci.id) as content_count
      FROM teams t
      LEFT JOIN users u ON t.owner_id = u.id
      LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = ?
      LEFT JOIN team_members tm2 ON t.id = tm2.team_id AND tm2.status = 'active'
      LEFT JOIN projects p ON t.id = p.team_id
      LEFT JOIN content_items ci ON t.id = ci.team_id
      WHERE (t.owner_id = ? OR tm.user_id = ?) AND tm.status = 'active'
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `, [userId, userId, userId]);

    res.json({
      success: true,
      data: {
        teams: teams.map(t => ({
          ...t,
          settings: t.settings ? JSON.parse(t.settings) : {},
          owner: `${t.owner_first_name} ${t.owner_last_name}`,
          is_owner: t.owner_id === userId
        }))
      }
    });

  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get teams'
    });
  }
});

// Get single team
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Check if user has access to team
    const [access] = await promisePool.execute(`
      SELECT t.*, tm.role as user_role, u.first_name as owner_first_name, u.last_name as owner_last_name
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = ? AND tm.status = 'active'
      LEFT JOIN users u ON t.owner_id = u.id
      WHERE t.id = ? AND (t.owner_id = ? OR tm.user_id = ?)
    `, [userId, teamId, userId, userId]);

    if (access.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found or access denied'
      });
    }

    const team = access[0];

    // Get team members
    const [members] = await promisePool.execute(`
      SELECT 
        tm.*,
        u.first_name,
        u.last_name,
        u.email,
        u.avatar,
        u.last_login,
        invited_by_user.first_name as invited_by_first_name,
        invited_by_user.last_name as invited_by_last_name
      FROM team_members tm
      LEFT JOIN users u ON tm.user_id = u.id
      LEFT JOIN users invited_by_user ON tm.invited_by = invited_by_user.id
      WHERE tm.team_id = ?
      ORDER BY tm.role, tm.joined_at
    `, [teamId]);

    // Get team projects
    const [projects] = await promisePool.execute(`
      SELECT 
        p.id, p.name, p.status, p.created_at, p.updated_at,
        COUNT(ci.id) as content_count
      FROM projects p
      LEFT JOIN content_items ci ON p.id = ci.project_id AND ci.status != 'archived'
      WHERE p.team_id = ?
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `, [teamId]);

    res.json({
      success: true,
      data: {
        team: {
          ...team,
          settings: team.settings ? JSON.parse(team.settings) : {},
          owner: `${team.owner_first_name} ${team.owner_last_name}`,
          is_owner: team.owner_id === userId,
          members: members.map(m => ({
            ...m,
            name: `${m.first_name} ${m.last_name}`,
            invited_by: m.invited_by_first_name ? `${m.invited_by_first_name} ${m.invited_by_last_name}` : null
          })),
          projects
        }
      }
    });

  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get team'
    });
  }
});

// Create new team
router.post('/', authenticateToken, validate(teamSchemas.createTeam), async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, description, settings } = req.body;

    const [result] = await promisePool.execute(`
      INSERT INTO teams (owner_id, name, description, settings, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `, [userId, name, description, JSON.stringify(settings || {})]);

    const teamId = result.insertId;

    // Add owner as admin member
    await promisePool.execute(`
      INSERT INTO team_members (team_id, user_id, role, status, joined_at)
      VALUES (?, ?, 'admin', 'active', NOW())
    `, [teamId, userId]);

    // Log activity
    await logActivity(userId, 'team_created', 'team', teamId, { name }, req);

    res.status(201).json({
      success: true,
      message: 'Team created successfully',
      data: { id: teamId }
    });

  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create team'
    });
  }
});

// Update team
router.put('/:id', authenticateToken, validate(teamSchemas.updateTeam), async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;
    const updates = req.body;

    // Check if user is team owner or admin
    const [access] = await promisePool.execute(`
      SELECT t.name
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = ?
      WHERE t.id = ? AND (t.owner_id = ? OR (tm.role IN ('admin') AND tm.status = 'active'))
    `, [userId, teamId, userId]);

    if (access.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found or insufficient permissions'
      });
    }

    // Build update query
    const updateFields = [];
    const params = [];

    Object.keys(updates).forEach(key => {
      if (['name', 'description'].includes(key)) {
        updateFields.push(`${key} = ?`);
        params.push(updates[key]);
      } else if (key === 'settings') {
        updateFields.push('settings = ?');
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
    params.push(teamId);

    await promisePool.execute(`
      UPDATE teams 
      SET ${updateFields.join(', ')} 
      WHERE id = ?
    `, params);

    // Log activity
    await logActivity(userId, 'team_updated', 'team', teamId, { fields: Object.keys(updates) }, req);

    res.json({
      success: true,
      message: 'Team updated successfully'
    });

  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update team'
    });
  }
});

// Invite team member
router.post('/:id/invite', authenticateToken, validate(teamSchemas.inviteMember), async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;
    const { email, role } = req.body;

    // Check if user has permission to invite
    const [access] = await promisePool.execute(`
      SELECT t.name
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = ?
      WHERE t.id = ? AND (t.owner_id = ? OR (tm.role IN ('admin') AND tm.status = 'active'))
    `, [userId, teamId, userId]);

    if (access.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found or insufficient permissions'
      });
    }

    // Check if user exists
    const [users] = await promisePool.execute(
      'SELECT id, first_name, last_name FROM users WHERE email = ? AND status = "active"',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found or account is not active'
      });
    }

    const invitedUserId = users[0].id;

    // Check if user is already a member
    const [existing] = await promisePool.execute(
      'SELECT id FROM team_members WHERE team_id = ? AND user_id = ?',
      [teamId, invitedUserId]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User is already a member of this team'
      });
    }

    // Add team member
    await promisePool.execute(`
      INSERT INTO team_members (team_id, user_id, role, status, invited_by, created_at)
      VALUES (?, ?, ?, 'pending', ?, NOW())
    `, [teamId, invitedUserId, role, userId]);

    // Log activity
    await logActivity(userId, 'team_member_invited', 'team', teamId, { 
      invited_user: `${users[0].first_name} ${users[0].last_name}`,
      role 
    }, req);

    res.status(201).json({
      success: true,
      message: 'Team member invited successfully'
    });

  } catch (error) {
    console.error('Invite team member error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to invite team member'
    });
  }
});

// Accept team invitation
router.post('/:id/accept-invitation', authenticateToken, async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Check if user has pending invitation
    const [invitations] = await promisePool.execute(`
      SELECT tm.id, t.name
      FROM team_members tm
      LEFT JOIN teams t ON tm.team_id = t.id
      WHERE tm.team_id = ? AND tm.user_id = ? AND tm.status = 'pending'
    `, [teamId, userId]);

    if (invitations.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No pending invitation found'
      });
    }

    // Accept invitation
    await promisePool.execute(`
      UPDATE team_members 
      SET status = 'active', joined_at = NOW() 
      WHERE team_id = ? AND user_id = ?
    `, [teamId, userId]);

    // Log activity
    await logActivity(userId, 'team_invitation_accepted', 'team', teamId, { 
      team_name: invitations[0].name 
    }, req);

    res.json({
      success: true,
      message: 'Team invitation accepted successfully'
    });

  } catch (error) {
    console.error('Accept team invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept team invitation'
    });
  }
});

// Reject team invitation
router.post('/:id/reject-invitation', authenticateToken, async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Check if user has pending invitation
    const [invitations] = await promisePool.execute(`
      SELECT tm.id, t.name
      FROM team_members tm
      LEFT JOIN teams t ON tm.team_id = t.id
      WHERE tm.team_id = ? AND tm.user_id = ? AND tm.status = 'pending'
    `, [teamId, userId]);

    if (invitations.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No pending invitation found'
      });
    }

    // Delete invitation
    await promisePool.execute(
      'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
      [teamId, userId]
    );

    // Log activity
    await logActivity(userId, 'team_invitation_rejected', 'team', teamId, { 
      team_name: invitations[0].name 
    }, req);

    res.json({
      success: true,
      message: 'Team invitation rejected successfully'
    });

  } catch (error) {
    console.error('Reject team invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject team invitation'
    });
  }
});

// Remove team member
router.delete('/:id/members/:memberId', authenticateToken, async (req, res) => {
  try {
    const teamId = req.params.id;
    const memberId = req.params.memberId;
    const userId = req.user.id;

    // Check if user has permission to remove members
    const [access] = await promisePool.execute(`
      SELECT t.owner_id
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = ?
      WHERE t.id = ? AND (t.owner_id = ? OR (tm.role IN ('admin') AND tm.status = 'active'))
    `, [userId, teamId, userId]);

    if (access.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found or insufficient permissions'
      });
    }

    // Cannot remove team owner
    if (parseInt(memberId) === access[0].owner_id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove team owner'
      });
    }

    // Get member info before removing
    const [members] = await promisePool.execute(`
      SELECT u.first_name, u.last_name
      FROM team_members tm
      LEFT JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = ? AND tm.user_id = ?
    `, [teamId, memberId]);

    if (members.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found'
      });
    }

    // Remove member
    await promisePool.execute(
      'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
      [teamId, memberId]
    );

    // Log activity
    await logActivity(userId, 'team_member_removed', 'team', teamId, { 
      removed_user: `${members[0].first_name} ${members[0].last_name}`
    }, req);

    res.json({
      success: true,
      message: 'Team member removed successfully'
    });

  } catch (error) {
    console.error('Remove team member error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove team member'
    });
  }
});

// Leave team
router.post('/:id/leave', authenticateToken, async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Check if user is team owner
    const [teams] = await promisePool.execute(
      'SELECT owner_id, name FROM teams WHERE id = ?',
      [teamId]
    );

    if (teams.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    if (teams[0].owner_id === userId) {
      return res.status(400).json({
        success: false,
        message: 'Team owner cannot leave the team. Transfer ownership or delete the team instead.'
      });
    }

    // Remove user from team
    await promisePool.execute(
      'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
      [teamId, userId]
    );

    // Log activity
    await logActivity(userId, 'team_left', 'team', teamId, { 
      team_name: teams[0].name 
    }, req);

    res.json({
      success: true,
      message: 'Left team successfully'
    });

  } catch (error) {
    console.error('Leave team error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to leave team'
    });
  }
});

module.exports = router;